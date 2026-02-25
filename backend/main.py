"""Loom Knowledge Sidebar - FastAPI Backend."""

import os
import time
import asyncio
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
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
    CHAT_METADATA_PROMPT,
    SIDEBAR_BRIDGE_QUESTIONS_PROMPT,
    SIDEBAR_NEW_DIRECTIONS_PROMPT,
    STATUS_UPDATE_PROMPT,
    CHAT_SUMMARIZE_PROMPT,
    TOPIC_AUTO_DETECT_PROMPT,
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

llm = LLMRouter()
embedder = EmbeddingService()


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


# ── API Endpoints ────────────────────────────────────────────────────────────


@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    """Primary chat: get AI response + topic detection + concept extraction."""
    import json

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
    import json as _json

    topics_json = _json.dumps(
        [{"id": t.id, "name": t.name} for t in req.existingTopics], indent=2
    )
    attachments = [{"mimeType": a.mimeType, "data": a.data} for a in req.attachments] if req.attachments else None

    async def event_generator():
        full_response_parts = []
        try:
            async for chunk in llm.chat_stream(
                messages=[{"role": m.role, "content": m.content} for m in req.messages],
                system_prompt=CHAT_STREAM_SYSTEM_PROMPT,
                model=req.model,
                attachments=attachments,
                use_search=req.useSearch,
            ):
                full_response_parts.append(chunk)
                yield f"data: {_json.dumps({'type': 'chunk', 'text': chunk})}\n\n"
        except Exception as e:
            yield f"data: {_json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return

        full_response = "".join(full_response_parts)

        # Lightweight metadata extraction (topic + concepts)
        try:
            meta_prompt = CHAT_METADATA_PROMPT.format(topics_json=topics_json)
            messages_for_meta = [{"role": m.role, "content": m.content} for m in req.messages]
            messages_for_meta.append({"role": "assistant", "content": full_response})
            metadata = await llm.chat(
                messages_for_meta, meta_prompt, json_mode=True, model=req.model,
            )
        except Exception:
            metadata = {"topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}

        yield f"data: {_json.dumps({'type': 'done', 'response': full_response, 'topic': metadata.get('topic', {}), 'concepts': metadata.get('concepts', [])})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/sidebar/refresh")
async def sidebar_refresh(req: SidebarRefreshRequest):
    """Generate all 3 sidebar modules in parallel."""
    import json

    recent_msgs = req.messages[-6:]
    current_messages_text = "\n".join(
        [f"{m.role}: {m.content}" for m in recent_msgs]
    )

    query_text = " ".join([m.content for m in recent_msgs[-3:]])

    # Fast path: rank past chats by embedding similarity
    ranked_items = []
    candidates_with_embeddings = [
        c for c in req.allChatSummaries if c.get("embedding")
    ]
    if candidates_with_embeddings and query_text.strip():
        try:
            query_embedding = await embedder.embed_text(query_text)
            ranked_items = rank_by_similarity(query_embedding, candidates_with_embeddings)
            ranked_items = ranked_items[:8]
        except Exception:
            ranked_items = req.allChatSummaries[:5]
    else:
        ranked_items = req.allChatSummaries[:5]

    # Strip embeddings before passing to LLM (saves tokens)
    combined_ranked = []
    for item in ranked_items[:5]:
        combined_ranked.append({
            k: v for k, v in item.items() if k != "embedding"
        })
    for concept in req.allConcepts[:3]:
        combined_ranked.append(
            {
                "type": "concept",
                "id": concept.get("id", ""),
                "title": concept.get("title", ""),
                "preview": concept.get("preview", ""),
            }
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

    # Parallel LLM calls for bridge questions, new directions, and status update
    bridge_prompt = SIDEBAR_BRIDGE_QUESTIONS_PROMPT.format(
        current_messages=current_messages_text,
        topic_name=req.topicName,
        topic_status=topic_status_str or "No status yet.",
        ranked_items_json=json.dumps(combined_ranked[:5], indent=2),
    )

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
        recent_summaries=recent_summaries_text,
    )

    bridge_task = llm.chat(
        [{"role": "user", "content": "Generate related cards."}],
        bridge_prompt,
        json_mode=True,
        model=req.model,
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

    bridge_result, directions_result, status_result = await asyncio.gather(
        bridge_task, directions_task, status_task, return_exceptions=True
    )

    related_cards = []
    if isinstance(bridge_result, dict):
        related_cards = bridge_result.get("relatedCards", [])
    elif isinstance(bridge_result, Exception):
        print(f"[sidebar] bridge LLM failed: {bridge_result}")

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
        "relatedCards": related_cards,
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
    import json

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
