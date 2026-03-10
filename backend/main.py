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


class RankRequest(BaseModel):
    queryEmbedding: list[float]
    candidates: list[dict]


class StatusUpdateRequest(BaseModel):
    topicName: str
    currentStatus: Union[str, dict] = ""
    recentSummaries: list[str] = []
    model: str | None = None


class TopicDetectRequest(BaseModel):
    chatSummaries: list[dict] = []
    existingTopics: list[TopicItem] = []


class DirectionsRequest(BaseModel):
    topicName: str
    topicStatus: Union[str, dict] = ""
    allConcepts: list[dict] = []
    currentSummary: str = ""
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
    topic_status_str = req.topicStatus
    if isinstance(topic_status_str, dict):
        parts = []
        for pt in topic_status_str.get("overview", []):
            parts.append(f"- {pt}")
        for item in topic_status_str.get("specifics", []):
            text = item.get("text", item) if isinstance(item, dict) else str(item)
            level = item.get("level", "") if isinstance(item, dict) else ""
            parts.append(f"- {text} ({level})" if level else f"- {text}")
        topic_status_str = "\n".join(parts) if parts else ""

    covered_concepts = "\n".join(
        [f"- {c.get('title', '')}: {c.get('preview', '')}" for c in req.allConcepts]
    ) or "None yet."

    directions_prompt = SIDEBAR_NEW_DIRECTIONS_PROMPT.format(
        topic_name=req.topicName,
        topic_status=topic_status_str or "No status yet.",
        covered_concepts=covered_concepts,
        current_summary=current_messages_text[:500],
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
        if "overview" in status_result:
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


@app.post("/api/rank")
async def rank_candidates(req: RankRequest):
    """Rank candidates by cosine similarity. Pure math, no LLM call."""
    ranked = rank_by_similarity(req.queryEmbedding, req.candidates)
    return {"ranked": [{"id": r["id"], "score": r["score"]} for r in ranked]}


@app.post("/api/topic/status/update")
async def update_topic_status(req: StatusUpdateRequest):
    """Incrementally update topic status summary."""
    current = req.currentStatus
    if isinstance(current, dict):
        parts = []
        for pt in current.get("overview", []):
            parts.append(f"- {pt}")
        for item in current.get("specifics", []):
            text = item.get("text", item) if isinstance(item, dict) else str(item)
            level = item.get("level", "") if isinstance(item, dict) else ""
            parts.append(f"- {text} ({level})" if level else f"- {text}")
        current = "\n".join(parts) if parts else ""
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
    conn.close()
    return {"ok": True}


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
    topic_status_str = req.topicStatus
    if isinstance(topic_status_str, dict):
        parts = []
        for pt in topic_status_str.get("overview", []):
            parts.append(f"- {pt}")
        for item in topic_status_str.get("specifics", []):
            text = item.get("text", item) if isinstance(item, dict) else str(item)
            level = item.get("level", "") if isinstance(item, dict) else ""
            parts.append(f"- {text} ({level})" if level else f"- {text}")
        topic_status_str = "\n".join(parts) if parts else ""

    covered_concepts = "\n".join(
        [f"- {c.get('title', '')}: {c.get('preview', '')}" for c in req.allConcepts]
    ) or "None yet."

    directions_prompt = SIDEBAR_NEW_DIRECTIONS_PROMPT.format(
        topic_name=req.topicName,
        topic_status=topic_status_str or "No status yet.",
        covered_concepts=covered_concepts,
        current_summary=req.currentSummary[:500],
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
