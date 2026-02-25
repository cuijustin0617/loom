"""Comprehensive tests for embeddings.py – cosine similarity, ranking, and service."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import math
import numpy as np
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from embeddings import cosine_similarity, rank_by_similarity, EmbeddingService


# ── cosine_similarity ─────────────────────────────────────────────────────────

class TestCosineSimilarity:
    def test_identical_vectors(self):
        v = [1.0, 2.0, 3.0]
        assert cosine_similarity(v, v) == pytest.approx(1.0)

    def test_orthogonal_vectors(self):
        assert cosine_similarity([1, 0, 0], [0, 1, 0]) == pytest.approx(0.0)

    def test_opposite_vectors(self):
        assert cosine_similarity([1, 2, 3], [-1, -2, -3]) == pytest.approx(-1.0)

    def test_zero_vector_a(self):
        assert cosine_similarity([0, 0], [1, 2]) == 0.0

    def test_zero_vector_b(self):
        assert cosine_similarity([1, 2], [0, 0]) == 0.0

    def test_both_zero(self):
        assert cosine_similarity([0, 0], [0, 0]) == 0.0

    def test_known_angle_45_degrees(self):
        expected = 1.0 / math.sqrt(2)
        assert cosine_similarity([1, 0], [1, 1]) == pytest.approx(expected, abs=1e-7)

    def test_single_dimension(self):
        assert cosine_similarity([5.0], [3.0]) == pytest.approx(1.0)

    def test_negative_single_dimension(self):
        assert cosine_similarity([5.0], [-3.0]) == pytest.approx(-1.0)

    def test_high_dimensional_1536(self):
        np.random.seed(42)
        a = np.random.randn(1536).tolist()
        b = np.random.randn(1536).tolist()
        result = cosine_similarity(a, b)
        assert -1.0 <= result <= 1.0

    def test_returns_float(self):
        result = cosine_similarity([1.0, 2.0], [3.0, 4.0])
        assert isinstance(result, float)

    def test_unit_vectors(self):
        a = [1.0 / math.sqrt(2), 1.0 / math.sqrt(2)]
        b = [1.0, 0.0]
        expected = 1.0 / math.sqrt(2)
        assert cosine_similarity(a, b) == pytest.approx(expected, abs=1e-7)

    def test_very_small_values(self):
        a = [1e-10, 1e-10]
        b = [1e-10, 1e-10]
        assert cosine_similarity(a, b) == pytest.approx(1.0, abs=1e-5)

    def test_very_large_values(self):
        a = [1e10, 1e10]
        b = [1e10, 1e10]
        assert cosine_similarity(a, b) == pytest.approx(1.0, abs=1e-5)

    def test_mixed_positive_negative(self):
        a = [1.0, -1.0, 1.0]
        b = [-1.0, 1.0, -1.0]
        assert cosine_similarity(a, b) == pytest.approx(-1.0)

    def test_integer_inputs(self):
        result = cosine_similarity([1, 0, 0], [1, 0, 0])
        assert result == pytest.approx(1.0)

    def test_partial_overlap(self):
        a = [1.0, 1.0, 0.0]
        b = [1.0, 0.0, 1.0]
        expected = 1.0 / 2.0  # dot=1, norms=sqrt(2)*sqrt(2)=2
        assert cosine_similarity(a, b) == pytest.approx(expected)

    def test_symmetry(self):
        a = [3.0, 4.0, 5.0]
        b = [1.0, -2.0, 3.0]
        assert cosine_similarity(a, b) == pytest.approx(cosine_similarity(b, a))

    def test_scaled_vectors_same_direction(self):
        a = [1.0, 2.0, 3.0]
        b = [100.0, 200.0, 300.0]
        assert cosine_similarity(a, b) == pytest.approx(1.0)

    def test_four_dimensional(self):
        a = [1.0, 0.0, 0.0, 0.0]
        b = [0.0, 0.0, 0.0, 1.0]
        assert cosine_similarity(a, b) == pytest.approx(0.0)


# ── rank_by_similarity ────────────────────────────────────────────────────────

class TestRankBySimilarity:
    def test_basic_ranking(self):
        query = [1.0, 0.0, 0.0]
        candidates = [
            {"id": "a", "embedding": [0.0, 1.0, 0.0]},
            {"id": "b", "embedding": [1.0, 0.0, 0.0]},
            {"id": "c", "embedding": [0.5, 0.5, 0.0]},
        ]
        result = rank_by_similarity(query, candidates)
        assert result[0]["id"] == "b"
        assert result[0]["score"] == pytest.approx(1.0)

    def test_returns_all_valid_candidates(self):
        query = [1.0, 0.0]
        candidates = [
            {"id": "a", "embedding": [1.0, 0.0]},
            {"id": "b", "embedding": [0.0, 1.0]},
        ]
        assert len(rank_by_similarity(query, candidates)) == 2

    def test_empty_candidates(self):
        assert rank_by_similarity([1.0, 0.0], []) == []

    def test_candidates_without_embeddings(self):
        candidates = [{"id": "a"}, {"id": "b", "embedding": None}, {"id": "c", "embedding": []}]
        assert len(rank_by_similarity([1.0], candidates)) == 0

    def test_mixed_valid_invalid_candidates(self):
        query = [1.0, 0.0]
        candidates = [
            {"id": "a", "embedding": [1.0, 0.0]},
            {"id": "b"},
            {"id": "c", "embedding": [0.5, 0.5]},
        ]
        result = rank_by_similarity(query, candidates)
        assert len(result) == 2
        assert result[0]["id"] == "a"

    def test_preserves_extra_fields(self):
        query = [1.0, 0.0]
        candidates = [{"id": "a", "embedding": [1.0, 0.0], "title": "Test", "extra": 42}]
        result = rank_by_similarity(query, candidates)
        assert result[0]["title"] == "Test"
        assert result[0]["extra"] == 42
        assert "score" in result[0]

    def test_descending_order(self):
        query = [1.0, 0.0]
        candidates = [
            {"id": "low", "embedding": [0.0, 1.0]},
            {"id": "mid", "embedding": [0.7, 0.7]},
            {"id": "high", "embedding": [1.0, 0.1]},
        ]
        result = rank_by_similarity(query, candidates)
        scores = [r["score"] for r in result]
        assert scores == sorted(scores, reverse=True)

    def test_score_is_float(self):
        result = rank_by_similarity([1.0, 0.0], [{"id": "a", "embedding": [0.5, 0.5]}])
        assert isinstance(result[0]["score"], float)

    def test_single_candidate(self):
        result = rank_by_similarity([1.0, 0.0], [{"id": "only", "embedding": [0.5, 0.5]}])
        assert len(result) == 1
        assert result[0]["id"] == "only"

    def test_all_same_embedding(self):
        query = [1.0, 0.0]
        candidates = [
            {"id": "a", "embedding": [0.5, 0.5]},
            {"id": "b", "embedding": [0.5, 0.5]},
            {"id": "c", "embedding": [0.5, 0.5]},
        ]
        result = rank_by_similarity(query, candidates)
        assert len(result) == 3
        assert all(r["score"] == pytest.approx(result[0]["score"]) for r in result)

    def test_large_candidate_list(self):
        query = [1.0, 0.0]
        candidates = [{"id": str(i), "embedding": [float(i % 2), float((i + 1) % 2)]} for i in range(100)]
        result = rank_by_similarity(query, candidates)
        assert len(result) == 100

    def test_negative_scores(self):
        query = [1.0, 0.0]
        candidates = [
            {"id": "pos", "embedding": [1.0, 0.0]},
            {"id": "neg", "embedding": [-1.0, 0.0]},
        ]
        result = rank_by_similarity(query, candidates)
        assert result[0]["id"] == "pos"
        assert result[0]["score"] == pytest.approx(1.0)
        assert result[1]["id"] == "neg"
        assert result[1]["score"] == pytest.approx(-1.0)

    def test_does_not_mutate_original(self):
        query = [1.0, 0.0]
        candidates = [{"id": "a", "embedding": [1.0, 0.0]}]
        original_id = candidates[0]["id"]
        rank_by_similarity(query, candidates)
        assert candidates[0]["id"] == original_id
        assert "score" not in candidates[0]


# ── EmbeddingService ──────────────────────────────────────────────────────────

class TestEmbeddingServiceInit:
    def test_default_provider(self):
        import os
        os.environ.pop("EMBEDDING_PROVIDER", None)
        svc = EmbeddingService()
        assert svc.provider == "openai"

    def test_custom_provider(self):
        assert EmbeddingService(provider="gemini").provider == "gemini"

    def test_env_provider(self):
        import os
        os.environ["EMBEDDING_PROVIDER"] = "gemini"
        svc = EmbeddingService()
        assert svc.provider == "gemini"
        os.environ.pop("EMBEDDING_PROVIDER", None)

    @pytest.mark.asyncio
    async def test_unknown_provider_raises(self):
        svc = EmbeddingService(provider="unknown")
        with pytest.raises(ValueError, match="Unknown embedding provider"):
            await svc.embed_text("test")


class TestEmbeddingServiceOpenAI:
    @pytest.mark.asyncio
    async def test_openai_embed_returns_list(self):
        svc = EmbeddingService(provider="openai")
        mock_response = MagicMock()
        mock_response.data = [MagicMock()]
        mock_response.data[0].embedding = [0.1, 0.2, 0.3]

        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            instance.embeddings.create = AsyncMock(return_value=mock_response)
            result = await svc.embed_text("hello world")
            assert result == [0.1, 0.2, 0.3]

    @pytest.mark.asyncio
    async def test_openai_embed_calls_correct_model(self):
        svc = EmbeddingService(provider="openai")
        mock_response = MagicMock()
        mock_response.data = [MagicMock()]
        mock_response.data[0].embedding = [0.1]

        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            mock_create = AsyncMock(return_value=mock_response)
            instance.embeddings.create = mock_create
            await svc.embed_text("test")
            call_args = mock_create.call_args
            assert call_args.kwargs.get("model") == "text-embedding-3-small" or \
                   call_args[1].get("model") == "text-embedding-3-small"


class TestEmbeddingServiceGemini:
    @pytest.mark.asyncio
    async def test_gemini_embed_returns_list(self):
        svc = EmbeddingService(provider="gemini")
        mock_embedding = MagicMock()
        mock_embedding.values = [0.4, 0.5, 0.6]
        mock_resp = MagicMock()
        mock_resp.embeddings = [mock_embedding]
        mock_client = MagicMock()
        mock_client.aio.models.embed_content = AsyncMock(return_value=mock_resp)

        with patch("google.genai.Client", return_value=mock_client):
            result = await svc.embed_text("hello world")
            assert result == [0.4, 0.5, 0.6]

    @pytest.mark.asyncio
    async def test_gemini_embed_calls_correct_model(self):
        svc = EmbeddingService(provider="gemini")
        mock_embedding = MagicMock()
        mock_embedding.values = [0.1]
        mock_resp = MagicMock()
        mock_resp.embeddings = [mock_embedding]
        mock_client = MagicMock()
        mock_client.aio.models.embed_content = AsyncMock(return_value=mock_resp)

        with patch("google.genai.Client", return_value=mock_client):
            await svc.embed_text("test")
            call_kwargs = mock_client.aio.models.embed_content.call_args.kwargs
            assert call_kwargs.get("model") == "text-embedding-004"
