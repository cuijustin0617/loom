"""Embedding generation and cosine similarity ranking."""

import os
import numpy as np
from typing import Optional

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_EMBED_MODEL = os.getenv("OPENROUTER_EMBED_MODEL", "openai/text-embedding-3-small")


def _openrouter_client():
    from openai import AsyncOpenAI

    return AsyncOpenAI(
        base_url=OPENROUTER_BASE_URL,
        api_key=os.getenv("OPENROUTER_API_KEY"),
        default_headers={
            "HTTP-Referer": os.getenv("OPENROUTER_SITE_URL", "http://localhost:8000"),
            "X-OpenRouter-Title": os.getenv("OPENROUTER_APP_NAME", "Loom"),
        },
    )


class EmbeddingService:
    def __init__(self, provider: Optional[str] = None):
        self.provider = provider or os.getenv("EMBEDDING_PROVIDER", "openrouter")

    async def embed_text(self, text: str) -> list[float]:
        if self.provider == "openai":
            return await self._openai_embed(text)
        elif self.provider == "openrouter":
            return await self._openrouter_embed(text)
        elif self.provider == "gemini":
            return await self._gemini_embed(text)
        else:
            raise ValueError(f"Unknown embedding provider: {self.provider}")

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Batch-embed multiple texts. Uses native batch API when available."""
        if not texts:
            return []
        if self.provider == "openai":
            return await self._openai_embed_batch(texts)
        elif self.provider == "openrouter":
            return await self._openrouter_embed_batch(texts)
        elif self.provider == "gemini":
            return [await self._gemini_embed(t) for t in texts]
        else:
            raise ValueError(f"Unknown embedding provider: {self.provider}")

    async def _openai_embed(self, text: str) -> list[float]:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = await client.embeddings.create(
            model="text-embedding-3-small", input=text
        )
        return response.data[0].embedding

    async def _openai_embed_batch(self, texts: list[str]) -> list[list[float]]:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = await client.embeddings.create(
            model="text-embedding-3-small", input=texts
        )
        idx_emb = sorted(response.data, key=lambda d: d.index)
        return [d.embedding for d in idx_emb]

    async def _openrouter_embed(self, text: str) -> list[float]:
        import httpx, json as _json
        api_key = os.getenv("OPENROUTER_API_KEY", "")
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{OPENROUTER_BASE_URL}/embeddings",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "HTTP-Referer": os.getenv("OPENROUTER_SITE_URL", "http://localhost:8000"),
                    "X-OpenRouter-Title": os.getenv("OPENROUTER_APP_NAME", "Loom"),
                    "Content-Type": "application/json",
                },
                content=_json.dumps({"model": OPENROUTER_EMBED_MODEL, "input": text}),
            )
        resp.raise_for_status()
        body = resp.json()
        return body["data"][0]["embedding"]

    async def _openrouter_embed_batch(self, texts: list[str]) -> list[list[float]]:
        import httpx, json as _json
        api_key = os.getenv("OPENROUTER_API_KEY", "")
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{OPENROUTER_BASE_URL}/embeddings",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "HTTP-Referer": os.getenv("OPENROUTER_SITE_URL", "http://localhost:8000"),
                    "X-OpenRouter-Title": os.getenv("OPENROUTER_APP_NAME", "Loom"),
                    "Content-Type": "application/json",
                },
                content=_json.dumps({"model": OPENROUTER_EMBED_MODEL, "input": texts}),
            )
        resp.raise_for_status()
        body = resp.json()
        # Some models return data as list; fall back to sequential if not
        if body.get("data") and isinstance(body["data"], list):
            items = sorted(body["data"], key=lambda d: d.get("index", 0))
            return [d["embedding"] for d in items]
        # Model doesn't support batch — embed sequentially
        return [await self._openrouter_embed(t) for t in texts]

    async def _gemini_embed(self, text: str) -> list[float]:
        from google import genai

        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        result = await client.aio.models.embed_content(
            model="gemini-embedding-001", contents=text
        )
        return list(result.embeddings[0].values)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    a_arr = np.array(a, dtype=np.float64)
    b_arr = np.array(b, dtype=np.float64)
    norm_a = np.linalg.norm(a_arr)
    norm_b = np.linalg.norm(b_arr)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a_arr, b_arr) / (norm_a * norm_b))


def rank_by_similarity(
    query_embedding: list[float],
    candidates: list[dict],
) -> list[dict]:
    """Rank candidates by cosine similarity to query.

    Each candidate must have an 'id' and 'embedding' field.
    Returns candidates sorted by similarity score descending, with 'score' added.
    """
    query_dim = len(query_embedding)
    results = []
    for candidate in candidates:
        emb = candidate.get("embedding")
        if not emb or len(emb) != query_dim:
            continue
        score = cosine_similarity(query_embedding, emb)
        results.append({**candidate, "score": score})
    results.sort(key=lambda x: x["score"], reverse=True)
    return results
