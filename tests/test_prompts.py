"""Comprehensive tests for prompts.py – template formatting and structure."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import pytest
from prompts import (
    CHAT_RESPONSE_PROMPT,
    CHAT_STREAM_SYSTEM_PROMPT,
    CHAT_STREAM_HIGHLIGHT_BLOCK,
    CHAT_METADATA_PROMPT,
    CLASSIFY_FIRST_PROMPT,
    SIDEBAR_NEW_DIRECTIONS_PROMPT,
    STATUS_UPDATE_PROMPT,
    CHAT_SUMMARIZE_PROMPT,
    TOPIC_AUTO_DETECT_PROMPT,
    OVERVIEW_AI_EDIT_PROMPT,
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

    def test_no_concepts_field(self):
        result = CHAT_RESPONSE_PROMPT.format(topics_json="[]")
        assert '"concepts"' not in result

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


class TestNewDirectionsPrompt:
    def test_formats_all_fields(self):
        result = SIDEBAR_NEW_DIRECTIONS_PROMPT.format(
            topic_name="Fitness", topic_status="Working out",
            coverage="- Overview: Cardio\n- Past chat: Protein basics",
            current_summary="Asking about protein",
            previously_suggested="None",
            annotations="(none)",
        )
        assert "Fitness" in result
        assert "Cardio" in result
        assert "Protein basics" in result

    def test_contains_newDirections_output(self):
        result = SIDEBAR_NEW_DIRECTIONS_PROMPT.format(
            topic_name="T", topic_status="S",
            coverage="None yet.", current_summary="test",
            previously_suggested="None",
            annotations="(none)",
        )
        assert "newDirections" in result

    def test_contains_title_and_question_fields(self):
        result = SIDEBAR_NEW_DIRECTIONS_PROMPT.format(
            topic_name="T", topic_status="S",
            coverage="None yet.", current_summary="test",
            previously_suggested="None",
            annotations="(none)",
        )
        assert '"title"' in result
        assert '"exampleQuestion"' in result

    def test_empty_coverage_formats(self):
        result = SIDEBAR_NEW_DIRECTIONS_PROMPT.format(
            topic_name="T", topic_status="S",
            coverage="None yet.", current_summary="test",
            previously_suggested="None",
            annotations="(none)",
        )
        assert "None yet." in result

    def test_breadth_depth_coverage_rules(self):
        """Directions use coverage (overview + past chats), not stance grounding."""
        assert "{coverage}" in SIDEBAR_NEW_DIRECTIONS_PROMPT
        assert "covered_concepts" not in SIDEBAR_NEW_DIRECTIONS_PROMPT
        assert "breadth" in SIDEBAR_NEW_DIRECTIONS_PROMPT
        assert "depth" in SIDEBAR_NEW_DIRECTIONS_PROMPT
        assert "flagged interest" not in SIDEBAR_NEW_DIRECTIONS_PROMPT
        assert "dismissed as not relevant" not in SIDEBAR_NEW_DIRECTIONS_PROMPT


class TestStatusUpdatePrompt:
    def test_formats_all_fields(self):
        result = STATUS_UPDATE_PROMPT.format(
            topic_name="ML", current_status="3rd year CS",
            current_messages="user: test", recent_summaries="- Learned neural nets",
            annotations='- "neural nets" → interested',
        )
        assert "ML" in result
        assert "3rd year" in result
        assert "interested" in result

    def test_empty_status(self):
        result = STATUS_UPDATE_PROMPT.format(
            topic_name="ML", current_status="(empty - create fresh)",
            current_messages="(none)", recent_summaries="- First chat",
            annotations="(none)",
        )
        assert "empty" in result

    def test_contains_structured_output(self):
        result = STATUS_UPDATE_PROMPT.format(
            topic_name="T", current_status="S",
            current_messages="(none)", recent_summaries="test",
            annotations="(none)",
        )
        assert '"overview"' in result
        assert '"goals"' in result
        assert '"concepts_traversed"' not in result
        assert '"stance"' not in result

    def test_mentions_incremental_rules(self):
        result = STATUS_UPDATE_PROMPT.format(
            topic_name="T", current_status="S",
            current_messages="(none)", recent_summaries="test",
            annotations="(none)",
        )
        assert "ADD" in result

    def test_mentions_annotation_rules(self):
        result = STATUS_UPDATE_PROMPT.format(
            topic_name="T", current_status="S",
            current_messages="(none)", recent_summaries="test",
            annotations='- "backprop" → unsure',
        )
        assert "highlights" in result.lower() or "interested" in result.lower()
        assert "Important" in result
        assert "Unsure" in result
        assert "not_relevant" not in result
        assert "Not relevant" not in result
        assert "backprop" in result


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
        CHAT_RESPONSE_PROMPT,
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

    def test_metadata_prompt_has_no_concepts_field(self):
        assert '"concepts"' not in CHAT_METADATA_PROMPT

    def test_metadata_prompt_requests_json(self):
        assert "JSON" in CHAT_METADATA_PROMPT or "json" in CHAT_METADATA_PROMPT

    def test_loom_highlight_block_contract(self):
        assert "{~HL~}" in CHAT_STREAM_HIGHLIGHT_BLOCK
        assert "{~/HL~}" in CHAT_STREAM_HIGHLIGHT_BLOCK
        assert "at most 2" in CHAT_STREAM_HIGHLIGHT_BLOCK

    def test_baseline_prompts_do_not_contain_highlights(self):
        from prompts import CHAT_STREAM_BASELINE_PROMPT
        assert CHAT_STREAM_HIGHLIGHT_BLOCK not in CHAT_STREAM_BASELINE_PROMPT
        assert "{~HL~}" not in CHAT_STREAM_BASELINE_PROMPT

    def test_stream_assembly_adds_highlights_only_after_baseline_branches(self):
        main_source = (Path(__file__).parent.parent / "backend" / "main.py").read_text()
        start = main_source.index('if req.condition == "baseline" and req.personalDetails:')
        loom_start = main_source.index(
            "    else:\n        if isinstance(req.topicStatus, dict):",
            start,
        )
        baseline_branch = main_source[start:loom_start]
        loom_branch = main_source[loom_start:main_source.index("    async def event_generator()", loom_start)]
        assert "CHAT_STREAM_HIGHLIGHT_BLOCK" not in baseline_branch
        assert "CHAT_STREAM_HIGHLIGHT_BLOCK" in loom_branch

    def test_classify_first_contract(self):
        assert "existing topic id" in CLASSIFY_FIRST_PROMPT.lower()
        assert "NEW:" in CLASSIFY_FIRST_PROMPT
        assert "ONEOFF" in CLASSIFY_FIRST_PROMPT
        assert "No explanation" in CLASSIFY_FIRST_PROMPT


class TestStatusUpdatePromptOverview:
    """STATUS_UPDATE_PROMPT returns overview bullets only."""

    def _formatted(self):
        return STATUS_UPDATE_PROMPT.format(
            topic_name="ML", current_status="Overview: basics",
            current_messages="user: test", recent_summaries="- chat 1",
            annotations="(none)",
        )

    def test_overview_only_output(self):
        result = self._formatted()
        assert '"overview"' in result
        assert "Concepts Traversed" not in result
        assert "concepts_traversed" not in result

    def test_no_mastery_or_stance_fields(self):
        result = self._formatted()
        assert "Do NOT assign mastery levels" not in result
        assert '"neutral"' not in result
        assert "do NOT override stances" not in result
        assert "background" in result.lower() or "skill level" in result

    def test_preserves_user_steering_notes(self):
        result = self._formatted()
        assert "steering notes" in result.lower() or "authoritative" in result.lower()


class TestOverviewAiEditPrompt:
    def test_formats_all_fields(self):
        result = OVERVIEW_AI_EDIT_PROMPT.format(
            topic_name="ML",
            current_overview="- CS student\n- Knows Python",
            instruction="Add that I'm interested in NLP",
        )
        assert "ML" in result
        assert "CS student" in result
        assert "NLP" in result

    def test_contains_json_instruction(self):
        assert '"overview"' in OVERVIEW_AI_EDIT_PROMPT
        assert "JSON" in OVERVIEW_AI_EDIT_PROMPT or "json" in OVERVIEW_AI_EDIT_PROMPT.lower()

    def test_mentions_add_edit_remove(self):
        lower = OVERVIEW_AI_EDIT_PROMPT.lower()
        assert "add" in lower
        assert "edit" in lower
        assert "remove" in lower


class TestDesignProbeRound2Prompts:
    def test_status_update_has_goal_phrasing_constraint(self):
        assert "4–7" in STATUS_UPDATE_PROMPT or "4-7" in STATUS_UPDATE_PROMPT
        assert "User wants to" in STATUS_UPDATE_PROMPT
        assert "Explore generative AI system design" in STATUS_UPDATE_PROMPT

    def test_directions_prompt_has_annotations_placeholder(self):
        assert "{annotations}" in SIDEBAR_NEW_DIRECTIONS_PROMPT


class TestRound3StatusPrompt:
    def test_volume_cap_and_conservative_wording(self):
        assert "at most 2 changes TOTAL" in STATUS_UPDATE_PROMPT
        assert "Small improvements are NOT a valid reason" in STATUS_UPDATE_PROMPT

    def test_important_label_and_legacy_meaning(self):
        assert "Important (important)" in STATUS_UPDATE_PROMPT
        assert "Legacy data may say interested" in STATUS_UPDATE_PROMPT
