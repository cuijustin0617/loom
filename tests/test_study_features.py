"""Comprehensive tests for user study features: logging, sync, directions, baseline, admin."""

import sys
import os
import json
import sqlite3
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def isolate_db(tmp_path, monkeypatch):
    """Use a fresh temp database for every test to avoid cross-contamination."""
    db_path = tmp_path / "test_study.db"
    monkeypatch.setenv("LOOM_DATA_DIR", str(tmp_path))

    import main as _main
    _main.DB_PATH = db_path
    _main.DATA_DIR = tmp_path
    _main._init_db()
    yield db_path


def _client():
    from main import app
    return TestClient(app)


# ═══════════════════════════════════════════════════════════════════════════════
# SQLite Database Initialization
# ═══════════════════════════════════════════════════════════════════════════════

class TestDatabaseInit:
    def test_tables_created(self, isolate_db):
        conn = sqlite3.connect(str(isolate_db))
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        conn.close()
        assert "events" in tables
        assert "user_data" in tables
        assert "users" in tables

    def test_events_columns(self, isolate_db):
        conn = sqlite3.connect(str(isolate_db))
        cols = [r[1] for r in conn.execute("PRAGMA table_info(events)").fetchall()]
        conn.close()
        assert "user_id" in cols
        assert "condition" in cols
        assert "event_type" in cols
        assert "event_data" in cols
        assert "timestamp" in cols

    def test_user_data_columns(self, isolate_db):
        conn = sqlite3.connect(str(isolate_db))
        cols = [r[1] for r in conn.execute("PRAGMA table_info(user_data)").fetchall()]
        conn.close()
        assert "user_id" in cols
        assert "data" in cols
        assert "updated_at" in cols

    def test_indexes_created(self, isolate_db):
        conn = sqlite3.connect(str(isolate_db))
        indexes = [r[1] for r in conn.execute("PRAGMA index_list(events)").fetchall()]
        conn.close()
        assert "idx_events_user" in indexes
        assert "idx_events_type" in indexes

    def test_idempotent_init(self, isolate_db):
        """Calling _init_db() twice should not fail."""
        import main
        main._init_db()
        main._init_db()
        conn = sqlite3.connect(str(isolate_db))
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        conn.close()
        assert "events" in tables


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/log — Event Logging
# ═══════════════════════════════════════════════════════════════════════════════

