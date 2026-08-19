"""Tests for best-effort pre-reply topic classification."""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from main import _parse_classification, app


TOPICS = [
    {"id": "topic_ml", "name": "Machine Learning"},
    {"id": "topic_fit", "name": "Health & Fitness"},
]


def test_parse_exact_id():
    assert _parse_classification("topic_ml", TOPICS)["parsePath"] == "exact_id"


def test_parse_case_insensitive_id():
    result = _parse_classification("TOPIC_ML", TOPICS)
    assert result["topicId"] == "topic_ml"
    assert result["parsePath"] == "ci_id"


def test_parse_new_name():
    result = _parse_classification("NEW: Compiler Design", TOPICS)
    assert result["newTopicName"] == "Compiler Design"
    assert result["parsePath"] == "new"


def test_parse_new_existing_name():
    result = _parse_classification("NEW: machine learning", TOPICS)
    assert result["topicId"] == "topic_ml"
    assert result["parsePath"] == "fuzzy_name"


@pytest.mark.parametrize("raw", ["ONEOFF", "one-off", "ONEOFF quick request"])
def test_parse_oneoff(raw):
    result = _parse_classification(raw, TOPICS)
    assert result["isOneOff"] is True
    assert result["parsePath"] == "oneoff"


def test_parse_normalized_name():
    result = _parse_classification("health fitness", TOPICS)
    assert result["topicId"] == "topic_fit"
    assert result["parsePath"] == "fuzzy_name"


def test_parse_unambiguous_substring():
    result = _parse_classification("Machine", TOPICS)
    assert result["topicId"] == "topic_ml"
    assert result["parsePath"] == "substring"


@pytest.mark.parametrize("raw", ["nonsense output", "", None])
def test_parse_fallback(raw):
    assert _parse_classification(raw, TOPICS) == {
        "topicId": None,
        "newTopicName": None,
        "isOneOff": False,
        "parsePath": "fallback_none",
    }


@pytest.mark.parametrize("raw", ['"topic_ml"\nExplanation', '`topic_ml`.', "'topic_ml'."])
def test_parse_uses_first_line_and_strips_wrappers(raw):
    result = _parse_classification(raw, TOPICS)
    assert result["topicId"] == "topic_ml"
    assert result["parsePath"] == "exact_id"


def test_classify_endpoint_returns_parsed_shape():
    with patch("main.llm") as mocked:
        mocked.chat = AsyncMock(return_value="topic_fit")
        response = TestClient(app).post("/api/topic/classify", json={
            "message": "How should I train for a 5K?",
            "existingTopics": TOPICS,
        })
    assert response.status_code == 200
    assert response.json() == {
        "topicId": "topic_fit",
        "newTopicName": None,
        "isOneOff": False,
        "parsePath": "exact_id",
    }
    assert mocked.chat.await_args.kwargs["json_mode"] is False


def test_classify_endpoint_accepts_router_plain_text_wrapper():
    with patch("main.llm") as mocked:
        mocked.chat = AsyncMock(return_value={"response": "topic_ml"})
        response = TestClient(app).post("/api/topic/classify", json={
            "message": "Explain gradient descent",
            "existingTopics": TOPICS,
        })
    assert response.status_code == 200
    assert response.json()["topicId"] == "topic_ml"


def test_classify_endpoint_failure_is_http_200_fallback():
    with patch("main.llm") as mocked:
        mocked.chat = AsyncMock(side_effect=RuntimeError("provider down"))
        response = TestClient(app).post("/api/topic/classify", json={
            "message": "hello",
            "existingTopics": TOPICS,
        })
    assert response.status_code == 200
    assert response.json()["parsePath"] == "fallback_none"
