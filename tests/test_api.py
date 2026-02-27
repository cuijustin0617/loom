"""Comprehensive tests for main.py – all API endpoints with mocked LLM."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient


def _get_client():
    from main import app
    return TestClient(app)


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/chat
# ═══════════════════════════════════════════════════════════════════════════════

class TestChatBasic:
    def test_basic_response(self):
        mock_result = {
            "response": "Vanishing gradients occur when...",
            "topic": {"name": "Machine Learning", "matchedExistingId": None, "confidence": 0.95},
            "concepts": [{"title": "Vanishing Gradients", "preview": "Why deep nets fail"}],
        }
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "What are vanishing gradients?"}],
                "existingTopics": [], "existingConcepts": [],
            })
            assert resp.status_code == 200
            assert resp.json()["response"] == "Vanishing gradients occur when..."

    def test_topic_detection_returned(self):
        mock_result = {
            "response": "Answer",
            "topic": {"name": "ML", "matchedExistingId": "t1", "confidence": 0.9},
            "concepts": [],
        }
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            data = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "q"}],
                "existingTopics": [{"id": "t1", "name": "ML"}], "existingConcepts": [],
            }).json()
            assert data["topic"]["matchedExistingId"] == "t1"

    def test_concepts_extraction(self):
        mock_result = {
            "response": "Answer",
            "topic": {"name": "ML", "matchedExistingId": None, "confidence": 0.5},
            "concepts": [
                {"title": "Backpropagation", "preview": "How neural nets learn"},
                {"title": "Gradient Descent", "preview": "Optimization algorithm"},
            ],
        }
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            data = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "q"}],
                "existingTopics": [], "existingConcepts": [],
            }).json()
            assert len(data["concepts"]) == 2

    def test_multi_turn_conversation(self):
        mock_result = {"response": "Follow up", "topic": {"name": "ML", "matchedExistingId": None, "confidence": 0.8}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat", json={
                "chatId": "c1",
                "messages": [
                    {"role": "user", "content": "q1"},
                    {"role": "assistant", "content": "a1"},
                    {"role": "user", "content": "q2"},
                ],
                "existingTopics": [], "existingConcepts": [],
            })
            assert resp.status_code == 200

    def test_empty_messages(self):
        mock_result = {"response": "", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [], "existingTopics": [], "existingConcepts": [],
            })
            assert resp.status_code == 200

    def test_many_existing_topics(self):
        topics = [{"id": f"t{i}", "name": f"Topic {i}"} for i in range(20)]
        mock_result = {"response": "ok", "topic": {"name": "Topic 5", "matchedExistingId": "t5", "confidence": 0.99}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            data = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "q"}],
                "existingTopics": topics, "existingConcepts": [],
            }).json()
            assert data["topic"]["matchedExistingId"] == "t5"

    def test_existing_concepts_passed(self):
        mock_result = {"response": "ok", "topic": {"name": "T", "matchedExistingId": None, "confidence": 0.5}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "q"}],
                "existingTopics": [],
                "existingConcepts": [{"id": "con1", "topicId": "t1", "title": "ReLU", "preview": "Activation function"}],
            })
            assert resp.status_code == 200

    def test_long_message_content(self):
        long_msg = "x" * 5000
        mock_result = {"response": "ok", "topic": {"name": "T", "matchedExistingId": None, "confidence": 0.5}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": long_msg}],
                "existingTopics": [], "existingConcepts": [],
            })
            assert resp.status_code == 200

    def test_special_characters_in_message(self):
        mock_result = {"response": "ok", "topic": {"name": "T", "matchedExistingId": None, "confidence": 0.5}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "Hello 你好 <script>alert('xss')</script>"}],
                "existingTopics": [], "existingConcepts": [],
            })
            assert resp.status_code == 200

    def test_llm_called_with_correct_messages(self):
        mock_result = {"response": "ok", "topic": {"name": "T", "matchedExistingId": None, "confidence": 0.5}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/chat", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hello"}],
                "existingTopics": [], "existingConcepts": [],
            })
            call_args = m.chat.call_args
            messages_arg = call_args[0][0]
            assert messages_arg[0]["role"] == "user"
            assert messages_arg[0]["content"] == "hello"


class TestChatValidation:
    def test_missing_messages_returns_422(self):
        assert _get_client().post("/api/chat", json={"chatId": "c1"}).status_code == 422

    def test_missing_chatId_returns_422(self):
        assert _get_client().post("/api/chat", json={"messages": []}).status_code == 422

    def test_invalid_message_format_returns_422(self):
        resp = _get_client().post("/api/chat", json={
            "chatId": "c1", "messages": [{"wrong": "field"}],
            "existingTopics": [], "existingConcepts": [],
        })
        assert resp.status_code == 422

    def test_empty_body_returns_422(self):
        assert _get_client().post("/api/chat", json={}).status_code == 422

    def test_no_body_returns_422(self):
        resp = _get_client().post("/api/chat")
        assert resp.status_code == 422

    def test_extra_fields_ignored(self):
        mock_result = {"response": "ok", "topic": {"name": "T", "matchedExistingId": None, "confidence": 0.5}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "q"}],
                "existingTopics": [], "existingConcepts": [], "extraField": "ignored",
            })
            assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/sidebar/refresh
# ═══════════════════════════════════════════════════════════════════════════════

class TestSidebarRefreshBasic:
    def _mock_calls(self, bridge=None, directions=None, status=None):
        bridge = bridge or {"relatedCards": []}
        directions = directions or {"newDirections": []}
        status = status or {"status": "Updated"}

        async def side_effect(*args, **kwargs):
            msg = args[0][0]["content"] if args[0] else ""
            if "related" in msg.lower() or "Generate" in msg:
                return bridge
            elif "direction" in msg.lower() or "Suggest" in msg:
                return directions
            elif "status" in msg.lower() or "Update" in msg:
                return status
            return bridge

        return side_effect

    def test_returns_all_three_modules(self):
        bridge = {"relatedCards": [{"sourceType": "chat", "sourceId": "c1", "sourceTitle": "SVM", "bridgeQuestion": "How?"}]}
        directions = {"newDirections": [{"title": "Kernels", "question": "What?"}]}
        status = {"status": "Learning ML."}

        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(side_effect=self._mock_calls(bridge, directions, status))
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            data = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "What is backprop?"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "Learning",
                "allChatSummaries": [], "allConcepts": [],
            }).json()
            assert "relatedCards" in data
            assert "newDirections" in data
            assert "statusUpdate" in data

    def test_with_embedding_ranking(self):
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value={"relatedCards": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            resp = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "",
                "allChatSummaries": [{"id": "c2", "title": "Old", "summary": "SVMs", "embedding": [0.4] * 10}],
                "allConcepts": [],
            })
            assert resp.status_code == 200

    def test_handles_llm_errors_gracefully(self):
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(side_effect=Exception("LLM down"))
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            data = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "status",
                "allChatSummaries": [], "allConcepts": [],
            }).json()
            assert data["relatedCards"] == []
            assert data["newDirections"] == []

    def test_empty_topic_status(self):
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value={"relatedCards": [], "newDirections": [], "status": "Fresh"})
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            resp = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "",
                "allChatSummaries": [], "allConcepts": [],
            })
            assert resp.status_code == 200

    def test_with_concepts(self):
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value={"relatedCards": []})
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            resp = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "Learning",
                "allChatSummaries": [],
                "allConcepts": [
                    {"id": "con1", "title": "ReLU", "preview": "Activation"},
                    {"id": "con2", "title": "Dropout", "preview": "Regularization"},
                ],
            })
            assert resp.status_code == 200

    def test_many_messages_truncated(self):
        msgs = [{"role": "user", "content": f"msg {i}"} for i in range(20)]
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value={"relatedCards": []})
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            resp = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": msgs,
                "topicId": "t1", "topicName": "ML", "topicStatus": "",
                "allChatSummaries": [], "allConcepts": [],
            })
            assert resp.status_code == 200

    def test_embedding_failure_falls_back(self):
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value={"relatedCards": []})
            emb.embed_text = AsyncMock(side_effect=Exception("embed fail"))
            resp = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "",
                "allChatSummaries": [{"id": "c2", "title": "X", "summary": "Y", "embedding": [0.5] * 10}],
                "allConcepts": [],
            })
            assert resp.status_code == 200

    def test_strips_embeddings_from_bridge_prompt(self):
        """Embeddings should not be passed to the LLM prompt."""
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value={"relatedCards": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "",
                "allChatSummaries": [{"id": "c2", "title": "X", "summary": "Y", "embedding": [0.5] * 1536}],
                "allConcepts": [],
            })
            # The system prompt passed to bridge call should not contain "embedding"
            first_call = m.chat.call_args_list[0]
            system_prompt = first_call[0][1] if len(first_call[0]) > 1 else first_call[1].get("system_prompt", "")
            assert "[0.5" not in system_prompt[:5000]

    def test_with_many_chat_summaries(self):
        summaries = [{"id": f"c{i}", "title": f"Chat {i}", "summary": f"Summary {i}", "embedding": [float(i) * 0.1] * 10} for i in range(20)]
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value={"relatedCards": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            resp = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "",
                "allChatSummaries": summaries, "allConcepts": [],
            })
            assert resp.status_code == 200

    def test_partial_llm_failure(self):
        """If one of the parallel LLM calls fails, others should still return."""
        call_count = 0
        async def partial_fail(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return {"relatedCards": [{"sourceType": "chat", "sourceId": "c1", "sourceTitle": "X", "bridgeQuestion": "Q"}]}
            elif call_count == 2:
                raise Exception("fail")
            else:
                return {"status": "ok"}

        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(side_effect=partial_fail)
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            data = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "s",
                "allChatSummaries": [], "allConcepts": [],
            }).json()
            assert isinstance(data["relatedCards"], list)
            assert isinstance(data["statusUpdate"], str)


class TestSidebarRefreshValidation:
    def test_missing_topicId_returns_422(self):
        resp = _get_client().post("/api/sidebar/refresh", json={
            "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
            "topicName": "ML",
        })
        assert resp.status_code == 422

    def test_missing_topicName_returns_422(self):
        resp = _get_client().post("/api/sidebar/refresh", json={
            "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
            "topicId": "t1",
        })
        assert resp.status_code == 422

    def test_missing_messages_returns_422(self):
        resp = _get_client().post("/api/sidebar/refresh", json={
            "chatId": "c1", "topicId": "t1", "topicName": "ML",
        })
        assert resp.status_code == 422


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/chat/summarize
# ═══════════════════════════════════════════════════════════════════════════════

class TestSummarize:
    def test_basic_summarization(self):
        mock_result = {"title": "Vanishing Gradients", "summary": "Discussed why gradients vanish."}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            data = _get_client().post("/api/chat/summarize", json={
                "messages": [
                    {"role": "user", "content": "What are vanishing gradients?"},
                    {"role": "assistant", "content": "They occur when..."},
                ],
            }).json()
            assert data["title"] == "Vanishing Gradients"

    def test_single_message(self):
        mock_result = {"title": "Quick Q", "summary": "Short question."}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat/summarize", json={
                "messages": [{"role": "user", "content": "Hello"}],
            })
            assert resp.status_code == 200

    def test_empty_messages(self):
        mock_result = {"title": "Empty", "summary": ""}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat/summarize", json={"messages": []})
            assert resp.status_code == 200

    def test_long_conversation(self):
        msgs = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"Message {i}"} for i in range(50)]
        mock_result = {"title": "Long Chat", "summary": "A long conversation."}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat/summarize", json={"messages": msgs})
            assert resp.status_code == 200

    def test_messages_with_context_blocks(self):
        mock_result = {"title": "Context Chat", "summary": "Used context."}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat/summarize", json={
                "messages": [
                    {"role": "user", "content": "[Context: past info]\n\nHow does this relate?"},
                    {"role": "assistant", "content": "It relates because..."},
                ],
            })
            assert resp.status_code == 200

    def test_missing_messages_field_returns_422(self):
        assert _get_client().post("/api/chat/summarize", json={}).status_code == 422


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/embed
# ═══════════════════════════════════════════════════════════════════════════════

class TestEmbed:
    def test_basic_embedding(self):
        with patch("main.embedder") as emb:
            emb.embed_text = AsyncMock(return_value=[0.1, 0.2, 0.3])
            data = _get_client().post("/api/embed", json={"text": "machine learning"}).json()
            assert data["embedding"] == [0.1, 0.2, 0.3]

    def test_empty_text(self):
        with patch("main.embedder") as emb:
            emb.embed_text = AsyncMock(return_value=[0.0] * 10)
            resp = _get_client().post("/api/embed", json={"text": ""})
            assert resp.status_code == 200

    def test_long_text(self):
        with patch("main.embedder") as emb:
            emb.embed_text = AsyncMock(return_value=[0.1] * 1536)
            data = _get_client().post("/api/embed", json={"text": "x" * 10000}).json()
            assert len(data["embedding"]) == 1536

    def test_unicode_text(self):
        with patch("main.embedder") as emb:
            emb.embed_text = AsyncMock(return_value=[0.1, 0.2])
            resp = _get_client().post("/api/embed", json={"text": "你好世界"})
            assert resp.status_code == 200

    def test_missing_text_field_returns_422(self):
        assert _get_client().post("/api/embed", json={}).status_code == 422

    def test_embedding_returns_list_of_floats(self):
        with patch("main.embedder") as emb:
            emb.embed_text = AsyncMock(return_value=[0.1, 0.2, 0.3])
            data = _get_client().post("/api/embed", json={"text": "test"}).json()
            assert all(isinstance(x, float) for x in data["embedding"])


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/rank
# ═══════════════════════════════════════════════════════════════════════════════

class TestRank:
    def test_basic_ranking(self):
        data = _get_client().post("/api/rank", json={
            "queryEmbedding": [1.0, 0.0],
            "candidates": [
                {"id": "a", "embedding": [0.0, 1.0]},
                {"id": "b", "embedding": [1.0, 0.0]},
            ],
        }).json()
        assert data["ranked"][0]["id"] == "b"
        assert data["ranked"][0]["score"] == pytest.approx(1.0)

    def test_empty_candidates(self):
        data = _get_client().post("/api/rank", json={
            "queryEmbedding": [1.0, 0.0], "candidates": [],
        }).json()
        assert data["ranked"] == []

    def test_candidates_without_embeddings(self):
        data = _get_client().post("/api/rank", json={
            "queryEmbedding": [1.0, 0.0], "candidates": [{"id": "a"}],
        }).json()
        assert data["ranked"] == []

    def test_many_candidates(self):
        candidates = [{"id": str(i), "embedding": [float(i) / 100, 1.0 - float(i) / 100]} for i in range(50)]
        data = _get_client().post("/api/rank", json={
            "queryEmbedding": [1.0, 0.0], "candidates": candidates,
        }).json()
        assert len(data["ranked"]) == 50

    def test_returns_id_and_score_only(self):
        data = _get_client().post("/api/rank", json={
            "queryEmbedding": [1.0, 0.0],
            "candidates": [{"id": "a", "embedding": [1.0, 0.0], "extra": "field"}],
        }).json()
        assert set(data["ranked"][0].keys()) == {"id", "score"}

    def test_scores_sorted_descending(self):
        data = _get_client().post("/api/rank", json={
            "queryEmbedding": [1.0, 0.0],
            "candidates": [
                {"id": "a", "embedding": [0.0, 1.0]},
                {"id": "b", "embedding": [0.5, 0.5]},
                {"id": "c", "embedding": [1.0, 0.0]},
            ],
        }).json()
        scores = [r["score"] for r in data["ranked"]]
        assert scores == sorted(scores, reverse=True)

    def test_missing_queryEmbedding_returns_422(self):
        assert _get_client().post("/api/rank", json={"candidates": []}).status_code == 422


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/topic/status/update
# ═══════════════════════════════════════════════════════════════════════════════

class TestStatusUpdate:
    def test_basic_update(self):
        mock_result = {"status": "CS student learning ML."}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            data = _get_client().post("/api/topic/status/update", json={
                "topicName": "ML", "currentStatus": "CS student",
                "recentSummaries": ["Learned neural nets", "Studied backprop"],
            }).json()
            assert "status" in data

    def test_empty_current_status(self):
        mock_result = {"status": "Beginner."}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/topic/status/update", json={
                "topicName": "ML", "currentStatus": "", "recentSummaries": [],
            })
            assert resp.status_code == 200

    def test_many_summaries(self):
        mock_result = {"status": "Advanced learner."}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/topic/status/update", json={
                "topicName": "ML", "currentStatus": "learning",
                "recentSummaries": [f"Summary {i}" for i in range(20)],
            })
            assert resp.status_code == 200

    def test_long_status(self):
        mock_result = {"status": "Updated."}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/topic/status/update", json={
                "topicName": "ML", "currentStatus": "x" * 2000, "recentSummaries": [],
            })
            assert resp.status_code == 200

    def test_missing_topicName_returns_422(self):
        assert _get_client().post("/api/topic/status/update", json={
            "currentStatus": "", "recentSummaries": [],
        }).status_code == 422

    def test_llm_receives_correct_topic_name(self):
        mock_result = {"status": "ok"}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/topic/status/update", json={
                "topicName": "Chinese Language", "currentStatus": "Beginner",
                "recentSummaries": ["Learned tones"],
            })
            system_prompt = m.chat.call_args[0][1]
            assert "Chinese Language" in system_prompt


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/topic/detect
# ═══════════════════════════════════════════════════════════════════════════════

class TestTopicDetect:
    def test_detects_topic(self):
        mock_result = {"newTopics": [{"name": "Fitness", "chatIds": ["c1", "c2"]}]}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            data = _get_client().post("/api/topic/detect", json={
                "chatSummaries": [
                    {"id": "c1", "summary": "Workout routine"},
                    {"id": "c2", "summary": "Protein intake"},
                ],
                "existingTopics": [],
            }).json()
            assert len(data["newTopics"]) == 1
            assert data["newTopics"][0]["name"] == "Fitness"

    def test_no_topics_detected(self):
        mock_result = {"newTopics": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            data = _get_client().post("/api/topic/detect", json={
                "chatSummaries": [{"id": "c1", "summary": "Random"}],
                "existingTopics": [{"id": "t1", "name": "ML"}],
            }).json()
            assert data["newTopics"] == []

    def test_empty_input(self):
        mock_result = {"newTopics": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            data = _get_client().post("/api/topic/detect", json={
                "chatSummaries": [], "existingTopics": [],
            }).json()
            assert data["newTopics"] == []

    def test_multiple_topics_detected(self):
        mock_result = {"newTopics": [
            {"name": "Fitness", "chatIds": ["c1", "c2"]},
            {"name": "Cooking", "chatIds": ["c3", "c4"]},
        ]}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            data = _get_client().post("/api/topic/detect", json={
                "chatSummaries": [
                    {"id": "c1", "summary": "Workout"}, {"id": "c2", "summary": "Running"},
                    {"id": "c3", "summary": "Recipe"}, {"id": "c4", "summary": "Baking"},
                ],
                "existingTopics": [],
            }).json()
            assert len(data["newTopics"]) == 2

    def test_with_existing_topics(self):
        mock_result = {"newTopics": [{"name": "New Topic", "chatIds": ["c3", "c4"]}]}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            data = _get_client().post("/api/topic/detect", json={
                "chatSummaries": [{"id": "c3", "summary": "X"}, {"id": "c4", "summary": "Y"}],
                "existingTopics": [{"id": "t1", "name": "ML"}, {"id": "t2", "name": "Fitness"}],
            }).json()
            assert data["newTopics"][0]["name"] == "New Topic"

    def test_many_summaries(self):
        mock_result = {"newTopics": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/topic/detect", json={
                "chatSummaries": [{"id": f"c{i}", "summary": f"Summary {i}"} for i in range(50)],
                "existingTopics": [],
            })
            assert resp.status_code == 200

    def test_llm_receives_existing_topics(self):
        mock_result = {"newTopics": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/topic/detect", json={
                "chatSummaries": [{"id": "c1", "summary": "test"}],
                "existingTopics": [{"id": "t1", "name": "ML"}],
            })
            system_prompt = m.chat.call_args[0][1]
            assert "ML" in system_prompt


# ═══════════════════════════════════════════════════════════════════════════════
# Frontend serving
# ═══════════════════════════════════════════════════════════════════════════════

class TestFrontendServing:
    def test_root_returns_html(self):
        resp = _get_client().get("/")
        assert resp.status_code == 200
        assert "Loom" in resp.text

    def test_static_css_served(self):
        resp = _get_client().get("/static/styles.css")
        assert resp.status_code == 200
        assert "app-container" in resp.text

    def test_static_js_served(self):
        resp = _get_client().get("/static/app.js")
        assert resp.status_code == 200
        assert "App" in resp.text

    def test_static_utils_js_served(self):
        resp = _get_client().get("/static/utils.js")
        assert resp.status_code == 200
        assert "Utils" in resp.text

    def test_static_storage_js_served(self):
        resp = _get_client().get("/static/storage.js")
        assert resp.status_code == 200
        assert "Storage" in resp.text

    def test_static_sidebar_js_served(self):
        resp = _get_client().get("/static/sidebar.js")
        assert resp.status_code == 200
        assert "Sidebar" in resp.text

    def test_nonexistent_static_404(self):
        resp = _get_client().get("/static/nonexistent.js")
        assert resp.status_code == 404

    def test_html_contains_script_tags(self):
        resp = _get_client().get("/")
        assert "/static/app.js" in resp.text
        assert "/static/utils.js" in resp.text
        assert "/static/storage.js" in resp.text
        assert "/static/sidebar.js" in resp.text

    def test_html_contains_css_link(self):
        resp = _get_client().get("/")
        assert "/static/styles.css" in resp.text


# ═══════════════════════════════════════════════════════════════════════════════
# CORS
# ═══════════════════════════════════════════════════════════════════════════════

class TestCORS:
    def test_cors_preflight(self):
        resp = _get_client().options("/api/chat", headers={
            "Origin": "http://example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        })
        assert resp.status_code == 200

    def test_cors_allows_all_origins(self):
        resp = _get_client().options("/api/chat", headers={
            "Origin": "http://example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        })
        assert "access-control-allow-origin" in resp.headers


# ═══════════════════════════════════════════════════════════════════════════════
# Integration / Flow tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestIntegrationFlows:
    def test_chat_then_summarize_flow(self):
        chat_result = {
            "response": "Neural nets use layers.",
            "topic": {"name": "ML", "matchedExistingId": None, "confidence": 0.9},
            "concepts": [{"title": "Neural Networks", "preview": "Layers of computation"}],
        }
        summarize_result = {"title": "Neural Nets Intro", "summary": "Discussed basics of neural networks."}

        with patch("main.llm") as m:
            m.chat = AsyncMock(side_effect=[chat_result, summarize_result])
            client = _get_client()

            # Step 1: Chat
            data1 = client.post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "What are neural nets?"}],
                "existingTopics": [], "existingConcepts": [],
            }).json()
            assert data1["response"] == "Neural nets use layers."

            # Step 2: Summarize
            data2 = client.post("/api/chat/summarize", json={
                "messages": [
                    {"role": "user", "content": "What are neural nets?"},
                    {"role": "assistant", "content": "Neural nets use layers."},
                ],
            }).json()
            assert data2["title"] == "Neural Nets Intro"

    def test_chat_then_embed_then_rank_flow(self):
        chat_result = {"response": "Answer", "topic": {"name": "ML", "matchedExistingId": None, "confidence": 0.5}, "concepts": []}

        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value=chat_result)
            emb.embed_text = AsyncMock(return_value=[0.9, 0.1])
            client = _get_client()

            # Step 1: Chat
            client.post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "q"}],
                "existingTopics": [], "existingConcepts": [],
            })

            # Step 2: Embed
            emb_data = client.post("/api/embed", json={"text": "neural nets"}).json()
            assert len(emb_data["embedding"]) == 2

            # Step 3: Rank
            rank_data = client.post("/api/rank", json={
                "queryEmbedding": emb_data["embedding"],
                "candidates": [
                    {"id": "c1", "embedding": [0.9, 0.1]},
                    {"id": "c2", "embedding": [0.1, 0.9]},
                ],
            }).json()
            assert rank_data["ranked"][0]["id"] == "c1"

    def test_full_sidebar_refresh_with_ranking(self):
        """Full flow: embed query, rank candidates, generate all 3 modules."""
        bridge = {"relatedCards": [{"sourceType": "chat", "sourceId": "c2", "sourceTitle": "SVM", "bridgeQuestion": "How do SVMs relate?"}]}
        directions = {"newDirections": [{"title": "Regularization", "question": "What about regularization?"}]}
        status = {"status": "Learning ML fundamentals."}

        call_idx = 0
        async def ordered_calls(*args, **kwargs):
            nonlocal call_idx
            call_idx += 1
            if call_idx == 1:
                return bridge
            elif call_idx == 2:
                return directions
            else:
                return status

        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(side_effect=ordered_calls)
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)

            data = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1",
                "messages": [
                    {"role": "user", "content": "What is backpropagation?"},
                    {"role": "assistant", "content": "Backprop is..."},
                    {"role": "user", "content": "How does it compute gradients?"},
                ],
                "topicId": "t1", "topicName": "Machine Learning",
                "topicStatus": "3rd year CS student",
                "allChatSummaries": [
                    {"id": "c2", "title": "SVM Chat", "summary": "Discussed SVMs", "embedding": [0.4] * 10},
                    {"id": "c3", "title": "Linear Algebra", "summary": "Matrix operations", "embedding": [0.3] * 10},
                ],
                "allConcepts": [{"id": "con1", "title": "Gradient Descent", "preview": "Optimization method"}],
            }).json()

            assert len(data["relatedCards"]) == 1
            assert data["relatedCards"][0]["sourceTitle"] == "SVM"
            assert len(data["newDirections"]) == 1
            assert isinstance(data["statusUpdate"], str)


# ═══════════════════════════════════════════════════════════════════════════════
# Pydantic model validation
# ═══════════════════════════════════════════════════════════════════════════════

class TestPydanticModels:
    def test_message_item_valid(self):
        from main import MessageItem
        m = MessageItem(role="user", content="hello")
        assert m.role == "user"

    def test_topic_item_valid(self):
        from main import TopicItem
        t = TopicItem(id="t1", name="ML")
        assert t.id == "t1"

    def test_concept_item_valid(self):
        from main import ConceptItem
        c = ConceptItem(id="c1", topicId="t1", title="ReLU", preview="Activation")
        assert c.title == "ReLU"

    def test_chat_request_defaults(self):
        from main import ChatRequest
        r = ChatRequest(chatId="c1", messages=[])
        assert r.existingTopics == []
        assert r.existingConcepts == []

    def test_sidebar_request_defaults(self):
        from main import SidebarRefreshRequest
        r = SidebarRefreshRequest(chatId="c1", messages=[], topicId="t1", topicName="ML")
        assert r.topicStatus == ""
        assert r.allChatSummaries == []
        assert r.allConcepts == []

    def test_summarize_request(self):
        from main import SummarizeRequest
        r = SummarizeRequest(messages=[])
        assert r.messages == []

    def test_embed_request(self):
        from main import EmbedRequest
        r = EmbedRequest(text="hello")
        assert r.text == "hello"

    def test_rank_request(self):
        from main import RankRequest
        r = RankRequest(queryEmbedding=[1.0], candidates=[])
        assert r.queryEmbedding == [1.0]

    def test_status_update_request_defaults(self):
        from main import StatusUpdateRequest
        r = StatusUpdateRequest(topicName="ML")
        assert r.currentStatus == ""
        assert r.recentSummaries == []

    def test_topic_detect_request_defaults(self):
        from main import TopicDetectRequest
        r = TopicDetectRequest()
        assert r.chatSummaries == []
        assert r.existingTopics == []


# ═══════════════════════════════════════════════════════════════════════════════
# Additional edge cases
# ═══════════════════════════════════════════════════════════════════════════════

class TestChatEdgeCases:
    def test_assistant_only_messages(self):
        mock_result = {"response": "ok", "topic": {"name": "T", "matchedExistingId": None, "confidence": 0.5}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "assistant", "content": "hi"}],
                "existingTopics": [], "existingConcepts": [],
            })
            assert resp.status_code == 200

    def test_system_role_message(self):
        mock_result = {"response": "ok", "topic": {"name": "T", "matchedExistingId": None, "confidence": 0.5}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "system", "content": "be helpful"}, {"role": "user", "content": "hi"}],
                "existingTopics": [], "existingConcepts": [],
            })
            assert resp.status_code == 200

    def test_empty_content_message(self):
        mock_result = {"response": "ok", "topic": {"name": "T", "matchedExistingId": None, "confidence": 0.5}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": ""}],
                "existingTopics": [], "existingConcepts": [],
            })
            assert resp.status_code == 200

    def test_many_concepts_returned(self):
        mock_result = {
            "response": "ok",
            "topic": {"name": "ML", "matchedExistingId": None, "confidence": 0.9},
            "concepts": [{"title": f"Concept {i}", "preview": f"Preview {i}"} for i in range(10)],
        }
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            data = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "q"}],
                "existingTopics": [], "existingConcepts": [],
            }).json()
            assert len(data["concepts"]) == 10

    def test_topic_with_low_confidence(self):
        mock_result = {
            "response": "ok",
            "topic": {"name": "ML", "matchedExistingId": None, "confidence": 0.1},
            "concepts": [],
        }
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            data = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "q"}],
                "existingTopics": [], "existingConcepts": [],
            }).json()
            assert data["topic"]["confidence"] == 0.1


class TestSidebarEdgeCases:
    def test_no_summaries_no_concepts(self):
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value={"relatedCards": [], "newDirections": [], "status": "Fresh"})
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            data = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "first message"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "",
                "allChatSummaries": [], "allConcepts": [],
            }).json()
            assert data["relatedCards"] == []

    def test_single_message_sidebar(self):
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value={"relatedCards": []})
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            resp = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hello"}],
                "topicId": "t1", "topicName": "T", "topicStatus": "s",
                "allChatSummaries": [], "allConcepts": [],
            })
            assert resp.status_code == 200

    def test_summaries_without_embeddings(self):
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value={"relatedCards": []})
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            resp = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "",
                "allChatSummaries": [
                    {"id": "c2", "title": "Old", "summary": "content"},
                    {"id": "c3", "title": "Another", "summary": "content2", "embedding": None},
                ],
                "allConcepts": [],
            })
            assert resp.status_code == 200

    def test_status_preserved_on_llm_error(self):
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(side_effect=Exception("fail"))
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            data = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "original status",
                "allChatSummaries": [], "allConcepts": [],
            }).json()
            assert data["statusUpdate"] is None


class TestRankEdgeCases:
    def test_identical_embeddings(self):
        data = _get_client().post("/api/rank", json={
            "queryEmbedding": [1.0, 0.0],
            "candidates": [
                {"id": "a", "embedding": [1.0, 0.0]},
                {"id": "b", "embedding": [1.0, 0.0]},
            ],
        }).json()
        assert len(data["ranked"]) == 2
        assert all(r["score"] == pytest.approx(1.0) for r in data["ranked"])

    def test_high_dimensional_ranking(self):
        import random
        random.seed(42)
        query = [random.random() for _ in range(256)]
        candidates = [{"id": str(i), "embedding": [random.random() for _ in range(256)]} for i in range(10)]
        data = _get_client().post("/api/rank", json={
            "queryEmbedding": query, "candidates": candidates,
        }).json()
        assert len(data["ranked"]) == 10
        scores = [r["score"] for r in data["ranked"]]
        assert scores == sorted(scores, reverse=True)

    def test_single_dimension_ranking(self):
        data = _get_client().post("/api/rank", json={
            "queryEmbedding": [1.0],
            "candidates": [
                {"id": "pos", "embedding": [1.0]},
                {"id": "neg", "embedding": [-1.0]},
            ],
        }).json()
        assert data["ranked"][0]["id"] == "pos"

    def test_zero_query_embedding(self):
        data = _get_client().post("/api/rank", json={
            "queryEmbedding": [0.0, 0.0],
            "candidates": [{"id": "a", "embedding": [1.0, 0.0]}],
        }).json()
        assert data["ranked"][0]["score"] == pytest.approx(0.0)


class TestEmbedEdgeCases:
    def test_multiline_text(self):
        with patch("main.embedder") as emb:
            emb.embed_text = AsyncMock(return_value=[0.1])
            resp = _get_client().post("/api/embed", json={"text": "line1\nline2\nline3"})
            assert resp.status_code == 200

    def test_special_characters_embedding(self):
        with patch("main.embedder") as emb:
            emb.embed_text = AsyncMock(return_value=[0.1])
            resp = _get_client().post("/api/embed", json={"text": "<b>bold</b> & \"quotes\""})
            assert resp.status_code == 200


class TestHTTPMethods:
    def test_get_chat_not_allowed(self):
        resp = _get_client().get("/api/chat")
        assert resp.status_code == 405

    def test_get_embed_not_allowed(self):
        resp = _get_client().get("/api/embed")
        assert resp.status_code == 405

    def test_get_rank_not_allowed(self):
        resp = _get_client().get("/api/rank")
        assert resp.status_code == 405

    def test_put_chat_not_allowed(self):
        resp = _get_client().put("/api/chat", json={})
        assert resp.status_code == 405

    def test_delete_chat_not_allowed(self):
        resp = _get_client().delete("/api/chat")
        assert resp.status_code == 405


# ═══════════════════════════════════════════════════════════════════════════════
# Model selector: API endpoint passthrough
# ═══════════════════════════════════════════════════════════════════════════════

class TestModelPassthroughChat:
    """Test that /api/chat passes the model field through to llm.chat."""

    def test_model_field_forwarded(self):
        mock_result = {"response": "ok", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
                "model": "gpt-5-mini-2025-08-07",
            })
            kwargs = m.chat.call_args.kwargs
            assert kwargs.get("model") == "gpt-5-mini-2025-08-07"

    def test_gemini_model_forwarded(self):
        mock_result = {"response": "ok", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
                "model": "gemini-3-flash-preview",
            })
            kwargs = m.chat.call_args.kwargs
            assert kwargs.get("model") == "gemini-3-flash-preview"

    def test_no_model_field_passes_none(self):
        mock_result = {"response": "ok", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
            })
            kwargs = m.chat.call_args.kwargs
            assert kwargs.get("model") is None

    def test_all_gemini_models_accepted(self):
        """All 4 gemini model names should be accepted without validation error."""
        for model in ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3-flash-preview", "gemini-3.1-pro-preview"]:
            mock_result = {"response": "ok", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}
            with patch("main.llm") as m:
                m.chat = AsyncMock(return_value=mock_result)
                resp = _get_client().post("/api/chat", json={
                    "chatId": "c1", "messages": [{"role": "user", "content": "q"}],
                    "model": model,
                })
                assert resp.status_code == 200

    def test_all_openai_models_accepted(self):
        """All 3 OpenAI model names should be accepted without validation error."""
        for model in ["gpt-5.2-2025-12-11", "gpt-5-nano-2025-08-07", "gpt-5-mini-2025-08-07"]:
            mock_result = {"response": "ok", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}
            with patch("main.llm") as m:
                m.chat = AsyncMock(return_value=mock_result)
                resp = _get_client().post("/api/chat", json={
                    "chatId": "c1", "messages": [{"role": "user", "content": "q"}],
                    "model": model,
                })
                assert resp.status_code == 200


class TestModelPassthroughSidebar:
    """Test that /api/sidebar/refresh passes the model field to all 3 parallel LLM calls."""

    def test_model_forwarded_to_all_three_calls(self):
        call_models = []
        async def capture_model(*args, **kwargs):
            call_models.append(kwargs.get("model"))
            return {"relatedCards": [], "newDirections": [], "status": "ok"}

        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(side_effect=capture_model)
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "",
                "allChatSummaries": [], "allConcepts": [],
                "model": "gpt-5-nano-2025-08-07",
            })
            assert len(call_models) == 3
            assert all(m == "gpt-5-nano-2025-08-07" for m in call_models)

    def test_no_model_passes_none_to_all_calls(self):
        call_models = []
        async def capture_model(*args, **kwargs):
            call_models.append(kwargs.get("model"))
            return {"relatedCards": [], "newDirections": [], "status": "ok"}

        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(side_effect=capture_model)
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "",
                "allChatSummaries": [], "allConcepts": [],
            })
            assert len(call_models) == 3
            assert all(m is None for m in call_models)

    def test_gemini_model_forwarded(self):
        call_models = []
        async def capture_model(*args, **kwargs):
            call_models.append(kwargs.get("model"))
            return {"relatedCards": [], "newDirections": [], "status": "ok"}

        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(side_effect=capture_model)
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "test"}],
                "topicId": "t1", "topicName": "ML", "topicStatus": "",
                "allChatSummaries": [], "allConcepts": [],
                "model": "gemini-3.1-pro-preview",
            })
            assert all(m == "gemini-3.1-pro-preview" for m in call_models)


class TestModelPassthroughSummarize:
    """Test that /api/chat/summarize passes the model field to llm.chat."""

    def test_model_forwarded(self):
        mock_result = {"title": "T", "summary": "S"}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/chat/summarize", json={
                "messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}],
                "model": "gemini-2.5-flash-lite",
            })
            kwargs = m.chat.call_args.kwargs
            assert kwargs.get("model") == "gemini-2.5-flash-lite"

    def test_no_model_passes_none(self):
        mock_result = {"title": "T", "summary": "S"}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/chat/summarize", json={
                "messages": [{"role": "user", "content": "hi"}],
            })
            kwargs = m.chat.call_args.kwargs
            assert kwargs.get("model") is None

    def test_openai_model_forwarded(self):
        mock_result = {"title": "T", "summary": "S"}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/chat/summarize", json={
                "messages": [{"role": "user", "content": "hi"}],
                "model": "gpt-5.2-2025-12-11",
            })
            kwargs = m.chat.call_args.kwargs
            assert kwargs.get("model") == "gpt-5.2-2025-12-11"


# ═══════════════════════════════════════════════════════════════════════════════
# Pydantic model field: model defaults
# ═══════════════════════════════════════════════════════════════════════════════

class TestPydanticModelField:
    def test_chat_request_model_default_none(self):
        from main import ChatRequest
        r = ChatRequest(chatId="c1", messages=[])
        assert r.model is None

    def test_chat_request_model_set(self):
        from main import ChatRequest
        r = ChatRequest(chatId="c1", messages=[], model="gpt-5-mini-2025-08-07")
        assert r.model == "gpt-5-mini-2025-08-07"

    def test_sidebar_request_model_default_none(self):
        from main import SidebarRefreshRequest
        r = SidebarRefreshRequest(chatId="c1", messages=[], topicId="t1", topicName="ML")
        assert r.model is None

    def test_sidebar_request_model_set(self):
        from main import SidebarRefreshRequest
        r = SidebarRefreshRequest(chatId="c1", messages=[], topicId="t1", topicName="ML", model="gemini-3-flash-preview")
        assert r.model == "gemini-3-flash-preview"

    def test_summarize_request_model_default_none(self):
        from main import SummarizeRequest
        r = SummarizeRequest(messages=[])
        assert r.model is None

    def test_summarize_request_model_set(self):
        from main import SummarizeRequest
        r = SummarizeRequest(messages=[], model="gemini-2.5-flash-lite")
        assert r.model == "gemini-2.5-flash-lite"


# ═══════════════════════════════════════════════════════════════════════════════
# Frontend HTML: new UI elements (resize handles, model selectors, delete btn)
# ═══════════════════════════════════════════════════════════════════════════════

class TestFrontendNewElements:
    def _get_html(self):
        return _get_client().get("/").text

    def test_resize_handle_left_exists(self):
        assert 'id="resizeLeft"' in self._get_html()

    def test_resize_handle_right_exists(self):
        assert 'id="resizeRight"' in self._get_html()

    def test_resize_handles_have_class(self):
        html = self._get_html()
        assert 'class="resize-handle"' in html

    def test_chat_model_select_exists(self):
        assert 'id="chatModelSelect"' in self._get_html()

    def test_sidebar_model_select_exists(self):
        assert 'id="sidebarModelSelect"' in self._get_html()

    def test_chat_model_select_has_gemini_options(self):
        html = self._get_html()
        assert 'value="gemini-2.5-flash"' in html
        assert 'value="gemini-2.5-flash-lite"' in html
        assert 'value="gemini-3-flash-preview"' in html
        assert 'value="gemini-3.1-pro-preview"' in html

    def test_chat_model_select_has_openai_options(self):
        html = self._get_html()
        assert 'value="gpt-5.2-2025-12-11"' in html
        assert 'value="gpt-5-mini-2025-08-07"' in html
        assert 'value="gpt-5-nano-2025-08-07"' in html

    def test_sidebar_model_select_has_all_models(self):
        html = self._get_html()
        for model in ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3-flash-preview",
                       "gemini-3.1-pro-preview", "gpt-5.2-2025-12-11", "gpt-5-mini-2025-08-07",
                       "gpt-5-nano-2025-08-07"]:
            assert model in html

    def test_gemini_25_flash_is_default_selected(self):
        html = self._get_html()
        assert 'value="gemini-2.5-flash" selected' in html


class TestFrontendResizeCSS:
    def test_resize_handle_css_exists(self):
        css = _get_client().get("/static/styles.css").text
        assert ".resize-handle" in css
        assert "col-resize" in css

    def test_left_sidebar_uses_flex_basis(self):
        css = _get_client().get("/static/styles.css").text
        assert "flex-basis: 260px" in css

    def test_right_sidebar_uses_flex_basis(self):
        css = _get_client().get("/static/styles.css").text
        assert "flex-basis: 360px" in css

    def test_left_sidebar_min_max_width(self):
        css = _get_client().get("/static/styles.css").text
        assert "min-width: 200px" in css
        assert "max-width: 400px" in css

    def test_right_sidebar_min_max_width(self):
        css = _get_client().get("/static/styles.css").text
        assert "min-width: 240px" in css
        assert "max-width: 500px" in css


class TestFrontendDeleteCSS:
    def test_chat_delete_btn_css_exists(self):
        css = _get_client().get("/static/styles.css").text
        assert ".chat-delete-btn" in css

    def test_delete_btn_hidden_by_default(self):
        css = _get_client().get("/static/styles.css").text
        assert ".chat-delete-btn" in css
        assert "opacity: 0" in css

    def test_delete_btn_visible_on_hover(self):
        css = _get_client().get("/static/styles.css").text
        assert ".chat-item:hover .chat-delete-btn" in css


class TestFrontendModelSelectCSS:
    def test_model_select_css_exists(self):
        css = _get_client().get("/static/styles.css").text
        assert ".model-select" in css

    def test_model_select_sm_variant(self):
        css = _get_client().get("/static/styles.css").text
        assert ".model-select-sm" in css


class TestFrontendAppJS:
    def test_app_js_has_resize_init(self):
        js = _get_client().get("/static/app.js").text
        assert "_initResize" in js

    def test_app_js_has_delete_chat(self):
        js = _get_client().get("/static/app.js").text
        assert "_deleteChat" in js

    def test_app_js_has_chat_model_select_binding(self):
        js = _get_client().get("/static/app.js").text
        assert "chatModelSelect" in js

    def test_app_js_has_sidebar_model_select_binding(self):
        js = _get_client().get("/static/app.js").text
        assert "sidebarModelSelect" in js

    def test_app_js_sends_model_in_chat_request(self):
        js = _get_client().get("/static/app.js").text
        assert "Storage.getChatModel()" in js

    def test_app_js_sends_model_in_summarize_request(self):
        js = _get_client().get("/static/app.js").text
        assert "Storage.getChatModel()" in js


class TestFrontendStorageJS:
    def test_storage_has_delete_chat(self):
        js = _get_client().get("/static/storage.js").text
        assert "deleteChat" in js

    def test_storage_has_get_chat_model(self):
        js = _get_client().get("/static/storage.js").text
        assert "getChatModel" in js

    def test_storage_has_set_chat_model(self):
        js = _get_client().get("/static/storage.js").text
        assert "setChatModel" in js

    def test_storage_has_get_sidebar_model(self):
        js = _get_client().get("/static/storage.js").text
        assert "getSidebarModel" in js

    def test_storage_has_set_sidebar_model(self):
        js = _get_client().get("/static/storage.js").text
        assert "setSidebarModel" in js


class TestFrontendSidebarJS:
    def test_sidebar_sends_model_in_refresh(self):
        js = _get_client().get("/static/sidebar.js").text
        assert "Storage.getSidebarModel()" in js

    def test_sidebar_caches_data_on_topic(self):
        js = _get_client().get("/static/sidebar.js").text
        assert "sidebarCache" in js

    def test_sidebar_renders_from_cache(self):
        js = _get_client().get("/static/sidebar.js").text
        assert "topic.sidebarCache" in js

    def test_sidebar_has_status_drag_init(self):
        js = _get_client().get("/static/sidebar.js").text
        assert "_initStatusDrag" in js

    def test_sidebar_has_status_update_init(self):
        js = _get_client().get("/static/sidebar.js").text
        assert "_initStatusUpdate" in js

    def test_sidebar_has_merge_dialog_init(self):
        js = _get_client().get("/static/sidebar.js").text
        assert "_initMergeDialog" in js


# ═══════════════════════════════════════════════════════════════════════════════
# New features: Attachments & search grounding
# ═══════════════════════════════════════════════════════════════════════════════

class TestChatAttachments:
    def test_chat_with_attachments_accepted(self):
        import base64
        b64 = base64.b64encode(b"fake-image").decode()
        mock_result = {"response": "ok", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "What is this?"}],
                "attachments": [{"mimeType": "image/jpeg", "data": b64}],
            })
            assert resp.status_code == 200

    def test_chat_attachments_forwarded_to_llm(self):
        import base64
        b64 = base64.b64encode(b"fake-image").decode()
        mock_result = {"response": "ok", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "What is this?"}],
                "attachments": [{"mimeType": "image/jpeg", "data": b64}],
            })
            kwargs = m.chat.call_args.kwargs
            assert kwargs.get("attachments") is not None
            assert len(kwargs["attachments"]) == 1
            assert kwargs["attachments"][0]["mimeType"] == "image/jpeg"

    def test_chat_no_attachments_passes_none(self):
        mock_result = {"response": "ok", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
            })
            kwargs = m.chat.call_args.kwargs
            assert kwargs.get("attachments") is None

    def test_chat_empty_attachments_passes_none(self):
        mock_result = {"response": "ok", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
                "attachments": [],
            })
            kwargs = m.chat.call_args.kwargs
            assert kwargs.get("attachments") is None

    def test_chat_multiple_attachments(self):
        import base64
        b64a = base64.b64encode(b"img1").decode()
        b64b = base64.b64encode(b"img2").decode()
        mock_result = {"response": "ok", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "Describe these."}],
                "attachments": [
                    {"mimeType": "image/jpeg", "data": b64a},
                    {"mimeType": "image/png", "data": b64b},
                ],
            })
            assert resp.status_code == 200
            kwargs = m.chat.call_args.kwargs
            assert len(kwargs["attachments"]) == 2

    def test_invalid_attachment_format_returns_422(self):
        resp = _get_client().post("/api/chat", json={
            "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
            "attachments": [{"bad": "field"}],
        })
        assert resp.status_code == 422


class TestChatSearchGrounding:
    def test_search_flag_forwarded(self):
        mock_result = {"response": "ok", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
                "useSearch": True,
            })
            kwargs = m.chat.call_args.kwargs
            assert kwargs.get("use_search") is True

    def test_search_flag_default_false(self):
        mock_result = {"response": "ok", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
            })
            kwargs = m.chat.call_args.kwargs
            assert kwargs.get("use_search") is False

    def test_search_false_explicitly(self):
        mock_result = {"response": "ok", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/chat", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
                "useSearch": False,
            })
            kwargs = m.chat.call_args.kwargs
            assert kwargs.get("use_search") is False


# ═══════════════════════════════════════════════════════════════════════════════
# Pydantic: new fields
# ═══════════════════════════════════════════════════════════════════════════════

class TestPydanticAttachmentItem:
    def test_attachment_item_valid(self):
        from main import AttachmentItem
        a = AttachmentItem(mimeType="image/jpeg", data="abc123")
        assert a.mimeType == "image/jpeg"
        assert a.data == "abc123"

    def test_chat_request_attachments_default_empty(self):
        from main import ChatRequest
        r = ChatRequest(chatId="c1", messages=[])
        assert r.attachments == []

    def test_chat_request_use_search_default_false(self):
        from main import ChatRequest
        r = ChatRequest(chatId="c1", messages=[])
        assert r.useSearch is False

    def test_chat_request_with_attachments(self):
        from main import ChatRequest, AttachmentItem
        r = ChatRequest(
            chatId="c1", messages=[],
            attachments=[AttachmentItem(mimeType="image/png", data="xyz")],
        )
        assert len(r.attachments) == 1

    def test_chat_request_with_search(self):
        from main import ChatRequest
        r = ChatRequest(chatId="c1", messages=[], useSearch=True)
        assert r.useSearch is True

    def test_status_update_request_model_field(self):
        from main import StatusUpdateRequest
        r = StatusUpdateRequest(topicName="ML", model="gemini-3-flash-preview")
        assert r.model == "gemini-3-flash-preview"

    def test_status_update_request_model_default_none(self):
        from main import StatusUpdateRequest
        r = StatusUpdateRequest(topicName="ML")
        assert r.model is None


# ═══════════════════════════════════════════════════════════════════════════════
# Status update model passthrough
# ═══════════════════════════════════════════════════════════════════════════════

class TestStatusUpdateModelPassthrough:
    def test_model_forwarded_to_status_update(self):
        mock_result = {"status": "updated"}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/topic/status/update", json={
                "topicName": "ML", "currentStatus": "learning",
                "recentSummaries": ["summary1"],
                "model": "gemini-3.1-pro-preview",
            })
            kwargs = m.chat.call_args.kwargs
            assert kwargs.get("model") == "gemini-3.1-pro-preview"

    def test_no_model_passes_none_to_status_update(self):
        mock_result = {"status": "updated"}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/topic/status/update", json={
                "topicName": "ML", "currentStatus": "learning",
                "recentSummaries": [],
            })
            kwargs = m.chat.call_args.kwargs
            assert kwargs.get("model") is None


# ═══════════════════════════════════════════════════════════════════════════════
# Frontend: new UI elements for TODO features
# ═══════════════════════════════════════════════════════════════════════════════

class TestFrontendChatBubbleCSS:
    def test_user_message_inline_block(self):
        css = _get_client().get("/static/styles.css").text
        assert "display: inline-block" in css

    def test_user_message_flex_end(self):
        css = _get_client().get("/static/styles.css").text
        assert "align-items: flex-end" in css

    def test_assistant_message_flex_start(self):
        css = _get_client().get("/static/styles.css").text
        assert "align-items: flex-start" in css


class TestFrontendFileUpload:
    def test_attach_button_exists(self):
        html = _get_client().get("/").text
        assert 'id="attachBtn"' in html

    def test_file_input_exists(self):
        html = _get_client().get("/").text
        assert 'id="fileInput"' in html

    def test_search_toggle_button_exists(self):
        html = _get_client().get("/").text
        assert 'id="searchToggleBtn"' in html

    def test_input_attachments_container(self):
        html = _get_client().get("/").text
        assert 'id="inputAttachments"' in html

    def test_input_icon_buttons_in_css(self):
        css = _get_client().get("/static/styles.css").text
        assert ".input-icon" in css

    def test_attachment_thumb_in_css(self):
        css = _get_client().get("/static/styles.css").text
        assert ".attachment-thumb" in css


class TestFrontendTopicMerge:
    def test_merge_dialog_exists(self):
        html = _get_client().get("/").text
        assert 'id="mergeTopicDialog"' in html

    def test_merge_target_select(self):
        html = _get_client().get("/").text
        assert 'id="mergeTargetSelect"' in html

    def test_merge_confirm_button(self):
        html = _get_client().get("/").text
        assert 'id="mergeConfirmBtn"' in html

    def test_merge_cancel_button(self):
        html = _get_client().get("/").text
        assert 'id="mergeCancelBtn"' in html

    def test_merge_dialog_opened_from_app(self):
        js = _get_client().get("/static/app.js").text
        assert '_openMergeDialog' in js


class TestFrontendStatusUpdate:
    def test_status_update_button_exists(self):
        html = _get_client().get("/").text
        assert 'id="statusUpdateBtn"' in html

    def test_status_text_draggable(self):
        html = _get_client().get("/").text
        assert 'draggable="true"' in html

    def test_status_actions_css(self):
        css = _get_client().get("/static/styles.css").text
        assert ".status-actions" in css


class TestFrontendDragWholePanel:
    def test_app_js_has_main_content_drag_listeners(self):
        js = _get_client().get("/static/app.js").text
        assert "mainContent" in js
        assert "_handleDragOver" in js or "mainContent.addEventListener" in js

    def test_main_content_drag_active_css(self):
        css = _get_client().get("/static/styles.css").text
        assert ".main-content.drag-active" in css or "drag-over" in css


class TestFrontendContextOnlySend:
    def test_app_js_context_only_message(self):
        js = _get_client().get("/static/app.js").text
        assert "Please continue based on this context" in js


class TestFrontendFileUploadJS:
    def test_app_js_has_file_handling(self):
        js = _get_client().get("/static/app.js").text
        assert "_handleFiles" in js

    def test_app_js_has_render_attachments(self):
        js = _get_client().get("/static/app.js").text
        assert "_renderAttachments" in js

    def test_app_js_has_pending_attachments(self):
        js = _get_client().get("/static/app.js").text
        assert "pendingAttachments" in js

    def test_app_js_has_search_toggle(self):
        js = _get_client().get("/static/app.js").text
        assert "useSearch" in js

    def test_app_js_sends_attachments_in_request(self):
        js = _get_client().get("/static/app.js").text
        assert "reqBody.attachments" in js or "attachments:" in js


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/chat/stream (SSE streaming endpoint)
# ═══════════════════════════════════════════════════════════════════════════════

class TestChatStreamEndpoint:
    def _parse_sse(self, text):
        """Parse SSE text into list of JSON events."""
        import json as _json
        events = []
        for line in text.split("\n"):
            if line.startswith("data: "):
                events.append(_json.loads(line[6:]))
        return events

    def test_stream_returns_200(self):
        async def fake_stream(*args, **kwargs):
            yield "Hello"
            yield " world"
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
            })
            assert resp.status_code == 200

    def test_stream_returns_sse_content_type(self):
        async def fake_stream(*args, **kwargs):
            yield "Hello"
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
            })
            assert "text/event-stream" in resp.headers.get("content-type", "")

    def test_stream_emits_chunks_and_done(self):
        async def fake_stream(*args, **kwargs):
            yield "Hello"
            yield " world"
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {"name": "ML", "matchedExistingId": None, "confidence": 0.9}, "concepts": [{"title": "X", "preview": "Y"}]})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
            })
            events = self._parse_sse(resp.text)
            chunks = [e for e in events if e["type"] == "chunk"]
            done_events = [e for e in events if e["type"] == "done"]
            assert len(chunks) == 2
            assert chunks[0]["text"] == "Hello"
            assert chunks[1]["text"] == " world"
            assert len(done_events) == 1
            assert done_events[0]["response"] == "Hello world"

    def test_stream_done_includes_topic(self):
        async def fake_stream(*args, **kwargs):
            yield "Answer"
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {"name": "ML", "matchedExistingId": "t1", "confidence": 0.95}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
                "existingTopics": [{"id": "t1", "name": "ML"}],
            })
            events = self._parse_sse(resp.text)
            done = [e for e in events if e["type"] == "done"][0]
            assert done["topic"]["name"] == "ML"
            assert done["topic"]["matchedExistingId"] == "t1"

    def test_stream_done_includes_concepts(self):
        async def fake_stream(*args, **kwargs):
            yield "Answer"
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": [{"title": "NN", "preview": "Neural networks"}]})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
            })
            events = self._parse_sse(resp.text)
            done = [e for e in events if e["type"] == "done"][0]
            assert len(done["concepts"]) == 1
            assert done["concepts"][0]["title"] == "NN"

    def test_stream_passes_model_to_stream(self):
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            _get_client().post("/api/chat/stream", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
                "model": "gemini-3-flash-preview",
            })
            stream_kwargs = m.chat_stream.call_args.kwargs
            assert stream_kwargs.get("model") == "gemini-3-flash-preview"

    def test_stream_passes_use_search(self):
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            _get_client().post("/api/chat/stream", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
                "useSearch": True,
            })
            stream_kwargs = m.chat_stream.call_args.kwargs
            assert stream_kwargs.get("use_search") is True

    def test_stream_passes_attachments(self):
        import base64
        b64 = base64.b64encode(b"fake").decode()
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            _get_client().post("/api/chat/stream", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
                "attachments": [{"mimeType": "image/jpeg", "data": b64}],
            })
            stream_kwargs = m.chat_stream.call_args.kwargs
            assert stream_kwargs.get("attachments") is not None
            assert len(stream_kwargs["attachments"]) == 1

    def test_stream_error_event_on_failure(self):
        async def fail_stream(*args, **kwargs):
            raise RuntimeError("LLM down")
            yield  # make it a generator
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fail_stream())
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
            })
            events = self._parse_sse(resp.text)
            errors = [e for e in events if e["type"] == "error"]
            assert len(errors) == 1
            assert "LLM down" in errors[0]["message"]

    def test_stream_metadata_fallback_on_meta_failure(self):
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(side_effect=Exception("meta fail"))
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
            })
            events = self._parse_sse(resp.text)
            done = [e for e in events if e["type"] == "done"][0]
            assert done["topic"]["confidence"] == 0
            assert done["concepts"] == []

    def test_stream_validation_missing_chatId(self):
        resp = _get_client().post("/api/chat/stream", json={
            "messages": [{"role": "user", "content": "hi"}],
        })
        assert resp.status_code == 422

    def test_stream_validation_missing_messages(self):
        resp = _get_client().post("/api/chat/stream", json={"chatId": "c1"})
        assert resp.status_code == 422

    def test_stream_empty_messages(self):
        async def fake_stream(*args, **kwargs):
            yield ""
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1", "messages": [],
            })
            assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# Frontend: streaming, live model, integrated input bar
# ═══════════════════════════════════════════════════════════════════════════════

class TestFrontendStreamingUI:
    def test_app_js_uses_stream_endpoint(self):
        js = _get_client().get("/static/app.js").text
        assert "/api/chat/stream" in js

    def test_app_js_has_streaming_message_creator(self):
        js = _get_client().get("/static/app.js").text
        assert "_createStreamingMessage" in js

    def test_app_js_has_streaming_message_updater(self):
        js = _get_client().get("/static/app.js").text
        assert "_updateStreamingMessage" in js

    def test_app_js_reads_sse_chunks(self):
        js = _get_client().get("/static/app.js").text
        assert "getReader" in js
        assert "TextDecoder" in js

    def test_streaming_cursor_in_css(self):
        css = _get_client().get("/static/styles.css").text
        assert ".streaming-cursor" in css


class TestFrontendIntegratedInputBar:
    def test_input_model_select_in_html(self):
        html = _get_client().get("/").text
        assert 'class="input-model-select"' in html

    def test_input_model_select_css(self):
        css = _get_client().get("/static/styles.css").text
        assert ".input-model-select" in css

    def test_input_row_css(self):
        css = _get_client().get("/static/styles.css").text
        assert ".input-row" in css

    def test_input_icon_css(self):
        css = _get_client().get("/static/styles.css").text
        assert ".input-icon" in css

    def test_live_model_option_in_chat_select(self):
        html = _get_client().get("/").text
        assert 'value="gemini-2.0-flash-live-001"' in html

    def test_live_model_option_in_sidebar_select(self):
        html = _get_client().get("/").text
        assert 'gemini-2.0-flash-live' in html

    def test_input_attachments_inside_input_bar(self):
        html = _get_client().get("/").text
        assert 'id="inputAttachments"' in html

    def test_no_separate_toolbar(self):
        html = _get_client().get("/").text
        assert 'class="chat-input-toolbar"' not in html

    def test_chat_header_no_model_select(self):
        """Model selector moved from header into input bar."""
        html = _get_client().get("/").text
        header_idx = html.find('id="chatHeader"')
        input_idx = html.find('id="chatInputArea"')
        model_idx = html.find('id="chatModelSelect"')
        assert model_idx > input_idx

    def test_image_drag_drop_in_app_js(self):
        js = _get_client().get("/static/app.js").text
        assert "e.dataTransfer.files" in js


# ═══════════════════════════════════════════════════════════════════════════════
# TODO features: merge in left sidebar, topic selector, module rename, centering
# ═══════════════════════════════════════════════════════════════════════════════

class TestMergeTopicInLeftSidebar:
    """Merge button moved from right sidebar status to left sidebar topic headers."""

    def test_no_merge_button_in_status_actions(self):
        html = _get_client().get("/").text
        assert 'id="mergeTopicBtn"' not in html

    def test_merge_dialog_still_exists(self):
        html = _get_client().get("/").text
        assert 'id="mergeTopicDialog"' in html

    def test_app_js_has_open_merge_dialog(self):
        js = _get_client().get("/static/app.js").text
        assert '_openMergeDialog' in js

    def test_app_js_has_merge_source_topic_id(self):
        js = _get_client().get("/static/app.js").text
        assert '_mergeSourceTopicId' in js

    def test_sidebar_js_uses_merge_source_from_app(self):
        js = _get_client().get("/static/sidebar.js").text
        assert 'App._mergeSourceTopicId' in js

    def test_topic_merge_btn_css_exists(self):
        css = _get_client().get("/static/styles.css").text
        assert '.topic-merge-btn' in css

    def test_topic_merge_btn_hover_css(self):
        css = _get_client().get("/static/styles.css").text
        assert '.topic-merge-btn:hover' in css

    def test_app_js_renders_merge_btn_in_chat_list(self):
        js = _get_client().get("/static/app.js").text
        assert 'topic-merge-btn' in js


class TestTopicSelectorInInputBar:
    """Topic selector in chat input bar for pre-assigning topics."""

    def test_topic_select_exists_in_html(self):
        html = _get_client().get("/").text
        assert 'id="topicSelect"' in html

    def test_topic_select_has_auto_detect_option(self):
        html = _get_client().get("/").text
        assert 'Auto-detect' in html

    def test_topic_select_css_exists(self):
        css = _get_client().get("/static/styles.css").text
        assert '.input-topic-select' in css

    def test_app_js_has_selected_topic_id(self):
        js = _get_client().get("/static/app.js").text
        assert 'selectedTopicId' in js

    def test_app_js_has_populate_topic_selector(self):
        js = _get_client().get("/static/app.js").text
        assert '_populateTopicSelector' in js

    def test_app_js_injects_status_context(self):
        js = _get_client().get("/static/app.js").text
        assert 'statusSummary' in js

    def test_app_js_resets_topic_on_new_chat(self):
        js = _get_client().get("/static/app.js").text
        assert "topicSel" in js or "topicSelect" in js

    def test_render_chat_hides_selector_when_messages_exist(self):
        """Topic selector should be hidden when a chat already has messages."""
        js = _get_client().get("/static/app.js").text
        assert "topicSel.style.display = 'none'" in js or 'topicSel.style.display = "none"' in js

    def test_render_chat_shows_selector_for_empty_chat(self):
        """Topic selector should be visible for a new/empty chat."""
        js = _get_client().get("/static/app.js").text
        # In the messages.length === 0 branch, display is reset to show the selector
        idx = js.index("messages.length === 0")
        block = js[idx:idx+300]
        assert "style.display = ''" in block or 'style.display = ""' in block

    def test_send_message_hides_selector(self):
        """Topic selector should be hidden when a message is sent."""
        js = _get_client().get("/static/app.js").text
        # The sendMessage function hides the selector after exiting welcome mode
        send_start = js.index("async sendMessage()")
        # Find the next top-level method boundary (2-space indented function)
        next_fn = js.find("\n  async ", send_start + 1)
        if next_fn == -1:
            next_fn = js.find("\n  _", send_start + 100)
        send_body = js[send_start:next_fn] if next_fn != -1 else js[send_start:]
        assert "topicSelEl" in send_body
        assert "style.display = 'none'" in send_body


class TestModule2Rename:
    """Module 2 renamed from 'Related to this chat' to 'Linked past chats'."""

    def test_module_2_new_name_in_html(self):
        html = _get_client().get("/").text
        assert 'Linked past chats' in html

    def test_module_2_old_name_removed(self):
        html = _get_client().get("/").text
        assert 'Related to this chat' not in html


class TestModelSelectorCentering:
    """Model selector vertically centered in input bar."""

    def test_input_row_uses_center_alignment(self):
        css = _get_client().get("/static/styles.css").text
        assert '.input-row' in css
        import re
        match = re.search(r'\.input-row\s*\{([^}]+)\}', css)
        assert match
        assert 'align-items: center' in match.group(1)


# ═══════════════════════════════════════════════════════════════════════════════
# Welcome mode: centered chat bar + suggestion cards on default page
# ═══════════════════════════════════════════════════════════════════════════════

class TestWelcomeModeCSSExists:
    """Welcome mode CSS for centered layout on new chat page."""

    def test_welcome_mode_hides_header(self):
        css = _get_client().get("/static/styles.css").text
        assert '.main-content.welcome-mode .chat-header' in css

    def test_welcome_mode_centers_messages(self):
        css = _get_client().get("/static/styles.css").text
        assert '.main-content.welcome-mode .chat-messages' in css

    def test_welcome_mode_centers_input(self):
        css = _get_client().get("/static/styles.css").text
        assert '.main-content.welcome-mode .chat-input-container' in css

    def test_welcome_greeting_css(self):
        css = _get_client().get("/static/styles.css").text
        assert '.welcome-greeting' in css

    def test_welcome_icon_css(self):
        css = _get_client().get("/static/styles.css").text
        assert '.welcome-greeting .welcome-icon' in css

    def test_welcome_suggestions_css(self):
        css = _get_client().get("/static/styles.css").text
        assert '.welcome-suggestions' in css

    def test_welcome_suggestion_card_css(self):
        css = _get_client().get("/static/styles.css").text
        assert '.welcome-suggestion-card' in css

    def test_welcome_card_hover(self):
        css = _get_client().get("/static/styles.css").text
        assert '.welcome-suggestion-card:hover' in css

    def test_welcome_card_topic_css(self):
        css = _get_client().get("/static/styles.css").text
        assert '.welcome-card-topic' in css

    def test_welcome_card_question_css(self):
        css = _get_client().get("/static/styles.css").text
        assert '.welcome-card-question' in css


class TestWelcomeModeAppJS:
    """App.js has welcome mode rendering logic."""

    def test_welcome_mode_class_added(self):
        js = _get_client().get("/static/app.js").text
        assert "welcome-mode" in js

    def test_render_welcome_function(self):
        js = _get_client().get("/static/app.js").text
        assert '_renderWelcome' in js

    def test_get_suggestion_cards(self):
        js = _get_client().get("/static/app.js").text
        assert '_getSuggestionCards' in js

    def test_bind_suggestion_cards(self):
        js = _get_client().get("/static/app.js").text
        assert '_bindSuggestionCards' in js

    def test_start_suggested_chat(self):
        js = _get_client().get("/static/app.js").text
        assert '_startSuggestedChat' in js

    def test_welcome_greeting_text(self):
        js = _get_client().get("/static/app.js").text
        assert 'Where should we start?' in js

    def test_reads_sidebar_cache_directions(self):
        js = _get_client().get("/static/app.js").text
        assert 'sidebarCache' in js
        assert 'newDirections' in js

    def test_limits_to_3_topics(self):
        js = _get_client().get("/static/app.js").text
        assert 'slice(0, 3)' in js

    def test_injects_status_in_suggested_chat(self):
        js = _get_client().get("/static/app.js").text
        assert 'statusSummary' in js

    def test_exits_welcome_on_send(self):
        js = _get_client().get("/static/app.js").text
        assert "welcome-mode" in js
        assert "welcomeSuggestions" in js

    def test_suggestion_card_has_topic_color(self):
        js = _get_client().get("/static/app.js").text
        assert 'topic-color-dot' in js or 'getTopicColor' in js

    def test_auto_sends_on_suggestion_click(self):
        js = _get_client().get("/static/app.js").text
        assert 'sendMessage' in js


# ═══════════════════════════════════════════════════════════════════════════════
# Topic color algorithm: distant hue selection
# ═══════════════════════════════════════════════════════════════════════════════

class TestTopicColorAlgorithmJS:
    """Utils.js has HSL-based distant color algorithm."""

    def test_hsl_to_hex_function(self):
        js = _get_client().get("/static/utils.js").text
        assert '_hslToHex' in js

    def test_color_from_hue_function(self):
        js = _get_client().get("/static/utils.js").text
        assert 'colorFromHue' in js

    def test_find_distant_hue_function(self):
        js = _get_client().get("/static/utils.js").text
        assert 'findDistantHue' in js

    def test_topic_colors_have_hue_field(self):
        js = _get_client().get("/static/utils.js").text
        assert 'hue: 217' in js
        assert 'hue: 330' in js

    def test_get_topic_color_handles_object(self):
        js = _get_client().get("/static/utils.js").text
        assert 'colorHue' in js

    def test_get_topic_color_handles_legacy_index(self):
        js = _get_client().get("/static/utils.js").text
        assert 'TOPIC_COLORS[idx %' in js or 'TOPIC_COLORS[' in js


class TestTopicColorStorageJS:
    """Storage.js uses hue algorithm for new topics."""

    def test_storage_computes_color_hue(self):
        js = _get_client().get("/static/storage.js").text
        assert 'colorHue' in js

    def test_storage_calls_find_distant_hue(self):
        js = _get_client().get("/static/storage.js").text
        assert 'findDistantHue' in js

    def test_storage_collects_existing_hues(self):
        js = _get_client().get("/static/storage.js").text
        assert 'existingHues' in js

    def test_storage_handles_legacy_color_index(self):
        js = _get_client().get("/static/storage.js").text
        assert 'colorIndex' in js


class TestTopicColorCallersUpdated:
    """All getTopicColor callers pass topic object for hue support."""

    def test_sidebar_passes_topic_object(self):
        js = _get_client().get("/static/sidebar.js").text
        assert 'getTopicColor(topic)' in js

    def test_app_passes_topic_object_in_chat_item(self):
        js = _get_client().get("/static/app.js").text
        assert 'getTopicColor(topic)' in js

    def test_app_passes_topic_color_in_welcome(self):
        js = _get_client().get("/static/app.js").text
        assert 'topicColorObj' in js


# ═══════════════════════════════════════════════════════════════════════════════
# Streaming scroll behavior: no auto-scroll during streaming
# ═══════════════════════════════════════════════════════════════════════════════

class TestStreamingScrollBehavior:
    """Streaming should not auto-scroll to bottom; only scroll start of msg into view."""

    def test_create_streaming_uses_scroll_into_view(self):
        js = _get_client().get("/static/app.js").text
        assert 'scrollIntoView' in js

    def test_update_streaming_no_scroll(self):
        js = _get_client().get("/static/app.js").text
        lines = js.split('\n')
        in_update = False
        for line in lines:
            if '_updateStreamingMessage' in line and 'function' not in line and '(' in line:
                in_update = True
            if in_update:
                assert 'scrollTop' not in line or '_updateStreamingMessage' in line
                if line.strip().startswith('},') or (line.strip() == '},' and in_update):
                    break

    def test_finalize_streaming_no_scroll(self):
        js = _get_client().get("/static/app.js").text
        finalize_section = js.split('_finalizeStreamingMessage')[1].split('},')[0]
        assert 'scrollTop' not in finalize_section


# ═══════════════════════════════════════════════════════════════════════════════
# Markdown table rendering
# ═══════════════════════════════════════════════════════════════════════════════

class TestMarkdownTableRendering:
    """Tables in markdown should be rendered as proper HTML tables."""

    def test_utils_has_table_regex(self):
        js = _get_client().get("/static/utils.js").text
        assert 'md-table' in js

    def test_table_produces_thead_tbody(self):
        js = _get_client().get("/static/utils.js").text
        assert '<thead>' in js
        assert '<tbody>' in js

    def test_table_css_exists(self):
        css = _get_client().get("/static/styles.css").text
        assert '.md-table' in css

    def test_table_th_styling(self):
        css = _get_client().get("/static/styles.css").text
        assert '.md-table th' in css

    def test_table_td_styling(self):
        css = _get_client().get("/static/styles.css").text
        assert '.md-table td' in css

    def test_table_hover_row(self):
        css = _get_client().get("/static/styles.css").text
        assert '.md-table tbody tr:hover' in css

    def test_clean_br_around_tables(self):
        js = _get_client().get("/static/utils.js").text
        assert '<table' in js
        assert '</table>' in js


# ═══════════════════════════════════════════════════════════════════════════════
# Merge topics: drag-and-drop + seamless update
# ═══════════════════════════════════════════════════════════════════════════════

class TestMergeTopicDragAndDrop:
    """Topic groups in By Topic view should support drag-and-drop merging."""

    def test_topic_title_has_draggable(self):
        js = _get_client().get("/static/app.js").text
        assert 'draggable = true' in js or 'draggable=true' in js or '.draggable = true' in js

    def test_dragstart_sets_topic_id(self):
        js = _get_client().get("/static/app.js").text
        assert 'text/topic-id' in js

    def test_dragover_handler_exists(self):
        js = _get_client().get("/static/app.js").text
        assert 'dragover' in js

    def test_drop_handler_calls_merge(self):
        js = _get_client().get("/static/app.js").text
        assert '_mergeTopics' in js

    def test_topic_dragging_css(self):
        css = _get_client().get("/static/styles.css").text
        assert 'topic-dragging' in css

    def test_topic_drop_target_css(self):
        css = _get_client().get("/static/styles.css").text
        assert 'topic-drop-target' in css

    def test_drop_target_has_visual_indicator(self):
        css = _get_client().get("/static/styles.css").text
        assert 'dashed' in css


class TestMergeTopicsSharedLogic:
    """The _mergeTopics method should be in App and used by both drag-drop and dialog."""

    def test_merge_topics_method_exists(self):
        js = _get_client().get("/static/app.js").text
        assert '_mergeTopics(' in js or '_mergeTopics (' in js

    def _get_merge_body(self):
        js = _get_client().get("/static/app.js").text
        parts = js.split('async _mergeTopics(')
        assert len(parts) >= 2, '_mergeTopics definition not found'
        return parts[1].split('\n  },')[0]

    def test_merge_topics_deletes_absorbed(self):
        assert 'deleteTopic' in self._get_merge_body()

    def test_merge_topics_moves_chats(self):
        assert 'getChatsByTopic' in self._get_merge_body()

    def test_merge_topics_shows_toast(self):
        assert 'showToast' in self._get_merge_body()

    def test_sidebar_dialog_uses_app_merge(self):
        js = _get_client().get("/static/sidebar.js").text
        assert 'App._mergeTopics' in js

    def test_merge_topics_refreshes_chat_list(self):
        assert '_renderChatList' in self._get_merge_body()

    def test_merge_topics_updates_topic_selector(self):
        assert '_populateTopicSelector' in self._get_merge_body()


# ═══════════════════════════════════════════════════════════════════════════════
# Topic color migration runs on init
# ═══════════════════════════════════════════════════════════════════════════════

class TestTopicColorMigration:
    """migrateTopicColors should reassign all topics on init."""

    def test_migrate_method_exists_in_storage(self):
        js = _get_client().get("/static/storage.js").text
        assert 'migrateTopicColors' in js

    def test_migrate_called_on_init(self):
        js = _get_client().get("/static/app.js").text
        assert 'Storage.migrateTopicColors()' in js

    def test_migrate_assigns_color_hue(self):
        js = _get_client().get("/static/storage.js").text
        assert 'colorHue' in js

    def test_migrate_uses_find_distant_hue(self):
        js = _get_client().get("/static/storage.js").text
        migrate_section = js.split('migrateTopicColors')[1].split('},')[0]
        assert 'findDistantHue' in migrate_section

    def test_migrate_deletes_legacy_color_index(self):
        js = _get_client().get("/static/storage.js").text
        migrate_section = js.split('migrateTopicColors')[1].split('},')[0]
        assert 'delete' in migrate_section and 'colorIndex' in migrate_section


# ═══════════════════════════════════════════════════════════════════════════════
# Cache busting + no-cache headers
# ═══════════════════════════════════════════════════════════════════════════════

class TestCacheBusting:
    """Static files should have version params; index.html should have no-cache."""

    def test_index_has_no_cache_header(self):
        resp = _get_client().get("/")
        assert 'no-cache' in resp.headers.get('cache-control', '')

    def test_css_has_version_param(self):
        html = _get_client().get("/").text
        assert 'styles.css?v=' in html

    def test_js_files_have_version_param(self):
        html = _get_client().get("/").text
        assert 'app.js?v=' in html
        assert 'utils.js?v=' in html
        assert 'storage.js?v=' in html
        assert 'sidebar.js?v=' in html


# ═══════════════════════════════════════════════════════════════════════════════
# Structured Status Summary
# ═══════════════════════════════════════════════════════════════════════════════

class TestStructuredStatus:
    """Tests for the new structured status summary (overview + specifics)."""

    def test_status_prompt_returns_structured_format(self):
        structured = {
            "overview": ["CS student, comfortable with classical ML"],
            "specifics": [{"text": "Raft consensus", "level": "solid"}],
        }
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=structured)
            data = _get_client().post("/api/topic/status/update", json={
                "topicName": "Distributed Systems",
                "currentStatus": "",
                "recentSummaries": ["Discussed Raft protocol"],
            }).json()
            assert "overview" in data
            assert "specifics" in data
            assert data["overview"][0] == "CS student, comfortable with classical ML"

    def test_sidebar_refresh_passes_through_structured_status(self):
        structured = {
            "overview": ["Background in philosophy"],
            "specifics": [{"text": "Kant's ethics", "level": "familiar"}],
        }
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value=structured)
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            data = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
                "topicId": "t1", "topicName": "Phil", "topicStatus": "",
                "allChatSummaries": [], "allConcepts": [],
            }).json()
            assert isinstance(data["statusUpdate"], dict)
            assert "overview" in data["statusUpdate"]

    def test_legacy_string_status_still_works(self):
        legacy = {"status": "User is learning ML basics."}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=legacy)
            data = _get_client().post("/api/topic/status/update", json={
                "topicName": "ML",
                "currentStatus": "",
                "recentSummaries": ["Asked about neural networks"],
            }).json()
            assert data["status"] == "User is learning ML basics."

    def test_sidebar_handles_legacy_string(self):
        legacy = {"status": "User knows Python well."}
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value=legacy)
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            data = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
                "topicId": "t1", "topicName": "Dev", "topicStatus": "",
                "allChatSummaries": [], "allConcepts": [],
            }).json()
            assert data["statusUpdate"] == "User knows Python well."


class TestStructuredStatusPrompt:
    """Tests for prompt content and format."""

    def test_prompt_asks_for_overview_and_specifics(self):
        from prompts import STATUS_UPDATE_PROMPT
        assert "overview" in STATUS_UPDATE_PROMPT.lower()
        assert "specifics" in STATUS_UPDATE_PROMPT.lower()
        assert '"level"' in STATUS_UPDATE_PROMPT

    def test_prompt_mentions_understanding_levels(self):
        from prompts import STATUS_UPDATE_PROMPT
        assert "solid" in STATUS_UPDATE_PROMPT
        assert "familiar" in STATUS_UPDATE_PROMPT
        assert "brief" in STATUS_UPDATE_PROMPT


class TestStructuredStatusUI:
    """Tests for frontend rendering of structured status."""

    def _read_file(self, path):
        full = Path(__file__).parent.parent / path
        return full.read_text()

    def test_status_structured_container_exists(self):
        html = self._read_file("frontend/index.html")
        assert 'id="statusStructured"' in html
        assert 'draggable="true"' in html

    def test_css_has_status_section_styles(self):
        css = self._read_file("frontend/styles.css")
        assert ".status-section-label" in css
        assert ".status-item" in css
        assert ".status-item-actions" in css
        assert ".status-level" in css

    def test_css_level_badges(self):
        css = self._read_file("frontend/styles.css")
        assert ".level-solid" in css
        assert ".level-familiar" in css
        assert ".level-brief" in css

    def test_hover_reveals_actions(self):
        css = self._read_file("frontend/styles.css")
        assert ".status-item-actions" in css
        assert "opacity: 0" in css
        assert ".status-item:hover .status-item-actions" in css

    def test_inline_edit_style(self):
        css = self._read_file("frontend/styles.css")
        assert ".status-inline-edit" in css

    def test_sidebar_has_render_status(self):
        js = self._read_file("frontend/sidebar.js")
        assert "_renderStatus" in js
        assert "_bindStatusItemActions" in js
        assert "_deleteStatusItem" in js
        assert "_editStatusItem" in js
        assert "_serializeStatus" in js

    def test_render_status_handles_legacy_string(self):
        js = self._read_file("frontend/sidebar.js")
        assert "typeof statusData === 'string'" in js

    def test_render_status_handles_null(self):
        js = self._read_file("frontend/sidebar.js")
        assert "No status yet" in js

    def test_delete_btn_and_edit_btn_in_render(self):
        js = self._read_file("frontend/sidebar.js")
        assert "status-item-edit" in js
        assert "status-item-del" in js


# ═══════════════════════════════════════════════════════════════════════════════
# Dict topicStatus / currentStatus (backend accepts both str and dict)
# ═══════════════════════════════════════════════════════════════════════════════

class TestDictTopicStatus:
    """Verify backend accepts structured status objects without 422."""

    def test_sidebar_refresh_with_dict_topic_status(self):
        structured_status = {
            "overview": ["CS student learning distributed systems"],
            "specifics": [{"text": "Raft consensus", "level": "solid"}],
        }
        result = {
            "overview": ["CS student learning distributed systems"],
            "specifics": [{"text": "Raft consensus", "level": "solid"},
                          {"text": "Paxos", "level": "brief"}],
        }
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value=result)
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            resp = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "topicId": "t1", "topicName": "DS",
                "topicStatus": structured_status,
                "allChatSummaries": [], "allConcepts": [],
            })
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data["statusUpdate"], dict)
            assert "overview" in data["statusUpdate"]

    def test_sidebar_refresh_with_string_topic_status(self):
        result = {
            "overview": ["New learner"],
            "specifics": [],
        }
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat = AsyncMock(return_value=result)
            emb.embed_text = AsyncMock(return_value=[0.1] * 10)
            resp = _get_client().post("/api/sidebar/refresh", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "topicId": "t1", "topicName": "DS",
                "topicStatus": "User is a CS student.",
                "allChatSummaries": [], "allConcepts": [],
            })
            assert resp.status_code == 200

    def test_status_update_with_dict_current_status(self):
        structured_current = {
            "overview": ["Learning ML"],
            "specifics": [{"text": "Linear regression", "level": "familiar"}],
        }
        result = {
            "overview": ["Learning ML, explored neural nets"],
            "specifics": [{"text": "Linear regression", "level": "solid"},
                          {"text": "Backpropagation", "level": "brief"}],
        }
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=result)
            resp = _get_client().post("/api/topic/status/update", json={
                "topicName": "ML",
                "currentStatus": structured_current,
                "recentSummaries": ["Discussed backpropagation"],
            })
            assert resp.status_code == 200
            data = resp.json()
            assert "overview" in data

    def test_status_update_with_empty_dict(self):
        result = {"overview": ["Fresh start"], "specifics": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=result)
            resp = _get_client().post("/api/topic/status/update", json={
                "topicName": "New Topic",
                "currentStatus": {"overview": [], "specifics": []},
                "recentSummaries": ["First chat"],
            })
            assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# Auto-versioned cache busting
# ═══════════════════════════════════════════════════════════════════════════════

class TestAutoVersionCacheBusting:
    """Verify index.html uses __CACHE_VERSION__ placeholders that get replaced."""

    def _read_file(self, path):
        full = Path(__file__).parent.parent / path
        return full.read_text()

    def test_html_has_cache_version_placeholder(self):
        html = self._read_file("frontend/index.html")
        assert "__CACHE_VERSION__" in html
        import re
        matches = re.findall(r'\?v=__CACHE_VERSION__', html)
        assert len(matches) >= 5  # 1 CSS + 4 JS

    def test_html_has_no_hardcoded_version_numbers(self):
        html = self._read_file("frontend/index.html")
        import re
        hardcoded = re.findall(r'\?v=\d+', html)
        assert len(hardcoded) == 0, f"Found hardcoded versions: {hardcoded}"

    def test_served_html_has_numeric_version(self):
        resp = _get_client().get("/")
        html = resp.text
        assert "__CACHE_VERSION__" not in html
        import re
        versions = re.findall(r'\?v=(\d+)', html)
        assert len(versions) >= 5
        assert all(int(v) > 1000000000 for v in versions)

    def test_served_html_no_cache_header(self):
        resp = _get_client().get("/")
        assert "no-cache" in resp.headers.get("cache-control", "")

    def test_static_files_no_cache_header(self):
        resp = _get_client().get("/static/sidebar.js")
        assert resp.status_code == 200
        assert "no-cache" in resp.headers.get("cache-control", "")

    def test_main_has_static_version(self):
        py = self._read_file("backend/main.py")
        assert "STATIC_VERSION" in py
        assert "time.time()" in py


# ═══════════════════════════════════════════════════════════════════════════════
# Null-guards in sidebar.js
# ═══════════════════════════════════════════════════════════════════════════════

class TestSidebarNullGuards:
    """Verify sidebar.js has defensive null-checks for DOM elements."""

    def _read_file(self, path):
        full = Path(__file__).parent.parent / path
        return full.read_text()

    def test_has_get_status_container_helper(self):
        js = self._read_file("frontend/sidebar.js")
        assert "_getStatusContainer" in js
        assert "statusStructured" in js
        assert "statusText" in js

    def test_init_status_drag_has_guard(self):
        js = self._read_file("frontend/sidebar.js")
        defn = js.index("_initStatusDrag() {")
        drag_section = js[defn:js.index("},", defn)]
        assert "_getStatusContainer" in drag_section
        assert "if (!el) return" in drag_section

    def test_render_status_has_guard(self):
        js = self._read_file("frontend/sidebar.js")
        defn = js.index("_renderStatus(statusData) {")
        render_section = js[defn:js.index("\n  },\n", defn)]
        assert "_getStatusContainer" in render_section
        assert "if (!container) return" in render_section

    def test_render_status_falls_back_for_old_html(self):
        js = self._read_file("frontend/sidebar.js")
        assert "container.id === 'statusText'" in js
        assert "_serializeStatus" in js

    def test_show_loading_has_guard(self):
        js = self._read_file("frontend/sidebar.js")
        assert "const sc = this._getStatusContainer()" in js


# ═══════════════════════════════════════════════════════════════════════════════
# Sidebar collapse toggle buttons
# ═══════════════════════════════════════════════════════════════════════════════

class TestSidebarCollapseToggle:
    """Collapse/expand toggle buttons on sidebar boundaries."""

    def test_collapse_left_btn_in_html(self):
        html = _get_client().get("/").text
        assert 'id="collapseLeftBtn"' in html
        assert 'sidebar-collapse-btn' in html

    def test_collapse_right_btn_in_html(self):
        html = _get_client().get("/").text
        assert 'id="collapseRightBtn"' in html

    def test_collapse_btn_css_exists(self):
        css = _get_client().get("/static/styles.css").text
        assert '.sidebar-collapse-btn' in css

    def test_collapsed_state_css_exists(self):
        css = _get_client().get("/static/styles.css").text
        assert '.left-sidebar.collapsed' in css
        assert '.right-sidebar.collapsed' in css

    def test_app_js_has_init_collapse_toggle(self):
        js = _get_client().get("/static/app.js").text
        assert '_initCollapseToggle' in js

    def test_app_js_collapse_toggles_class(self):
        js = _get_client().get("/static/app.js").text
        assert "classList.toggle('collapsed')" in js

    def test_app_js_flips_arrow_on_collapse(self):
        js = _get_client().get("/static/app.js").text
        assert 'svg.innerHTML' in js

    def test_resize_handle_ignores_btn_click(self):
        """Resize drag should not start when clicking the collapse button."""
        js = _get_client().get("/static/app.js").text
        assert "sidebar-collapse-btn" in js


# ═══════════════════════════════════════════════════════════════════════════════
# Attachment data preserved in sent messages
# ═══════════════════════════════════════════════════════════════════════════════

class TestAttachmentDataInMessages:
    """Image attachment base64 data must be stored in the message for rendering."""

    def test_user_msg_includes_attachment_data(self):
        """The userMsg object should include data field from pendingAttachments."""
        js = _get_client().get("/static/app.js").text
        idx = js.index("attachments: this.pendingAttachments.length > 0")
        block = js[idx:idx+200]
        assert "a.data" in block

    def test_append_message_renders_base64_image(self):
        """_appendMessage should render image attachments using data: URL."""
        js = _get_client().get("/static/app.js").text
        assert "data:${att.mimeType};base64,${att.data}" in js


# ═══════════════════════════════════════════════════════════════════════════════
# Bug fixes: status serialization, image fallback, delete btn, status prompt
# ═══════════════════════════════════════════════════════════════════════════════


class TestBug1StatusSerialization:
    """Status must be serialized before interpolation into chat prompt."""

    def test_app_js_uses_serialize_status_for_topic_injection(self):
        js = _get_client().get("/static/app.js").text
        assert "Sidebar._serializeStatus(topic.statusSummary)" in js

    def test_app_js_uses_serialize_status_for_suggestion_cards(self):
        js = _get_client().get("/static/app.js").text
        assert "Sidebar._serializeStatus(topic.statusSummary) || ''" in js

    def test_sidebar_serialize_status_handles_string(self):
        js = _get_client().get("/static/sidebar.js").text
        assert "_serializeStatus" in js
        assert "typeof statusSummary === 'string'" in js

    def test_stream_metadata_list_fallback(self):
        """If LLM returns a list instead of dict for metadata, it should not crash."""
        async def fake_stream(*args, **kwargs):
            yield "Answer"
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value=[{"topic": {"name": "ML"}, "concepts": []}])
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1", "messages": [{"role": "user", "content": "hi"}],
            })
            assert resp.status_code == 200
            events = []
            for line in resp.text.split("\n"):
                if line.startswith("data: "):
                    import json as _j
                    events.append(_j.loads(line[6:]))
            done = [e for e in events if e["type"] == "done"]
            assert len(done) == 1
            assert done[0]["topic"]["name"] == "ML"


class TestBug2ImageFallback:
    """Image attachments without data should fall back to filename, not broken img."""

    def test_append_message_checks_att_data_before_img(self):
        js = _get_client().get("/static/app.js").text
        assert "att.mimeType.startsWith('image/') && att.data)" in js

    def test_missing_data_falls_through_to_filename(self):
        js = _get_client().get("/static/app.js").text
        idx = js.index("_appendMessage(msg) {")
        block = js[idx:idx+800]
        assert "att.data" in block
        assert "att.name || 'file'" in block


class TestBug3DeleteBtnOverlay:
    """Delete button should overlay text on hover, not take permanent space."""

    def test_chat_delete_btn_is_absolute(self):
        css = _get_client().get("/static/styles.css").text
        idx = css.index(".chat-delete-btn {")
        block = css[idx:idx+400]
        assert "position: absolute" in block

    def test_chat_item_is_relative(self):
        css = _get_client().get("/static/styles.css").text
        idx = css.index(".chat-item {")
        block = css[idx:idx+300]
        assert "position: relative" in block

    def test_delete_btn_has_gradient_bg(self):
        css = _get_client().get("/static/styles.css").text
        idx = css.index(".chat-delete-btn {")
        block = css[idx:idx+400]
        assert "linear-gradient" in block


class TestBug4StatusPromptNotes:
    """Status prompt should capture user-provided notes and self-reported knowledge."""

    def test_prompt_mentions_self_reported(self):
        from prompts import STATUS_UPDATE_PROMPT
        assert "self-reported" in STATUS_UPDATE_PROMPT

    def test_prompt_mentions_user_notes(self):
        from prompts import STATUS_UPDATE_PROMPT
        assert "notes" in STATUS_UPDATE_PROMPT.lower()

    def test_prompt_mentions_stated_expertise(self):
        from prompts import STATUS_UPDATE_PROMPT
        assert "stated expertise" in STATUS_UPDATE_PROMPT
