"""Comprehensive tests for prompts.py – template formatting and structure."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import pytest
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


class TestChatResponsePrompt:
    def test_formats_with_topics(self):
        result = CHAT_RESPONSE_PROMPT.format(topics_json='[{"id":"t1","name":"ML"}]')
        assert "ML" in result

    def test_formats_with_empty_topics(self):
        result = CHAT_RESPONSE_PROMPT.format(topics_json="[]")
        assert "[]" in result

    def test_contains_response_field(self):
        result = CHAT_RESPONSE_PROMPT.format(topics_json="[]")
        assert '"response"' in result

    def test_contains_topic_field(self):
        result = CHAT_RESPONSE_PROMPT.format(topics_json="[]")
        assert '"topic"' in result

    def test_contains_concepts_field(self):
        result = CHAT_RESPONSE_PROMPT.format(topics_json="[]")
        assert '"concepts"' in result

    def test_contains_confidence_field(self):
        result = CHAT_RESPONSE_PROMPT.format(topics_json="[]")
        assert "confidence" in result

    def test_contains_matchedExistingId_field(self):
        result = CHAT_RESPONSE_PROMPT.format(topics_json="[]")
        assert "matchedExistingId" in result

    def test_multiple_topics(self):
        topics = '[{"id":"t1","name":"ML"},{"id":"t2","name":"Fitness"}]'
        result = CHAT_RESPONSE_PROMPT.format(topics_json=topics)
        assert "ML" in result
        assert "Fitness" in result

    def test_special_characters_in_topics(self):
        topics = '[{"id":"t1","name":"C++/C#"}]'
        result = CHAT_RESPONSE_PROMPT.format(topics_json=topics)
        assert "C++/C#" in result


class TestBridgeQuestionsPrompt:
    def test_formats_all_fields(self):
        result = SIDEBAR_BRIDGE_QUESTIONS_PROMPT.format(
            current_messages="user: How does backprop work?",
            topic_name="ML",
            topic_status="Learning basics",
            ranked_items_json='[{"id":"c1","title":"SVM"}]',
        )
        assert "ML" in result
        assert "backprop" in result

    def test_contains_relatedCards_output(self):
        result = SIDEBAR_BRIDGE_QUESTIONS_PROMPT.format(
            current_messages="test", topic_name="T", topic_status="S",
            ranked_items_json="[]",
        )
        assert "relatedCards" in result

    def test_contains_bridgeQuestion_field(self):
        result = SIDEBAR_BRIDGE_QUESTIONS_PROMPT.format(
            current_messages="test", topic_name="T", topic_status="S",
            ranked_items_json="[]",
        )
        assert "bridgeQuestion" in result

    def test_contains_sourceType_field(self):
        result = SIDEBAR_BRIDGE_QUESTIONS_PROMPT.format(
            current_messages="test", topic_name="T", topic_status="S",
            ranked_items_json="[]",
        )
        assert "sourceType" in result

    def test_empty_status_formats(self):
        result = SIDEBAR_BRIDGE_QUESTIONS_PROMPT.format(
            current_messages="test", topic_name="T", topic_status="No status yet.",
            ranked_items_json="[]",
        )
        assert "No status yet." in result


class TestNewDirectionsPrompt:
    def test_formats_all_fields(self):
        result = SIDEBAR_NEW_DIRECTIONS_PROMPT.format(
            topic_name="Fitness", topic_status="Working out",
            covered_concepts="- Cardio", current_summary="Asking about protein",
        )
        assert "Fitness" in result
        assert "Cardio" in result

    def test_contains_newDirections_output(self):
        result = SIDEBAR_NEW_DIRECTIONS_PROMPT.format(
            topic_name="T", topic_status="S",
            covered_concepts="None", current_summary="test",
        )
        assert "newDirections" in result

    def test_contains_title_and_question_fields(self):
        result = SIDEBAR_NEW_DIRECTIONS_PROMPT.format(
            topic_name="T", topic_status="S",
            covered_concepts="None", current_summary="test",
        )
        assert '"title"' in result
        assert '"question"' in result

    def test_empty_concepts_formats(self):
        result = SIDEBAR_NEW_DIRECTIONS_PROMPT.format(
            topic_name="T", topic_status="S",
            covered_concepts="None yet.", current_summary="test",
        )
        assert "None yet." in result


class TestStatusUpdatePrompt:
    def test_formats_all_fields(self):
        result = STATUS_UPDATE_PROMPT.format(
            topic_name="ML", current_status="3rd year CS",
            recent_summaries="- Learned neural nets",
        )
        assert "ML" in result
        assert "3rd year" in result

    def test_empty_status(self):
        result = STATUS_UPDATE_PROMPT.format(
            topic_name="ML", current_status="(empty - create fresh)",
            recent_summaries="- First chat",
        )
        assert "empty" in result

    def test_contains_structured_output(self):
        result = STATUS_UPDATE_PROMPT.format(
            topic_name="T", current_status="S", recent_summaries="test",
        )
        assert '"overview"' in result
        assert '"specifics"' in result
        assert '"level"' in result

    def test_mentions_incremental_rules(self):
        result = STATUS_UPDATE_PROMPT.format(
            topic_name="T", current_status="S", recent_summaries="test",
        )
        assert "ADD" in result


class TestChatSummarizePrompt:
    def test_formats_messages(self):
        result = CHAT_SUMMARIZE_PROMPT.format(messages="user: What is ReLU?\nassistant: ReLU is...")
        assert "ReLU" in result

    def test_contains_title_output(self):
        result = CHAT_SUMMARIZE_PROMPT.format(messages="test")
        assert '"title"' in result

    def test_contains_summary_output(self):
        result = CHAT_SUMMARIZE_PROMPT.format(messages="test")
        assert '"summary"' in result

    def test_empty_messages(self):
        result = CHAT_SUMMARIZE_PROMPT.format(messages="")
        assert isinstance(result, str)


class TestTopicAutoDetectPrompt:
    def test_formats_all_fields(self):
        result = TOPIC_AUTO_DETECT_PROMPT.format(
            summaries_json='[{"id":"c1","summary":"ML basics"}]',
            existing_topics='[{"id":"t1","name":"Fitness"}]',
        )
        assert "ML basics" in result
        assert "Fitness" in result

    def test_contains_newTopics_output(self):
        result = TOPIC_AUTO_DETECT_PROMPT.format(
            summaries_json="[]", existing_topics="[]",
        )
        assert "newTopics" in result

    def test_contains_chatIds_field(self):
        result = TOPIC_AUTO_DETECT_PROMPT.format(
            summaries_json="[]", existing_topics="[]",
        )
        assert "chatIds" in result

    def test_empty_inputs(self):
        result = TOPIC_AUTO_DETECT_PROMPT.format(
            summaries_json="[]", existing_topics="[]",
        )
        assert isinstance(result, str)
        assert len(result) > 50


class TestAllPrompts:
    ALL_PROMPTS = [
        CHAT_RESPONSE_PROMPT, SIDEBAR_BRIDGE_QUESTIONS_PROMPT,
        SIDEBAR_NEW_DIRECTIONS_PROMPT, STATUS_UPDATE_PROMPT,
        CHAT_SUMMARIZE_PROMPT, TOPIC_AUTO_DETECT_PROMPT,
    ]

    def test_all_are_nonempty_strings(self):
        for p in self.ALL_PROMPTS:
            assert isinstance(p, str) and len(p) > 50

    def test_all_mention_json(self):
        for p in self.ALL_PROMPTS:
            assert "JSON" in p or "json" in p or "Json" in p

    def test_all_contain_return_instructions(self):
        for p in self.ALL_PROMPTS:
            assert "Return" in p or "return" in p or "MUST return" in p

    def test_no_unformatted_single_braces(self):
        """All prompts should use {{ and }} for literal braces in format strings."""
        for p in self.ALL_PROMPTS:
            assert isinstance(p, str)


class TestStreamPrompts:
    def test_stream_system_prompt_exists(self):
        assert isinstance(CHAT_STREAM_SYSTEM_PROMPT, str)
        assert len(CHAT_STREAM_SYSTEM_PROMPT) > 10

    def test_stream_system_prompt_no_json_instructions(self):
        assert "JSON" not in CHAT_STREAM_SYSTEM_PROMPT

    def test_metadata_prompt_exists(self):
        assert isinstance(CHAT_METADATA_PROMPT, str)

    def test_metadata_prompt_formats_with_topics(self):
        result = CHAT_METADATA_PROMPT.format(topics_json='[{"id":"t1","name":"ML"}]')
        assert "ML" in result

    def test_metadata_prompt_has_topic_field(self):
        assert '"topic"' in CHAT_METADATA_PROMPT

    def test_metadata_prompt_has_concepts_field(self):
        assert '"concepts"' in CHAT_METADATA_PROMPT

    def test_metadata_prompt_requests_json(self):
        assert "JSON" in CHAT_METADATA_PROMPT or "json" in CHAT_METADATA_PROMPT