class TestLogEndpoint:
    def test_basic_log_event(self, isolate_db):
        resp = _client().post("/api/log", json={
            "userId": "P01-loom",
            "condition": "loom",
            "eventType": "session_start",
            "data": {},
            "timestamp": "2026-03-10T10:00:00",
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        conn = sqlite3.connect(str(isolate_db))
        rows = conn.execute("SELECT * FROM events").fetchall()
        conn.close()
        assert len(rows) == 1
        assert rows[0][1] == "P01-loom"  # user_id
        assert rows[0][2] == "loom"      # condition
        assert rows[0][3] == "session_start"  # event_type

    def test_log_with_data_payload(self, isolate_db):
        resp = _client().post("/api/log", json={
            "userId": "P02-baseline",
            "condition": "baseline",
            "eventType": "query_sent",
            "data": {"chatId": "chat_123", "topicId": "topic_456", "hasContext": True},
            "timestamp": "2026-03-10T10:01:00",
        })
        assert resp.status_code == 200
        conn = sqlite3.connect(str(isolate_db))
        row = conn.execute("SELECT event_data FROM events WHERE user_id = 'P02-baseline'").fetchone()
        conn.close()
        data = json.loads(row[0])
        assert data["chatId"] == "chat_123"
        assert data["hasContext"] is True

    def test_log_auto_timestamp(self, isolate_db):
        """When timestamp is empty, server should generate one."""
        resp = _client().post("/api/log", json={
            "userId": "P03-loom",
            "eventType": "chat_created",
            "data": {"chatId": "c1"},
            "timestamp": "",
        })
        assert resp.status_code == 200
        conn = sqlite3.connect(str(isolate_db))
        row = conn.execute("SELECT timestamp FROM events").fetchone()
        conn.close()
        assert row[0] != ""
        assert "T" in row[0]

    def test_log_default_condition(self, isolate_db):
        """Default condition should be 'loom'."""
        resp = _client().post("/api/log", json={
            "userId": "P04",
            "eventType": "test",
        })
        assert resp.status_code == 200
        conn = sqlite3.connect(str(isolate_db))
        row = conn.execute("SELECT condition FROM events").fetchone()
        conn.close()
        assert row[0] == "loom"

    def test_log_multiple_events_ordering(self, isolate_db):
        client = _client()
        for i in range(5):
            client.post("/api/log", json={
                "userId": "P05-loom",
                "eventType": f"event_{i}",
                "timestamp": f"2026-03-10T10:0{i}:00",
            })
        conn = sqlite3.connect(str(isolate_db))
        rows = conn.execute("SELECT event_type FROM events ORDER BY id").fetchall()
        conn.close()
        assert [r[0] for r in rows] == [f"event_{i}" for i in range(5)]

    def test_log_all_event_types(self, isolate_db):
        """Test that all planned event types can be logged."""
        event_types = [
            "session_start", "session_end", "query_sent", "topic_created",
            "topic_assigned", "chat_unassigned", "summary_edited", "summary_updated",
            "module1_viewed", "module2_connection_shown", "module2_connection_clicked",
            "module3_direction_clicked", "module3_direction_dragged", "module3_shuffled",
            "sidebar_refreshed", "chat_created", "chat_deleted",
            "context_block_added", "baseline_details_shown",
        ]
        client = _client()
        for et in event_types:
            resp = client.post("/api/log", json={
                "userId": "P-all",
                "eventType": et,
            })
            assert resp.status_code == 200, f"Failed for event type: {et}"

        conn = sqlite3.connect(str(isolate_db))
        count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        conn.close()
        assert count == len(event_types)

    def test_log_missing_userId(self):
        resp = _client().post("/api/log", json={
            "eventType": "test",
        })
        assert resp.status_code == 422

    def test_log_missing_eventType(self):
        resp = _client().post("/api/log", json={
            "userId": "P01",
        })
        assert resp.status_code == 422

    def test_log_empty_data_dict(self, isolate_db):
        resp = _client().post("/api/log", json={
            "userId": "P-empty",
            "eventType": "test",
            "data": {},
        })
        assert resp.status_code == 200
        conn = sqlite3.connect(str(isolate_db))
        row = conn.execute("SELECT event_data FROM events").fetchone()
        conn.close()
        assert json.loads(row[0]) == {}

    def test_log_complex_nested_data(self, isolate_db):
        resp = _client().post("/api/log", json={
            "userId": "P-nested",
            "eventType": "summary_edited",
            "data": {
                "topicId": "t1",
                "section": "overview",
                "editType": "edit",
                "oldValue": "Old text",
                "newValue": "New text",
            },
        })
        assert resp.status_code == 200
        conn = sqlite3.connect(str(isolate_db))
        row = conn.execute("SELECT event_data FROM events").fetchone()
        conn.close()
        data = json.loads(row[0])
        assert data["editType"] == "edit"
        assert data["oldValue"] == "Old text"


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/sync — Data Sync (Push)
# ═══════════════════════════════════════════════════════════════════════════════

class TestSyncPush:
    def test_push_new_user(self, isolate_db):
        blob = {"topics": [], "chats": [], "messages": {}, "concepts": [], "currentChatId": None}
        resp = _client().post("/api/sync", json={"userId": "P01-loom", "data": blob})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        conn = sqlite3.connect(str(isolate_db))
        row = conn.execute("SELECT data FROM user_data WHERE user_id = 'P01-loom'").fetchone()
        conn.close()
        assert json.loads(row[0]) == blob

    def test_push_overwrites_existing(self, isolate_db):
        client = _client()
        blob1 = {"topics": [{"id": "t1", "name": "Old"}], "chats": [], "messages": {}, "concepts": []}
        blob2 = {"topics": [{"id": "t1", "name": "New"}, {"id": "t2", "name": "Added"}], "chats": [], "messages": {}, "concepts": []}

        client.post("/api/sync", json={"userId": "P02", "data": blob1})
        client.post("/api/sync", json={"userId": "P02", "data": blob2})

        conn = sqlite3.connect(str(isolate_db))
        row = conn.execute("SELECT data FROM user_data WHERE user_id = 'P02'").fetchone()
        conn.close()
        stored = json.loads(row[0])
        assert len(stored["topics"]) == 2
        assert stored["topics"][0]["name"] == "New"

    def test_push_complex_blob(self, isolate_db):
        blob = {
            "topics": [{"id": "t1", "name": "ML", "colorHue": 120, "statusSummary": {"overview": ["CS student"]}}],
            "chats": [
                {"id": "c1", "topicId": "t1", "title": "Neural Nets", "summary": "Discussed NN architectures"},
                {"id": "c2", "topicId": None, "title": "New Chat"},
            ],
            "messages": {
                "c1": [
                    {"role": "user", "content": "What is a neural net?"},
                    {"role": "assistant", "content": "A neural network is..."},
                ],
            },
            "concepts": [{"id": "concept_1", "topicId": "t1", "title": "Backprop", "preview": "Learning alg"}],
            "currentChatId": "c1",
            "personalDetails": ["CS student at MIT"],
        }
        resp = _client().post("/api/sync", json={"userId": "P-complex", "data": blob})
        assert resp.status_code == 200

    def test_push_separate_users_isolated(self, isolate_db):
        client = _client()
        client.post("/api/sync", json={"userId": "P01-loom", "data": {"topics": [{"id": "t1"}]}})
        client.post("/api/sync", json={"userId": "P01-baseline", "data": {"topics": []}})

        loom_pulled = client.get("/api/sync", params={"userId": "P01-loom"}).json()["data"]
        baseline_pulled = client.get("/api/sync", params={"userId": "P01-baseline"}).json()["data"]
        assert len(loom_pulled["topics"]) == 1
        assert len(baseline_pulled["topics"]) == 0

    def test_push_missing_userId(self):
        resp = _client().post("/api/sync", json={"data": {}})
        assert resp.status_code == 422

    def test_push_missing_data(self):
        resp = _client().post("/api/sync", json={"userId": "P01"})
        assert resp.status_code == 422


# ═══════════════════════════════════════════════════════════════════════════════
# GET /api/sync — Data Sync (Pull)
# ═══════════════════════════════════════════════════════════════════════════════

class TestSyncPull:
    def test_pull_existing_user(self, isolate_db):
        blob = {"topics": [{"id": "t1"}], "chats": []}
        client = _client()
        client.post("/api/sync", json={"userId": "P01", "data": blob})

        resp = client.get("/api/sync", params={"userId": "P01"})
        assert resp.status_code == 200
        assert resp.json()["data"]["topics"] == [{"id": "t1"}]

    def test_pull_nonexistent_user(self):
        resp = _client().get("/api/sync", params={"userId": "NONEXISTENT"})
        assert resp.status_code == 200
        assert resp.json()["data"] is None

    def test_pull_missing_userId_param(self):
        resp = _client().get("/api/sync")
        assert resp.status_code == 422

    def test_roundtrip_fidelity(self, isolate_db):
        """Data pushed should be identical when pulled back."""
        blob = {
            "topics": [{"id": "t1", "name": "ML", "colorHue": 200}],
            "chats": [{"id": "c1", "title": "Chat 1", "topicId": "t1"}],
            "messages": {"c1": [{"role": "user", "content": "Hello"}]},
            "concepts": [],
            "currentChatId": "c1",
            "personalDetails": ["Detail 1", "Detail 2"],
        }
        client = _client()
        client.post("/api/sync", json={"userId": "P-round", "data": blob})
        pulled = client.get("/api/sync", params={"userId": "P-round"}).json()["data"]
        assert pulled == blob

    def test_pull_after_multiple_pushes(self, isolate_db):
        """Should return the most recently pushed data."""
        client = _client()
        client.post("/api/sync", json={"userId": "P-multi", "data": {"version": 1}})
        client.post("/api/sync", json={"userId": "P-multi", "data": {"version": 2}})
        client.post("/api/sync", json={"userId": "P-multi", "data": {"version": 3}})
        pulled = client.get("/api/sync", params={"userId": "P-multi"}).json()["data"]
        assert pulled["version"] == 3


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/sidebar/directions — Shuffle Directions
# ═══════════════════════════════════════════════════════════════════════════════

class TestDirectionsEndpoint:
    def test_basic_directions(self):
        mock_result = {"newDirections": [
            {"title": "Explore CNNs", "question": "How do CNNs differ from regular NNs?"},
            {"title": "Transfer Learning", "question": "What is transfer learning?"},
        ]}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _client().post("/api/sidebar/directions", json={
                "topicName": "Machine Learning",
                "topicStatus": "Beginner in ML",
                "allConcepts": [],
                "currentSummary": "user: What is ML?",
            })
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["newDirections"]) == 2
            assert data["newDirections"][0]["title"] == "Explore CNNs"

    def test_directions_with_dict_status(self):
        mock_result = {"newDirections": [{"title": "T1", "question": "Q1"}]}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _client().post("/api/sidebar/directions", json={
                "topicName": "ML",
                "topicStatus": {
                    "overview": ["CS student", "Knows Python"],
                    "specifics": [
                        {"text": "Learned about neural nets", "level": "familiar"},
                        {"text": "Touched on backprop", "level": "brief"},
                    ],
                },
                "allConcepts": [{"title": "Neural Nets", "preview": "Basic architecture"}],
                "currentSummary": "user: Tell me about loss functions",
            })
            assert resp.status_code == 200
            assert len(resp.json()["newDirections"]) == 1

    def test_directions_empty_result(self):
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value={"newDirections": []})
            resp = _client().post("/api/sidebar/directions", json={
                "topicName": "Test",
            })
            assert resp.status_code == 200
            assert resp.json()["newDirections"] == []

    def test_directions_non_dict_llm_result(self):
        """If LLM returns a non-dict, endpoint should return empty list."""
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value="unexpected string")
            resp = _client().post("/api/sidebar/directions", json={
                "topicName": "Test",
            })
            assert resp.status_code == 200
            assert resp.json()["newDirections"] == []

    def test_directions_llm_returns_list(self):
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=[{"title": "A"}])
            resp = _client().post("/api/sidebar/directions", json={
                "topicName": "Test",
            })
            assert resp.status_code == 200
            assert resp.json()["newDirections"] == []

    def test_directions_with_model_param(self):
        mock_result = {"newDirections": [{"title": "T", "question": "Q"}]}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _client().post("/api/sidebar/directions", json={
                "topicName": "Test",
                "model": "gemini-2.5-flash",
            })
            assert resp.status_code == 200
            call_kwargs = m.chat.call_args
            assert call_kwargs.kwargs.get("model") == "gemini-2.5-flash"

    def test_directions_string_status(self):
        mock_result = {"newDirections": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _client().post("/api/sidebar/directions", json={
                "topicName": "Test",
                "topicStatus": "I'm a beginner in this area",
            })
            assert resp.status_code == 200

    def test_directions_empty_status(self):
        mock_result = {"newDirections": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _client().post("/api/sidebar/directions", json={
                "topicName": "Test",
                "topicStatus": "",
            })
            assert resp.status_code == 200

    def test_directions_current_summary_truncated(self):
        """currentSummary should be truncated to 500 chars in the prompt."""
        mock_result = {"newDirections": []}
        long_summary = "x" * 2000
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _client().post("/api/sidebar/directions", json={
                "topicName": "Test",
                "currentSummary": long_summary,
            })
            assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/baseline/extract — Baseline Personal Details
# ═══════════════════════════════════════════════════════════════════════════════

class TestBaselineExtract:
    def test_basic_extraction(self):
        mock_result = {"details": ["CS student at MIT", "Interested in ML", "Knows Python"]}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _client().post("/api/baseline/extract", json={
                "messages": [
                    {"role": "user", "content": "I'm a CS student at MIT interested in ML"},
                    {"role": "assistant", "content": "That's great! What would you like to learn?"},
                ],
                "existingDetails": [],
            })
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["details"]) == 3
            assert "CS student at MIT" in data["details"]

    def test_extraction_with_existing_details(self):
        mock_result = {"details": ["CS student at MIT", "Knows Python", "Interested in NLP"]}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _client().post("/api/baseline/extract", json={
                "messages": [
                    {"role": "user", "content": "I want to learn NLP"},
                    {"role": "assistant", "content": "Great topic!"},
                ],
                "existingDetails": ["CS student at MIT", "Knows Python"],
            })
            assert resp.status_code == 200
            assert "Interested in NLP" in resp.json()["details"]

    def test_extraction_empty_messages(self):
        mock_result = {"details": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _client().post("/api/baseline/extract", json={
                "messages": [],
                "existingDetails": [],
            })
            assert resp.status_code == 200
            assert resp.json()["details"] == []

    def test_extraction_non_dict_result(self):
        """If LLM returns non-dict, should return empty details."""
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value="garbage")
            resp = _client().post("/api/baseline/extract", json={
                "messages": [{"role": "user", "content": "hi"}],
            })
            assert resp.status_code == 200
            assert resp.json()["details"] == []

    def test_extraction_truncates_to_6_messages(self):
        """Only last 6 messages should be sent to the LLM."""
        mock_result = {"details": ["detail"]}
        messages = [{"role": "user", "content": f"msg {i}"} for i in range(20)]
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _client().post("/api/baseline/extract", json={
                "messages": messages,
            })
            assert resp.status_code == 200

    def test_extraction_with_model(self):
        mock_result = {"details": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _client().post("/api/baseline/extract", json={
                "messages": [{"role": "user", "content": "test"}],
                "model": "gpt-5-mini-2025-08-07",
            })
            assert resp.status_code == 200
            call_kwargs = m.chat.call_args
            assert call_kwargs.kwargs.get("model") == "gpt-5-mini-2025-08-07"


# ═══════════════════════════════════════════════════════════════════════════════
# GET /api/admin/events — Event Export
# ═══════════════════════════════════════════════════════════════════════════════

class TestAdminEvents:
    def test_empty_events(self):
        resp = _client().get("/api/admin/events")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_all_events(self, isolate_db):
        client = _client()
        client.post("/api/log", json={"userId": "P01-loom", "eventType": "session_start", "condition": "loom"})
        client.post("/api/log", json={"userId": "P02-baseline", "eventType": "query_sent", "condition": "baseline"})

        resp = client.get("/api/admin/events")
        assert resp.status_code == 200
        events = resp.json()
        assert len(events) == 2
        assert events[0]["eventType"] == "session_start"
        assert events[1]["eventType"] == "query_sent"

    def test_filter_by_userId(self, isolate_db):
        client = _client()
        client.post("/api/log", json={"userId": "P01-loom", "eventType": "e1"})
        client.post("/api/log", json={"userId": "P02-loom", "eventType": "e2"})
        client.post("/api/log", json={"userId": "P01-loom", "eventType": "e3"})

        resp = client.get("/api/admin/events", params={"userId": "P01-loom"})
        events = resp.json()
        assert len(events) == 2
        assert all(e["userId"] == "P01-loom" for e in events)

    def test_filter_nonexistent_user(self, isolate_db):
        client = _client()
        client.post("/api/log", json={"userId": "P01", "eventType": "test"})
        resp = client.get("/api/admin/events", params={"userId": "NOPE"})
        assert resp.json() == []

    def test_event_data_preserved(self, isolate_db):
        client = _client()
        client.post("/api/log", json={
            "userId": "P01",
            "eventType": "summary_edited",
            "data": {"section": "overview", "idx": 2, "oldValue": "old", "newValue": "new"},
        })
        events = client.get("/api/admin/events").json()
        assert events[0]["data"]["section"] == "overview"
        assert events[0]["data"]["idx"] == 2

    def test_events_ordered_by_insertion(self, isolate_db):
        client = _client()
        for i in range(10):
            client.post("/api/log", json={"userId": "P01", "eventType": f"evt_{i}"})
        events = client.get("/api/admin/events").json()
        assert [e["eventType"] for e in events] == [f"evt_{i}" for i in range(10)]


# ═══════════════════════════════════════════════════════════════════════════════
# GET /api/admin/users — User Listing
# ═══════════════════════════════════════════════════════════════════════════════

class TestAdminUsers:
    def test_empty_users(self):
        resp = _client().get("/api/admin/users")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_distinct_users(self, isolate_db):
        client = _client()
        client.post("/api/log", json={"userId": "P01-loom", "condition": "loom", "eventType": "e1"})
        client.post("/api/log", json={"userId": "P01-loom", "condition": "loom", "eventType": "e2"})
        client.post("/api/log", json={"userId": "P02-baseline", "condition": "baseline", "eventType": "e3"})

        users = client.get("/api/admin/users").json()
        user_ids = [u["userId"] for u in users]
        assert "P01-loom" in user_ids
        assert "P02-baseline" in user_ids
        assert len(users) == 2

    def test_user_condition_preserved(self, isolate_db):
        client = _client()
        client.post("/api/log", json={"userId": "P01-loom", "condition": "loom", "eventType": "e1"})
        client.post("/api/log", json={"userId": "P01-baseline", "condition": "baseline", "eventType": "e2"})
        users = client.get("/api/admin/users").json()
        user_map = {u["userId"]: u["condition"] for u in users}
        assert user_map["P01-loom"] == "loom"
        assert user_map["P01-baseline"] == "baseline"


# ═══════════════════════════════════════════════════════════════════════════════
# Pydantic Model Validation
# ═══════════════════════════════════════════════════════════════════════════════

class TestPydanticModels:
    def test_log_event_defaults(self):
        from main import LogEvent
        evt = LogEvent(userId="P01", eventType="test")
        assert evt.condition == "loom"
        assert evt.data == {}
        assert evt.timestamp == ""

    def test_sync_request(self):
        from main import SyncRequest
        req = SyncRequest(userId="P01", data={"topics": []})
        assert req.userId == "P01"

    def test_directions_request_defaults(self):
        from main import DirectionsRequest
        req = DirectionsRequest(topicName="ML")
        assert req.topicStatus == ""
        assert req.allConcepts == []
        assert req.currentSummary == ""
        assert req.model is None

    def test_baseline_extract_defaults(self):
        from main import BaselineExtractRequest
        req = BaselineExtractRequest(
            messages=[{"role": "user", "content": "hi"}],
        )
        assert req.existingDetails == []
        assert req.model is None

    def test_directions_request_dict_status(self):
        from main import DirectionsRequest
        req = DirectionsRequest(
            topicName="ML",
            topicStatus={"overview": ["student"], "specifics": []},
        )
        assert isinstance(req.topicStatus, dict)


# ═══════════════════════════════════════════════════════════════════════════════
# Prompt Template Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestBaselinePrompt:
    def test_prompt_has_placeholders(self):
        from prompts import BASELINE_PERSONAL_DETAILS_PROMPT
        assert "{existing_details}" in BASELINE_PERSONAL_DETAILS_PROMPT
        assert "{messages}" in BASELINE_PERSONAL_DETAILS_PROMPT

    def test_prompt_format_works(self):
        from prompts import BASELINE_PERSONAL_DETAILS_PROMPT
        rendered = BASELINE_PERSONAL_DETAILS_PROMPT.format(
            existing_details="- CS student",
            messages="user: Hello\nassistant: Hi!",
        )
        assert "CS student" in rendered
        assert "user: Hello" in rendered
        # Verify template placeholders are replaced (no leftover {existing_details} or {messages})
        assert "{existing_details}" not in rendered
        assert "{messages}" not in rendered

    def test_prompt_mentions_json(self):
        from prompts import BASELINE_PERSONAL_DETAILS_PROMPT
        assert '"details"' in BASELINE_PERSONAL_DETAILS_PROMPT


# ═══════════════════════════════════════════════════════════════════════════════
# Integration: Full User Study Flow
# ═══════════════════════════════════════════════════════════════════════════════

class TestStudyFlowIntegration:
    """End-to-end flow simulating a participant's session."""

    def test_loom_participant_flow(self, isolate_db):
        """Simulate a Loom-condition participant: login -> chat -> log -> sync."""
        client = _client()
        user_id = "P01-loom"

        # 1. Session start
        resp = client.post("/api/log", json={
            "userId": user_id, "condition": "loom", "eventType": "session_start",
        })
        assert resp.status_code == 200

        # 2. Create chat (logged)
        resp = client.post("/api/log", json={
            "userId": user_id, "condition": "loom", "eventType": "chat_created",
            "data": {"chatId": "chat_001"},
        })
        assert resp.status_code == 200

        # 3. Send query (logged)
        resp = client.post("/api/log", json={
            "userId": user_id, "condition": "loom", "eventType": "query_sent",
            "data": {"chatId": "chat_001", "topicId": None, "hasContext": False},
        })
        assert resp.status_code == 200

        # 4. Topic detected (logged)
        resp = client.post("/api/log", json={
            "userId": user_id, "condition": "loom", "eventType": "topic_created",
            "data": {"topicId": "topic_001", "topicName": "ML", "isAutoDetected": True},
        })
        assert resp.status_code == 200

        # 5. Sync data
        blob = {
            "topics": [{"id": "topic_001", "name": "ML"}],
            "chats": [{"id": "chat_001", "topicId": "topic_001", "title": "Neural nets"}],
            "messages": {"chat_001": [{"role": "user", "content": "What are neural nets?"}]},
        }
        resp = client.post("/api/sync", json={"userId": user_id, "data": blob})
        assert resp.status_code == 200

        # 6. Verify all events logged
        events = client.get("/api/admin/events", params={"userId": user_id}).json()
        assert len(events) == 4
        assert events[0]["eventType"] == "session_start"
        assert events[3]["eventType"] == "topic_created"

        # 7. Verify sync data retrievable
        pulled = client.get("/api/sync", params={"userId": user_id}).json()["data"]
        assert pulled["topics"][0]["name"] == "ML"

    def test_baseline_participant_flow(self, isolate_db):
        """Simulate a baseline-condition participant."""
        client = _client()
        user_id = "P01-baseline"

        # 1. Session start
        client.post("/api/log", json={
            "userId": user_id, "condition": "baseline", "eventType": "session_start",
        })

        # 2. Query sent
        client.post("/api/log", json={
            "userId": user_id, "condition": "baseline", "eventType": "query_sent",
            "data": {"chatId": "chat_b1"},
        })

        # 3. Baseline details extracted (logged)
        client.post("/api/log", json={
            "userId": user_id, "condition": "baseline", "eventType": "baseline_details_shown",
            "data": {"count": 3},
        })

        # 4. Session end
        client.post("/api/log", json={
            "userId": user_id, "condition": "baseline", "eventType": "session_end",
        })

        # Verify
        events = client.get("/api/admin/events", params={"userId": user_id}).json()
        assert len(events) == 4
        assert all(e["condition"] == "baseline" for e in events)

    def test_same_participant_two_conditions_isolated(self, isolate_db):
        """P01-loom and P01-baseline should have fully separate data."""
        client = _client()

        client.post("/api/sync", json={"userId": "P01-loom", "data": {"topics": [{"id": "t1"}]}})
        client.post("/api/sync", json={"userId": "P01-baseline", "data": {"topics": []}})
        client.post("/api/log", json={"userId": "P01-loom", "eventType": "e1"})
        client.post("/api/log", json={"userId": "P01-baseline", "eventType": "e2"})

        loom_data = client.get("/api/sync", params={"userId": "P01-loom"}).json()["data"]
        baseline_data = client.get("/api/sync", params={"userId": "P01-baseline"}).json()["data"]
        loom_events = client.get("/api/admin/events", params={"userId": "P01-loom"}).json()
        baseline_events = client.get("/api/admin/events", params={"userId": "P01-baseline"}).json()

        assert len(loom_data["topics"]) == 1
        assert len(baseline_data["topics"]) == 0
        assert len(loom_events) == 1
        assert len(baseline_events) == 1

    def test_shuffle_directions_flow(self, isolate_db):
        """Simulate: user clicks shuffle -> directions endpoint -> log event."""
        client = _client()
        user_id = "P03-loom"

        # Shuffle directions
        mock_result = {"newDirections": [
            {"title": "New Dir 1", "question": "What about X?"},
            {"title": "New Dir 2", "question": "How does Y work?"},
        ]}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = client.post("/api/sidebar/directions", json={
                "topicName": "ML",
                "topicStatus": "Beginner",
                "allConcepts": [],
                "currentSummary": "user: What is ML?",
            })
            assert resp.status_code == 200
            assert len(resp.json()["newDirections"]) == 2

        # Log the shuffle event
        resp = client.post("/api/log", json={
            "userId": user_id,
            "condition": "loom",
            "eventType": "module3_shuffled",
            "data": {
                "topicId": "t1",
                "location": "sidebar",
                "oldDirections": ["Old Dir"],
                "newDirections": ["New Dir 1", "New Dir 2"],
            },
        })
        assert resp.status_code == 200

        events = client.get("/api/admin/events", params={"userId": user_id}).json()
        assert events[0]["eventType"] == "module3_shuffled"
        assert events[0]["data"]["location"] == "sidebar"

    def test_unassign_chat_flow(self, isolate_db):
        """Simulate: user unassigns a chat from a topic -> log event."""
        client = _client()
        user_id = "P04-loom"

        client.post("/api/log", json={
            "userId": user_id,
            "condition": "loom",
            "eventType": "chat_unassigned",
            "data": {"chatId": "chat_001", "topicId": "topic_001"},
        })

        events = client.get("/api/admin/events", params={"userId": user_id}).json()
        assert len(events) == 1
        assert events[0]["eventType"] == "chat_unassigned"
        assert events[0]["data"]["chatId"] == "chat_001"

    def test_summary_edit_flow(self, isolate_db):
        """Simulate: user edits + deletes status summary items -> log events."""
        client = _client()
        user_id = "P05-loom"

        client.post("/api/log", json={
            "userId": user_id, "eventType": "summary_edited",
            "data": {"topicId": "t1", "section": "overview", "editType": "edit",
                     "oldValue": "CS student", "newValue": "CS grad student"},
        })
        client.post("/api/log", json={
            "userId": user_id, "eventType": "summary_edited",
            "data": {"topicId": "t1", "section": "specifics", "editType": "delete",
                     "oldValue": "brief: touched on backprop"},
        })

        events = client.get("/api/admin/events", params={"userId": user_id}).json()
        assert len(events) == 2
        assert events[0]["data"]["editType"] == "edit"
        assert events[1]["data"]["editType"] == "delete"


# ═══════════════════════════════════════════════════════════════════════════════
# Concurrent / Stress Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestConcurrency:
    def test_many_users_logging(self, isolate_db):
        """12 users each logging 10 events should all persist."""
        client = _client()
        total = 0
        for u in range(12):
            for e in range(10):
                client.post("/api/log", json={
                    "userId": f"P{u:02d}-loom",
                    "eventType": f"event_{e}",
                })
                total += 1

        conn = sqlite3.connect(str(isolate_db))
        count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        conn.close()
        assert count == total

    def test_many_users_syncing(self, isolate_db):
        """12 users syncing data simultaneously should all persist."""
        client = _client()
        for u in range(12):
            uid = f"P{u:02d}-loom"
            blob = {"topics": [{"id": f"t_{u}"}], "userId": uid}
            client.post("/api/sync", json={"userId": uid, "data": blob})

        conn = sqlite3.connect(str(isolate_db))
        count = conn.execute("SELECT COUNT(*) FROM user_data").fetchone()[0]
        conn.close()
        assert count == 12

        for u in range(12):
            uid = f"P{u:02d}-loom"
            pulled = client.get("/api/sync", params={"userId": uid}).json()["data"]
            assert pulled["topics"][0]["id"] == f"t_{u}"


# ═══════════════════════════════════════════════════════════════════════════════
# Edge Cases
# ═══════════════════════════════════════════════════════════════════════════════

class TestEdgeCases:
    def test_log_unicode_data(self, isolate_db):
        resp = _client().post("/api/log", json={
            "userId": "P-unicode",
            "eventType": "query_sent",
            "data": {"content": "学习机器学习 🤖"},
        })
        assert resp.status_code == 200
        conn = sqlite3.connect(str(isolate_db))
        row = conn.execute("SELECT event_data FROM events").fetchone()
        conn.close()
        assert "学习机器学习" in json.loads(row[0])["content"]

    def test_sync_large_blob(self, isolate_db):
        """Ensure large data blobs work (lots of messages)."""
        messages = {f"chat_{i}": [
            {"role": "user", "content": f"Question {j}" * 50}
            for j in range(20)
        ] for i in range(10)}
        blob = {"topics": [], "chats": [], "messages": messages}
        resp = _client().post("/api/sync", json={"userId": "P-large", "data": blob})
        assert resp.status_code == 200
        pulled = _client().get("/api/sync", params={"userId": "P-large"}).json()["data"]
        assert len(pulled["messages"]) == 10

    def test_log_special_chars_in_userId(self, isolate_db):
        resp = _client().post("/api/log", json={
            "userId": "P01-loom_test",
            "eventType": "session_start",
        })
        assert resp.status_code == 200
        events = _client().get("/api/admin/events", params={"userId": "P01-loom_test"}).json()
        assert len(events) == 1

    def test_sync_empty_blob(self, isolate_db):
        resp = _client().post("/api/sync", json={"userId": "P-empty", "data": {}})
        assert resp.status_code == 200
        pulled = _client().get("/api/sync", params={"userId": "P-empty"}).json()["data"]
        assert pulled == {}

    def test_directions_with_empty_specifics_level(self):
        """Specifics items with missing 'level' field should not crash."""
        mock_result = {"newDirections": []}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _client().post("/api/sidebar/directions", json={
                "topicName": "Test",
                "topicStatus": {
                    "overview": [],
                    "specifics": [
                        {"text": "some item"},
                        "plain string specific",
                    ],
                },
            })
            assert resp.status_code == 200

    def test_baseline_extract_with_empty_existing(self):
        mock_result = {"details": ["new detail"]}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _client().post("/api/baseline/extract", json={
                "messages": [{"role": "user", "content": "I like hiking"}],
                "existingDetails": [],
            })
            assert resp.status_code == 200
            assert resp.json()["details"] == ["new detail"]

    def test_admin_events_large_dataset(self, isolate_db):
        """100 events should all be returned."""
        client = _client()
        for i in range(100):
            client.post("/api/log", json={
                "userId": "P-bulk",
                "eventType": f"event_{i}",
            })
        events = client.get("/api/admin/events", params={"userId": "P-bulk"}).json()
        assert len(events) == 100


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/auth/login — Password Authentication
# ═══════════════════════════════════════════════════════════════════════════════

class TestAuthLogin:
    def test_first_login_creates_account(self, isolate_db):
        resp = _client().post("/api/auth/login", json={
            "userId": "loom01", "password": "secret123",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["isNew"] is True
        assert data["condition"] == "loom"

    def test_first_login_baseline_condition(self, isolate_db):
        resp = _client().post("/api/auth/login", json={
            "userId": "baseline01", "password": "pw",
        })
        data = resp.json()
        assert data["condition"] == "baseline"
        assert data["isNew"] is True

    def test_second_login_correct_password(self, isolate_db):
        client = _client()
        client.post("/api/auth/login", json={"userId": "loom01", "password": "mypass"})
        resp = client.post("/api/auth/login", json={"userId": "loom01", "password": "mypass"})
        data = resp.json()
        assert data["ok"] is True
        assert data["isNew"] is False

    def test_second_login_wrong_password(self, isolate_db):
        client = _client()
        client.post("/api/auth/login", json={"userId": "loom02", "password": "correct"})
        resp = client.post("/api/auth/login", json={"userId": "loom02", "password": "wrong"})
        assert resp.status_code == 401

    def test_wrong_password_error_detail(self, isolate_db):
        client = _client()
        client.post("/api/auth/login", json={"userId": "loom03", "password": "abc"})
        resp = client.post("/api/auth/login", json={"userId": "loom03", "password": "xyz"})
        assert resp.status_code == 401
        assert "Incorrect password" in resp.json()["detail"]

    def test_empty_userId_rejected(self):
        resp = _client().post("/api/auth/login", json={
            "userId": "", "password": "pw",
        })
        assert resp.status_code == 400

    def test_empty_password_rejected(self):
        resp = _client().post("/api/auth/login", json={
            "userId": "loom01", "password": "",
        })
        assert resp.status_code == 400

    def test_whitespace_only_rejected(self):
        resp = _client().post("/api/auth/login", json={
            "userId": "   ", "password": "  ",
        })
        assert resp.status_code == 400

    def test_missing_fields(self):
        resp = _client().post("/api/auth/login", json={"userId": "loom01"})
        assert resp.status_code == 422

    # ── Condition detection (prefix-based) ──────────────────────────────

    def test_condition_loom_prefix(self, isolate_db):
        resp = _client().post("/api/auth/login", json={"userId": "loom05", "password": "pw"})
        assert resp.json()["condition"] == "loom"

    def test_condition_loom_mixed_case(self, isolate_db):
        resp = _client().post("/api/auth/login", json={"userId": "Loom05", "password": "pw"})
        assert resp.json()["condition"] == "loom"

    def test_condition_baseline_prefix(self, isolate_db):
        resp = _client().post("/api/auth/login", json={"userId": "baseline05", "password": "pw"})
        assert resp.json()["condition"] == "baseline"

    def test_condition_baseline_mixed_case(self, isolate_db):
        resp = _client().post("/api/auth/login", json={"userId": "Baseline05", "password": "pw"})
        assert resp.json()["condition"] == "baseline"

    def test_condition_unknown_prefix_defaults_loom(self, isolate_db):
        resp = _client().post("/api/auth/login", json={"userId": "P01", "password": "pw"})
        assert resp.json()["condition"] == "loom"

    # ── User isolation ──────────────────────────────────────────────────

    def test_different_users_different_passwords(self, isolate_db):
        client = _client()
        client.post("/api/auth/login", json={"userId": "loom01", "password": "pass_a"})
        client.post("/api/auth/login", json={"userId": "loom02", "password": "pass_b"})

        resp_a = client.post("/api/auth/login", json={"userId": "loom01", "password": "pass_a"})
        resp_b = client.post("/api/auth/login", json={"userId": "loom02", "password": "pass_b"})
        assert resp_a.status_code == 200
        assert resp_b.status_code == 200

        resp_cross = client.post("/api/auth/login", json={"userId": "loom01", "password": "pass_b"})
        assert resp_cross.status_code == 401

    def test_same_person_loom_and_baseline_separate(self, isolate_db):
        client = _client()
        r1 = client.post("/api/auth/login", json={"userId": "loom01", "password": "pw1"})
        r2 = client.post("/api/auth/login", json={"userId": "baseline01", "password": "pw2"})
        assert r1.json()["condition"] == "loom"
        assert r2.json()["condition"] == "baseline"

        # Each has its own password
        assert client.post("/api/auth/login", json={"userId": "loom01", "password": "pw2"}).status_code == 401
        assert client.post("/api/auth/login", json={"userId": "baseline01", "password": "pw1"}).status_code == 401

    # ── Persistence check ───────────────────────────────────────────────

    def test_user_stored_in_db(self, isolate_db):
        _client().post("/api/auth/login", json={"userId": "loom07", "password": "p"})
        conn = sqlite3.connect(str(isolate_db))
        row = conn.execute("SELECT user_id, condition FROM users WHERE user_id = 'loom07'").fetchone()
        conn.close()
        assert row is not None
        assert row[0] == "loom07"
        assert row[1] == "loom"

    def test_password_stored_as_hash_not_plaintext(self, isolate_db):
        _client().post("/api/auth/login", json={"userId": "loom08", "password": "mysecret"})
        conn = sqlite3.connect(str(isolate_db))
        row = conn.execute("SELECT password_hash FROM users WHERE user_id = 'loom08'").fetchone()
        conn.close()
        assert row[0] != "mysecret"
        assert len(row[0]) == 64  # SHA-256 hex digest

    def test_twelve_users_all_register(self, isolate_db):
        client = _client()
        for i in range(1, 13):
            resp = client.post("/api/auth/login", json={
                "userId": f"loom{i:02d}", "password": f"pw_{i}",
            })
            assert resp.status_code == 200
            assert resp.json()["isNew"] is True

        conn = sqlite3.connect(str(isolate_db))
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        conn.close()
        assert count == 12


# ═══════════════════════════════════════════════════════════════════════════════
# Helper Function Unit Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestHelperFunctions:
    def test_parse_condition_loom(self):
        from main import _parse_condition
        assert _parse_condition("loom01") == "loom"
        assert _parse_condition("Loom05") == "loom"
        assert _parse_condition("LOOM99") == "loom"

    def test_parse_condition_baseline(self):
        from main import _parse_condition
        assert _parse_condition("baseline01") == "baseline"
        assert _parse_condition("Baseline05") == "baseline"
        assert _parse_condition("BASELINE99") == "baseline"

    def test_parse_condition_unknown_defaults_loom(self):
        from main import _parse_condition
        assert _parse_condition("P01") == "loom"
        assert _parse_condition("test") == "loom"
        assert _parse_condition("user123") == "loom"

    def test_hash_password_deterministic(self):
        from main import _hash_password
        h1 = _hash_password("hello")
        h2 = _hash_password("hello")
        assert h1 == h2

    def test_hash_password_different_inputs(self):
        from main import _hash_password
        assert _hash_password("abc") != _hash_password("def")

    def test_hash_password_length(self):
        from main import _hash_password
        assert len(_hash_password("test")) == 64


# ═══════════════════════════════════════════════════════════════════════════════
# Backup Mechanism Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestBackupMechanism:
    def test_backup_creates_json_file(self, isolate_db, tmp_path):
        client = _client()
        client.post("/api/log", json={
            "userId": "u1", "condition": "loom",
            "eventType": "test_event", "data": {"key": "val"},
        })
        from main import _backup_events_to_json
        _backup_events_to_json()
        backup_dir = tmp_path / "backups"
        assert backup_dir.exists()
        backups = list(backup_dir.glob("events_backup_*.json"))
        assert len(backups) >= 1

    def test_backup_contains_all_events(self, isolate_db, tmp_path):
        client = _client()
        for i in range(5):
            client.post("/api/log", json={
                "userId": "u1", "condition": "loom",
                "eventType": f"evt_{i}", "data": {},
            })
        from main import _backup_events_to_json
        _backup_events_to_json()
        backup_dir = tmp_path / "backups"
        backups = sorted(backup_dir.glob("events_backup_*.json"))
        data = json.loads(backups[-1].read_text())
        assert len(data) == 5

    def test_backup_keeps_only_last_10(self, isolate_db, tmp_path):
        from main import _backup_events_to_json
        client = _client()
        client.post("/api/log", json={
            "userId": "u1", "condition": "loom", "eventType": "e", "data": {},
        })
        import time as _time
        for i in range(15):
            _backup_events_to_json()
            _time.sleep(0.01)
        backup_dir = tmp_path / "backups"
        backups = list(backup_dir.glob("events_backup_*.json"))
        assert len(backups) <= 10

    def test_auto_backup_every_50_events(self, isolate_db, tmp_path):
        client = _client()
        for i in range(50):
            client.post("/api/log", json={
                "userId": "u1", "condition": "loom",
                "eventType": "bulk_event", "data": {"idx": i},
            })
        backup_dir = tmp_path / "backups"
        if backup_dir.exists():
            backups = list(backup_dir.glob("events_backup_*.json"))
            assert len(backups) >= 1


# ═══════════════════════════════════════════════════════════════════════════════
# Admin Endpoint Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestAdminBackupEndpoint:
    def test_manual_backup_endpoint(self, isolate_db, tmp_path):
        client = _client()
        client.post("/api/log", json={
            "userId": "u1", "condition": "loom", "eventType": "e", "data": {},
        })
        resp = client.get("/api/admin/backup")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        backup_dir = tmp_path / "backups"
        assert backup_dir.exists()


class TestAdminEventsSummary:
    def test_summary_returns_counts(self, isolate_db):
        client = _client()
        for _ in range(3):
            client.post("/api/log", json={
                "userId": "u1", "condition": "loom",
                "eventType": "query_sent", "data": {},
            })
        for _ in range(2):
            client.post("/api/log", json={
                "userId": "u1", "condition": "loom",
                "eventType": "chat_created", "data": {},
            })
        resp = client.get("/api/admin/events/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 5
        summary = data["summary"]
        assert any(s["eventType"] == "query_sent" and s["count"] == 3 for s in summary)
        assert any(s["eventType"] == "chat_created" and s["count"] == 2 for s in summary)

    def test_summary_groups_by_user(self, isolate_db):
        client = _client()
        client.post("/api/log", json={
            "userId": "u1", "condition": "loom", "eventType": "e", "data": {},
        })
        client.post("/api/log", json={
            "userId": "u2", "condition": "baseline", "eventType": "e", "data": {},
        })
        resp = client.get("/api/admin/events/summary")
        data = resp.json()
        assert data["total"] == 2
        user_ids = {s["userId"] for s in data["summary"]}
        assert "u1" in user_ids
        assert "u2" in user_ids

    def test_empty_summary(self, isolate_db):
        resp = _client().get("/api/admin/events/summary")
        data = resp.json()
        assert data["total"] == 0
        assert data["summary"] == []


class TestAdminExport:
    def test_export_returns_all_events(self, isolate_db):
        client = _client()
        for i in range(3):
            client.post("/api/log", json={
                "userId": "u1", "condition": "loom",
                "eventType": f"evt_{i}", "data": {"i": i},
            })
        resp = client.get("/api/admin/export")
        assert resp.status_code == 200
        events = resp.json()
        assert len(events) == 3
        assert events[0]["eventType"] == "evt_0"
        assert events[2]["eventType"] == "evt_2"

    def test_export_has_content_disposition_header(self, isolate_db):
        _client().post("/api/log", json={
            "userId": "u1", "condition": "loom", "eventType": "e", "data": {},
        })
        resp = _client().get("/api/admin/export")
        assert "content-disposition" in resp.headers
        assert "loom_events_" in resp.headers["content-disposition"]

    def test_export_empty_returns_empty_list(self, isolate_db):
        resp = _client().get("/api/admin/export")
        assert resp.json() == []


# ═══════════════════════════════════════════════════════════════════════════════
# New Event Types — Logging Validation
# ═══════════════════════════════════════════════════════════════════════════════

class TestNewEventTypes:
    """Verify all new event types can be stored and retrieved correctly."""

    NEW_EVENTS = [
        ("chat_selected", {"chatId": "c1", "topicId": "t1", "view": "recent"}),
        ("chat_selected", {"chatId": "c2", "topicId": "t2", "view": "topics"}),
        ("view_switched", {"view": "topics"}),
        ("topic_auto_detect_triggered", {"candidateCount": 5}),
        ("topic_assigned", {"chatId": "c1", "topicId": "t1", "assignMethod": "manual"}),
        ("topic_assigned", {"chatId": "c2", "topicId": "t2", "assignMethod": "auto"}),
        ("topic_picker_opened", {}),
        ("topic_picker_selected", {"topicId": "t1", "topicName": "ML"}),
        ("topic_picker_keyboard_select", {"key": "Enter", "index": 0}),
        ("topic_merge_drag", {"sourceTopicId": "t1", "targetTopicId": "t2"}),
        ("topic_merge_dialog_opened", {"topicId": "t1", "topicName": "ML"}),
        ("topic_merge_confirmed", {"sourceTopicId": "t1", "targetTopicId": "t2"}),
        ("topic_merge_cancelled", {"sourceTopicId": "t1"}),
        ("overview_section_toggled", {"section": "overview", "collapsed": True}),
        ("thread_toggled", {"topicId": "t1", "threadIdx": 0, "expanded": True}),
        ("module_collapsed", {"moduleId": "moduleStatus", "collapsed": True}),
        ("module_collapsed", {"moduleId": "moduleConnections", "collapsed": False}),
        ("module_collapsed", {"moduleId": "moduleDirections", "collapsed": True}),
        ("connection_marker_hovered", {"connId": "1", "chatId": "c1"}),
        ("connection_marker_clicked", {"connId": "1", "chatId": "c1"}),
        ("connection_sidebar_card_clicked", {"connId": "1", "chatId": "c1", "connectionChatId": "c2"}),
        ("connection_card_closed", {"chatId": "c1"}),
        ("welcome_suggestion_clicked", {"topicId": "t1", "topicName": "ML", "question": "What is X?"}),
        ("context_block_closed", {"chatId": "c1"}),
        ("context_block_toggled", {"expanded": True}),
        ("context_block_toggled", {"expanded": False}),
        ("sidebar_collapsed", {"side": "left", "collapsed": True}),
        ("sidebar_collapsed", {"side": "right", "collapsed": False}),
        ("context_tag_clicked", {"type": "status", "label": "Status: ML"}),
    ]

    def test_all_new_events_can_be_stored(self, isolate_db):
        client = _client()
        for evt_type, data in self.NEW_EVENTS:
            resp = client.post("/api/log", json={
                "userId": "test_user", "condition": "loom",
                "eventType": evt_type, "data": data,
            })
            assert resp.status_code == 200, f"Failed to log {evt_type}"

    def test_all_new_events_can_be_retrieved(self, isolate_db):
        client = _client()
        for evt_type, data in self.NEW_EVENTS:
            client.post("/api/log", json={
                "userId": "test_user", "condition": "loom",
                "eventType": evt_type, "data": data,
            })
        resp = client.get("/api/admin/events", params={"userId": "test_user"})
        events = resp.json()
        assert len(events) == len(self.NEW_EVENTS)

    def test_event_data_roundtrip(self, isolate_db):
        client = _client()
        test_data = {"topicId": "t1", "assignMethod": "manual", "nested": {"key": "val"}}
        client.post("/api/log", json={
            "userId": "u1", "condition": "loom",
            "eventType": "topic_assigned", "data": test_data,
        })
        events = client.get("/api/admin/events", params={"userId": "u1"}).json()
        assert events[0]["data"] == test_data

    def test_summary_counts_new_event_types(self, isolate_db):
        client = _client()
        for _ in range(3):
            client.post("/api/log", json={
                "userId": "u1", "condition": "loom",
                "eventType": "module_collapsed", "data": {"moduleId": "moduleStatus"},
            })
        resp = client.get("/api/admin/events/summary")
        summary = resp.json()["summary"]
        mc = next((s for s in summary if s["eventType"] == "module_collapsed"), None)
        assert mc is not None
        assert mc["count"] == 3
