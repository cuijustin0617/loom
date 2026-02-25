"""Embedding generation and cosine similarity ranking."""

import os
import numpy as np
from typing import Optional


class EmbeddingService:
    def __init__(self, provider: Optional[str] = None):
        self.provider = provider or os.getenv("EMBEDDING_PROVIDER", "openai")

    async def embed_text(self, text: str) -> list[float]:
        if self.provider == "openai":
            return await self._openai_embed(text)
        elif self.provider == "gemini":
            return await self._gemini_embed(text)
        else:
            raise ValueError(f"Unknown embedding provider: {self.provider}")

    async def _openai_embed(self, text: str) -> list[float]:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = await client.embeddings.create(
            model="text-embedding-3-small", input=text
        )
        return response.data[0].embedding

    async def _gemini_embed(self, text: str) -> list[float]:
        from google import genai

        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        result = await client.aio.models.embed_content(
            model="text-embedding-004", contents=text
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
    results = []
    for candidate in candidates:
        emb = candidate.get("embedding")
        if not emb:
            continue
        score = cosine_similarity(query_embedding, emb)
        results.append({**candidate, "score": score})
    results.sort(key=lambda x: x["score"], reverse=True)
    return results
