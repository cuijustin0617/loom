"""Loom Knowledge Sidebar - FastAPI Backend."""

import os
import re
import time
import json
import hashlib
import sqlite3
import asyncio
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from typing import Union
from pydantic import BaseModel

from llm_router import LLMRouter
from embeddings import EmbeddingService, cosine_similarity, rank_by_similarity
from prompts import (
    CHAT_RESPONSE_PROMPT,
    CHAT_STREAM_SYSTEM_PROMPT,
    CHAT_STREAM_BASELINE_PROMPT,
    CHAT_STREAM_MEMORY_PROMPT,
    CHAT_METADATA_PROMPT,
    SIDEBAR_NEW_DIRECTIONS_PROMPT,
    STATUS_UPDATE_PROMPT,
    CHAT_SUMMARIZE_PROMPT,
    TOPIC_AUTO_DETECT_PROMPT,
    BASELINE_PERSONAL_DETAILS_PROMPT,
    OVERVIEW_AI_EDIT_PROMPT,
    TOPIC_RENAME_CHECK_PROMPT,
)

load_dotenv()

app = FastAPI(title="Loom Knowledge Sidebar")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
STATIC_VERSION = str(int(time.time()))

# Persistent data directory (configurable for Render persistent disk)
DATA_DIR = Path(os.environ.get("LOOM_DATA_DIR", Path(__file__).parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "loom_study.db"

llm = LLMRouter()
embedder = EmbeddingService()


# ── SQLite Setup ──────────────────────────────────────────────────────────────

def _get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db():
    conn = _get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            condition TEXT NOT NULL DEFAULT 'loom',
            event_type TEXT NOT NULL,
            event_data TEXT NOT NULL DEFAULT '{}',
            timestamp TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS user_data (
            user_id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            condition TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)")
    conn.commit()
    conn.close()


_init_db()


# ── Pydantic Models ──────────────────────────────────────────────────────────


class MessageItem(BaseModel):
    role: str
    content: str


class TopicItem(BaseModel):
    id: str
    name: str


class ConceptItem(BaseModel):
    id: str
    topicId: str
    title: str
    preview: str


class AttachmentItem(BaseModel):
    mimeType: str
    data: str  # base64

class ChatRequest(BaseModel):
    chatId: str
    messages: list[MessageItem]
    existingTopics: list[TopicItem] = []
    existingConcepts: list[ConceptItem] = []
    model: str | None = None
    attachments: list[AttachmentItem] = []
    useSearch: bool = False
    allChatSummaries: list[dict] = []
    condition: str = "loom"
    personalDetails: list[str] = []


class SidebarRefreshRequest(BaseModel):
    chatId: str
    messages: list[MessageItem]
    topicId: str
    topicName: str
    topicStatus: Union[str, dict] = ""
    allChatSummaries: list[dict] = []
    allConcepts: list[dict] = []
    model: str | None = None


class SummarizeRequest(BaseModel):
    messages: list[MessageItem]
    model: str | None = None


class EmbedRequest(BaseModel):
    text: str


class BatchEmbedRequest(BaseModel):
    texts: list[str]


class RankRequest(BaseModel):
    queryEmbedding: list[float]
    candidates: list[dict]


class StatusUpdateRequest(BaseModel):
    topicName: str
    currentStatus: Union[str, dict] = ""
    recentSummaries: list[str] = []
    model: str | None = None


class OverviewAiEditRequest(BaseModel):
    topicName: str
    overview: list[str] = []
    instruction: str
    model: str | None = None


class TopicRenameCheckRequest(BaseModel):
    oldName: str
    newName: str
    overview: list[str] = []
    model: str | None = None


class TopicDetectRequest(BaseModel):
    chatSummaries: list[dict] = []
    existingTopics: list[TopicItem] = []


class DirectionsRequest(BaseModel):
    topicName: str
    topicStatus: Union[str, dict] = ""
    allConcepts: list[dict] = []
    currentSummary: str = ""
    previouslySuggested: list[str] = []
    model: str | None = None


class LogEvent(BaseModel):
    userId: str
    condition: str = "loom"
    eventType: str
    data: dict = {}
    timestamp: str = ""


class SyncRequest(BaseModel):
    userId: str
    data: dict


class BaselineExtractRequest(BaseModel):
    messages: list[MessageItem]
    existingDetails: list[str] = []
    model: str | None = None


class AuthRequest(BaseModel):
    userId: str
    password: str


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def _parse_condition(user_id: str) -> str:
    lower = user_id.lower()
    if lower.startswith("baseline"):
        return "baseline"
    return "loom"


def _serialize_status_to_str(status) -> str:
    """Convert structured status (dict with overview + threads/specifics) to a string for prompts."""
    if isinstance(status, str):
        return status
    if not isinstance(status, dict):
        return str(status) if status else ""
    parts = []
    for pt in status.get("overview", []):
        parts.append(f"- {pt}")
    # New threads format
    for thread in status.get("threads", []):
        label = thread.get("label", "Thread")
        steps = thread.get("steps", [])
        step_strs = []
        for s in steps:
            text = s.get("text", s) if isinstance(s, dict) else str(s)
            level = s.get("level", "") if isinstance(s, dict) else ""
            step_strs.append(f"{text} ({level})" if level else text)
        parts.append(f"- Thread: {label}: {' → '.join(step_strs)}")
    # Legacy specifics format
    for item in status.get("specifics", []):
        text = item.get("text", item) if isinstance(item, dict) else str(item)
        level = item.get("level", "") if isinstance(item, dict) else ""
        parts.append(f"- {text} ({level})" if level else f"- {text}")
    return "\n".join(parts) if parts else ""


# ── API Endpoints ────────────────────────────────────────────────────────────


@app.post("/api/auth/login")
async def auth_login(req: AuthRequest):
    """First login sets password; subsequent logins verify it."""
    uid = req.userId.strip()
    if not uid or not req.password.strip():
        raise HTTPException(400, "User ID and password are required.")

    pw_hash = _hash_password(req.password)
    condition = _parse_condition(uid)
    conn = _get_db()
    row = conn.execute("SELECT password_hash FROM users WHERE user_id = ?", (uid,)).fetchone()

    if row is None:
        conn.execute(
            "INSERT INTO users (user_id, password_hash, condition, created_at) VALUES (?,?,?,?)",
            (uid, pw_hash, condition, time.strftime("%Y-%m-%dT%H:%M:%S")),
        )
        conn.commit()
        conn.close()
        return {"ok": True, "condition": condition, "isNew": True}

    conn.close()
    if row[0] != pw_hash:
        raise HTTPException(401, "Incorrect password.")
    return {"ok": True, "condition": condition, "isNew": False}


@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    """Primary chat: get AI response + topic detection + concept extraction."""
    topics_json = json.dumps(
        [{"id": t.id, "name": t.name} for t in req.existingTopics], indent=2
    )
    system_prompt = CHAT_RESPONSE_PROMPT.format(topics_json=topics_json)
    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    attachments = [{"mimeType": a.mimeType, "data": a.data} for a in req.attachments] if req.attachments else None
    result = await llm.chat(
        messages, system_prompt, json_mode=True,
        model=req.model, attachments=attachments, use_search=req.useSearch,
    )
    return result


@app.post("/api/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    """Stream chat response via SSE, then send metadata as final event."""
    topics_json = json.dumps(
        [{"id": t.id, "name": t.name} for t in req.existingTopics], indent=2
    )
    attachments_data = [{"mimeType": a.mimeType, "data": a.data} for a in req.attachments] if req.attachments else None

    # ── Module 2 Debug ───────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("🔗 MODULE 2 CONNECTION RETRIEVAL DEBUG")
    print("=" * 70)
    total_summaries = len(req.allChatSummaries)
    print(f"📥 allChatSummaries received: {total_summaries}")
    for i, s in enumerate(req.allChatSummaries):
        has_emb = "✅" if s.get("embedding") else "❌"
        has_ua = "✅" if s.get("userAsked") else "❌"
        has_ac = "✅" if s.get("aiCovered") else "❌"
        print(f"   [{i}] id={s.get('id','?')[:12]}  title={s.get('title','?')[:30]}  "
              f"emb={has_emb}  userAsked={has_ua}  aiCovered={has_ac}  "
              f"topicId={s.get('topicId','none')}")

    # Retrieve relevant past chats via embedding similarity
    past_chats_for_prompt = []
    candidates_with_embeddings = [
        c for c in req.allChatSummaries if c.get("embedding")
    ]
    print(f"\n🔍 Candidates with embeddings: {len(candidates_with_embeddings)} / {total_summaries}")
    if not candidates_with_embeddings:
        print("   ⚠️  NO candidates have embeddings — memory prompt SKIPPED")

    if candidates_with_embeddings:
        query_text = " ".join(
            m.content for m in req.messages[-3:] if m.role == "user"
        )
        print(f"📝 Query text (last 3 user msgs): \"{query_text[:120]}{'...' if len(query_text) > 120 else ''}\"")
        if not query_text.strip():
            print("   ⚠️  Query text is EMPTY (no user messages) — memory prompt SKIPPED")
        if query_text.strip():
            try:
                query_embedding = await embedder.embed_text(query_text)
                print(f"✅ Query embedding generated (dim={len(query_embedding)})")
                ranked = rank_by_similarity(query_embedding, candidates_with_embeddings)
                print(f"\n📊 Similarity ranking (ALL candidates, no threshold):")
                for j, r in enumerate(ranked):
                    marker = "→ SELECTED" if j < 5 else "  skipped"
                    print(f"   [{j}] score={r['score']:.4f}  id={r['id'][:12]}  "
                          f"title=\"{r.get('title','?')[:35]}\"  {marker}")
                past_chats_for_prompt = []
                for r in ranked[:5]:
                    ua = r.get("userAsked", "")
                    ac = r.get("aiCovered", "")
                    if not ua and not ac:
                        fallback = r.get("summary", "")
                        ua = fallback
                        ac = ""
                    past_chats_for_prompt.append({
                        "chatId": r["id"],
                        "title": r.get("title", ""),
                        "userAsked": ua,
                        "aiCovered": ac,
                    })
            except Exception as e:
                print(f"❌ EMBEDDING ERROR (silently caught): {type(e).__name__}: {e}")

    print(f"\n🧠 Past chats injected into prompt: {len(past_chats_for_prompt)}")
    if req.condition == "baseline" and req.personalDetails:
        details_str = "\n".join(f"- {d}" for d in req.personalDetails)
        prompt_mode = "BASELINE prompt (with user profile)"
        system_prompt = CHAT_STREAM_BASELINE_PROMPT.format(personal_details=details_str)
        print(f"   📋 Baseline profile: {len(req.personalDetails)} details")
    elif req.condition == "baseline":
        prompt_mode = "BASELINE prompt (no profile yet)"
        system_prompt = CHAT_STREAM_SYSTEM_PROMPT
    elif past_chats_for_prompt:
        prompt_mode = "MEMORY prompt (with connections)"
        system_prompt = CHAT_STREAM_MEMORY_PROMPT.format(
            past_chats_json=json.dumps(past_chats_for_prompt, indent=2)
        )
        for pc in past_chats_for_prompt:
            print(f"   • {pc['chatId'][:12]}  \"{pc['title'][:35]}\"")
            if pc['userAsked']:
                print(f"     userAsked: {pc['userAsked'][:60]}")
            if pc['aiCovered']:
                print(f"     aiCovered: {pc['aiCovered'][:60]}")
    else:
        prompt_mode = "STANDARD prompt (no connections)"
        system_prompt = CHAT_STREAM_SYSTEM_PROMPT
    print(f"📤 Prompt mode: {prompt_mode}")
    print("=" * 70)

    async def event_generator():
        full_response_parts = []
        try:
            async for chunk in llm.chat_stream(
                messages=[{"role": m.role, "content": m.content} for m in req.messages],
                system_prompt=system_prompt,
                model=req.model,
                attachments=attachments_data,
                use_search=req.useSearch,
            ):
                full_response_parts.append(chunk)
                yield f"data: {json.dumps({'type': 'chunk', 'text': chunk})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return

        full_response = "".join(full_response_parts)

        # ── Module 2 Response Debug ──────────────────────────────────────
        _markers = re.findall(r'\{~(\d+)\}', full_response)
        _has_conn_block = '{~CONNECTIONS~}' in full_response and '{~END~}' in full_response
        print("\n" + "-" * 70)
        print("🤖 MODULE 2 LLM RESPONSE DEBUG")
        print("-" * 70)
        print(f"📏 Response length: {len(full_response)} chars")
        print(f"🔖 Connection markers found: {_markers if _markers else 'NONE'}")
        print(f"📦 Connection block present: {'✅ YES' if _has_conn_block else '❌ NO'}")
        if _has_conn_block:
            _conn_start = full_response.index('{~CONNECTIONS~}')
            _conn_end = full_response.index('{~END~}')
            _conn_json_str = full_response[_conn_start + len('{~CONNECTIONS~}'):_conn_end].strip()
            try:
                _conn_data = json.loads(_conn_json_str)
                print(f"📋 Connections parsed: {len(_conn_data)} items")
                for _c in _conn_data:
                    print(f"   • id={_c.get('id')}  chatId={_c.get('chatId','?')[:12]}  "
                          f"title=\"{_c.get('chatTitle','?')[:30]}\"")
                    if _c.get('userAsked'):
                        print(f"     userAsked: {_c['userAsked'][:60]}")
                    if _c.get('text'):
                        print(f"     insight: {_c['text'][:60]}")
            except json.JSONDecodeError as _e:
                print(f"   ⚠️  Connection JSON parse error: {_e}")
                print(f"   Raw: {_conn_json_str[:200]}")
        elif _markers:
            print("   ⚠️  Markers exist but no connection block — LLM forgot {~CONNECTIONS~}...{~END~}")
        else:
            print("   ℹ️  LLM chose not to add any connections (or wasn't given memory prompt)")
        print(f"📄 Response preview: \"{full_response[:150]}{'...' if len(full_response) > 150 else ''}\"")
        print("-" * 70 + "\n")

        # Lightweight metadata extraction (topic + concepts)
        try:
            meta_prompt = CHAT_METADATA_PROMPT.format(topics_json=topics_json)
            # Strip connection markers from the response before metadata extraction
            clean_response = full_response
            conn_start = clean_response.find("{~CONNECTIONS~}")
            if conn_start != -1:
                clean_response = clean_response[:conn_start].strip()
            clean_response = re.sub(r'\{~\d+\}', '', clean_response)

            messages_for_meta = [{"role": m.role, "content": m.content} for m in req.messages]
            messages_for_meta.append({"role": "assistant", "content": clean_response})
            metadata = await llm.chat(
                messages_for_meta, meta_prompt, json_mode=True, model=req.model,
            )
        except Exception:
            metadata = {"topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}

        if isinstance(metadata, list):
            metadata = metadata[0] if metadata else {}
        if not isinstance(metadata, dict):
            metadata = {}

        yield f"data: {json.dumps({'type': 'done', 'response': full_response, 'topic': metadata.get('topic', {}), 'concepts': metadata.get('concepts', [])})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/sidebar/refresh")
async def sidebar_refresh(req: SidebarRefreshRequest):
    """Generate sidebar modules (status + directions) in parallel."""
    recent_msgs = req.messages[-6:]
    current_messages_text = "\n".join(
        [f"{m.role}: {m.content}" for m in recent_msgs]
    )

    # Serialize structured status to string for prompts
    topic_status_str = _serialize_status_to_str(req.topicStatus)

    covered_concepts = "\n".join(
        [f"- {c.get('title', '')}: {c.get('preview', '')}" for c in req.allConcepts]
    ) or "None yet."

    directions_prompt = SIDEBAR_NEW_DIRECTIONS_PROMPT.format(
        topic_name=req.topicName,
        topic_status=topic_status_str or "No status yet.",
        covered_concepts=covered_concepts,
        current_summary=current_messages_text[:500],
        previously_suggested="None",
    )

    recent_summaries_text = "\n".join(
        [
            f"- {c.get('title', 'Untitled')}: {c.get('summary', '')}"
            for c in req.allChatSummaries[:5]
        ]
    ) or "No past chats yet."

    status_prompt = STATUS_UPDATE_PROMPT.format(
        topic_name=req.topicName,
        current_status=topic_status_str or "(empty - create fresh)",
        current_messages=current_messages_text or "(none)",
        recent_summaries=recent_summaries_text,
    )

    directions_task = llm.chat(
        [{"role": "user", "content": "Suggest new directions."}],
        directions_prompt,
        json_mode=True,
        model=req.model,
    )
    status_task = llm.chat(
        [{"role": "user", "content": "Update status summary."}],
        status_prompt,
        json_mode=True,
        model=req.model,
    )

    directions_result, status_result = await asyncio.gather(
        directions_task, status_task, return_exceptions=True
    )

    new_directions = []
    if isinstance(directions_result, dict):
        new_directions = directions_result.get("newDirections", [])

    status_update = None
    if isinstance(status_result, dict):
        if "overview" in status_result or "threads" in status_result:
            status_update = status_result
        elif "status" in status_result:
            status_update = status_result.get("status")

    return {
        "newDirections": new_directions,
        "statusUpdate": status_update,
    }


@app.post("/api/chat/summarize")
async def summarize_chat(req: SummarizeRequest):
    """Summarize a conversation when user leaves."""
    messages_text = "\n".join(
        [f"{m.role}: {m.content}" for m in req.messages]
    )
    system_prompt = CHAT_SUMMARIZE_PROMPT.format(messages=messages_text)
    result = await llm.chat(
        [{"role": "user", "content": "Summarize this conversation."}],
        system_prompt,
        json_mode=True,
        model=req.model,
    )
    return result


@app.post("/api/embed")
async def embed_text(req: EmbedRequest):
    """Generate embedding vector for text."""
    embedding = await embedder.embed_text(req.text)
    return {"embedding": embedding}


@app.post("/api/embed/batch")
async def batch_embed(req: BatchEmbedRequest):
    """Batch-embed multiple texts in one call."""
    embeddings = await embedder.embed_texts(req.texts)
    return {"embeddings": embeddings}


@app.post("/api/rank")
async def rank_candidates(req: RankRequest):
    """Rank candidates by cosine similarity. Pure math, no LLM call."""
    ranked = rank_by_similarity(req.queryEmbedding, req.candidates)
    return {"ranked": [{"id": r["id"], "score": r["score"]} for r in ranked]}


@app.post("/api/topic/status/update")
async def update_topic_status(req: StatusUpdateRequest):
    """Incrementally update topic status summary."""
    current = _serialize_status_to_str(req.currentStatus)
    recent_text = "\n".join([f"- {s}" for s in req.recentSummaries]) or "No chats yet."
    system_prompt = STATUS_UPDATE_PROMPT.format(
        topic_name=req.topicName,
        current_status=current or "(empty - create fresh)",
        current_messages="(none)",
        recent_summaries=recent_text,
    )
    result = await llm.chat(
        [{"role": "user", "content": "Update the status."}],
        system_prompt,
        json_mode=True,
        model=req.model,
    )
    return result


@app.post("/api/topic/status/ai-edit")
async def ai_edit_overview(req: OverviewAiEditRequest):
    """Apply a natural-language edit instruction to the overview bullets."""
    current_overview = "\n".join(f"- {pt}" for pt in req.overview) if req.overview else "(empty)"
    system_prompt = OVERVIEW_AI_EDIT_PROMPT.format(
        topic_name=req.topicName,
        current_overview=current_overview,
        instruction=req.instruction,
    )
    try:
        result = await llm.chat(
            [{"role": "user", "content": "Edit the overview."}],
            system_prompt,
            json_mode=True,
            model=req.model,
        )
    except Exception as e:
        raise HTTPException(500, f"LLM error: {str(e)}")
    overview = result.get("overview", req.overview)
    return {"overview": overview}


@app.post("/api/topic/rename-check")
async def topic_rename_check(req: TopicRenameCheckRequest):
    """Check if overview needs updating after a topic rename."""
    if not req.overview:
        return {"needsUpdate": False, "overview": []}
    current_overview = "\n".join(f"- {pt}" for pt in req.overview)
    system_prompt = TOPIC_RENAME_CHECK_PROMPT.format(
        old_name=req.oldName,
        new_name=req.newName,
        current_overview=current_overview,
    )
    try:
        result = await llm.chat(
            [{"role": "user", "content": "Check if overview needs updating."}],
            system_prompt,
            json_mode=True,
            model=req.model,
        )
    except Exception as e:
        raise HTTPException(500, f"LLM error: {str(e)}")
    return {
        "needsUpdate": result.get("needsUpdate", False),
        "overview": result.get("overview", req.overview),
    }


@app.post("/api/topic/detect")
async def detect_topics(req: TopicDetectRequest):
    """Auto-detect topic clusters from unassigned chats."""
    summaries_json = json.dumps(req.chatSummaries, indent=2)
    existing_topics = json.dumps(
        [{"id": t.id, "name": t.name} for t in req.existingTopics], indent=2
    )
    system_prompt = TOPIC_AUTO_DETECT_PROMPT.format(
        summaries_json=summaries_json,
        existing_topics=existing_topics,
    )
    result = await llm.chat(
        [{"role": "user", "content": "Detect topic clusters."}],
        system_prompt,
        json_mode=True,
    )
    return result


# ── Study Logging ─────────────────────────────────────────────────────────────


@app.post("/api/log")
async def log_event(req: LogEvent):
    """Record a study interaction event."""
    ts = req.timestamp or time.strftime("%Y-%m-%dT%H:%M:%S")
    conn = _get_db()
    conn.execute(
        "INSERT INTO events (user_id, condition, event_type, event_data, timestamp) VALUES (?,?,?,?,?)",
        (req.userId, req.condition, req.eventType, json.dumps(req.data), ts),
    )
    conn.commit()
    row_count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    conn.close()
    # Auto-backup every 50 events
    if row_count % 50 == 0:
        _backup_events_to_json()
    return {"ok": True}


def _backup_events_to_json():
    """Write all events to a timestamped JSON backup file."""
    backup_dir = DATA_DIR / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    conn = _get_db()
    rows = conn.execute(
        "SELECT user_id, condition, event_type, event_data, timestamp FROM events ORDER BY id"
    ).fetchall()
    conn.close()
    events = [
        {"userId": r[0], "condition": r[1], "eventType": r[2],
         "data": json.loads(r[3]), "timestamp": r[4]}
        for r in rows
    ]
    ts = time.strftime("%Y%m%d_%H%M%S")
    filepath = backup_dir / f"events_backup_{ts}.json"
    filepath.write_text(json.dumps(events, indent=2))
    # Keep only last 10 backups
    backups = sorted(backup_dir.glob("events_backup_*.json"))
    for old in backups[:-10]:
        old.unlink(missing_ok=True)


# ── Data Sync ─────────────────────────────────────────────────────────────────


@app.post("/api/sync")
async def sync_push(req: SyncRequest):
    """Store a full loom_data blob for a user."""
    conn = _get_db()
    conn.execute(
        "INSERT OR REPLACE INTO user_data (user_id, data, updated_at) VALUES (?,?,?)",
        (req.userId, json.dumps(req.data), time.strftime("%Y-%m-%dT%H:%M:%S")),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/sync")
async def sync_pull(userId: str = Query(...)):
    """Retrieve stored loom_data blob for a user."""
    conn = _get_db()
    row = conn.execute("SELECT data FROM user_data WHERE user_id = ?", (userId,)).fetchone()
    conn.close()
    if row:
        return {"data": json.loads(row[0])}
    return {"data": None}


# ── Directions-Only Endpoint (for shuffle) ────────────────────────────────────


@app.post("/api/sidebar/directions")
async def sidebar_directions(req: DirectionsRequest):
    """Generate only new direction suggestions (for Module 3 shuffle)."""
    topic_status_str = _serialize_status_to_str(req.topicStatus)

    covered_concepts = "\n".join(
        [f"- {c.get('title', '')}: {c.get('preview', '')}" for c in req.allConcepts]
    ) or "None yet."

    previously_suggested_str = ", ".join(req.previouslySuggested) if req.previouslySuggested else "None"

    directions_prompt = SIDEBAR_NEW_DIRECTIONS_PROMPT.format(
        topic_name=req.topicName,
        topic_status=topic_status_str or "No status yet.",
        covered_concepts=covered_concepts,
        current_summary=req.currentSummary[:500],
        previously_suggested=previously_suggested_str,
    )

    result = await llm.chat(
        [{"role": "user", "content": "Suggest new directions."}],
        directions_prompt,
        json_mode=True,
        model=req.model,
    )
    new_directions = []
    if isinstance(result, dict):
        new_directions = result.get("newDirections", [])
    return {"newDirections": new_directions}


# ── Baseline Personal Details Extraction ──────────────────────────────────────


@app.post("/api/baseline/extract")
async def baseline_extract(req: BaselineExtractRequest):
    """Extract personal details from conversation for baseline condition."""
    existing = "\n".join(f"- {d}" for d in req.existingDetails) or "None yet."
    messages_text = "\n".join(f"{m.role}: {m.content}" for m in req.messages[-6:])
    prompt = BASELINE_PERSONAL_DETAILS_PROMPT.format(
        existing_details=existing,
        messages=messages_text,
    )
    result = await llm.chat(
        [{"role": "user", "content": "Extract personal details."}],
        prompt,
        json_mode=True,
        model=req.model,
    )
    details = []
    if isinstance(result, dict):
        details = result.get("details", [])
    return {"details": details}


# ── Admin / Data Export ───────────────────────────────────────────────────────


@app.get("/api/admin/events")
async def admin_events(userId: str = Query(None)):
    """Export logged events (optionally filtered by user)."""
    conn = _get_db()
    if userId:
        rows = conn.execute(
            "SELECT user_id, condition, event_type, event_data, timestamp FROM events WHERE user_id = ? ORDER BY id",
            (userId,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT user_id, condition, event_type, event_data, timestamp FROM events ORDER BY id"
        ).fetchall()
    conn.close()
    return [
        {"userId": r[0], "condition": r[1], "eventType": r[2], "data": json.loads(r[3]), "timestamp": r[4]}
        for r in rows
    ]


@app.get("/api/admin/users")
async def admin_users():
    """List all users who have logged events."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT DISTINCT user_id, condition FROM events ORDER BY user_id"
    ).fetchall()
    conn.close()
    return [{"userId": r[0], "condition": r[1]} for r in rows]


@app.get("/api/admin/backup")
async def admin_backup():
    """Trigger a manual backup and return the file path."""
    _backup_events_to_json()
    return {"ok": True, "backupDir": str(DATA_DIR / "backups")}


@app.get("/api/admin/events/summary")
async def admin_events_summary():
    """Return event counts grouped by user and event_type for quick overview."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT user_id, condition, event_type, COUNT(*) as cnt "
        "FROM events GROUP BY user_id, condition, event_type ORDER BY user_id, event_type"
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    conn.close()
    summary = [
        {"userId": r[0], "condition": r[1], "eventType": r[2], "count": r[3]}
        for r in rows
    ]
    return {"total": total, "summary": summary}


@app.get("/api/admin/export")
async def admin_export():
    """Export all events as downloadable JSON."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT user_id, condition, event_type, event_data, timestamp FROM events ORDER BY id"
    ).fetchall()
    conn.close()
    events = [
        {"userId": r[0], "condition": r[1], "eventType": r[2],
         "data": json.loads(r[3]), "timestamp": r[4]}
        for r in rows
    ]
    return JSONResponse(
        content=events,
        headers={"Content-Disposition": f"attachment; filename=loom_events_{time.strftime('%Y%m%d')}.json"},
    )


# Serve frontend
if FRONTEND_DIR.exists():

    @app.get("/static/{path:path}")
    async def serve_static(path: str):
        file_path = FRONTEND_DIR / path
        if not file_path.exists() or not file_path.is_file():
            return JSONResponse({"error": "not found"}, status_code=404)
        return FileResponse(
            str(file_path),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )

    @app.get("/")
    async def serve_frontend():
        html = (FRONTEND_DIR / "index.html").read_text()
        html = html.replace("__CACHE_VERSION__", STATIC_VERSION)
        return HTMLResponse(
            html,
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
