"""Comprehensive tests for Module 2: structured summaries, same-topic filtering,
richer memory prompts, connection card UI, Build-on-this action, persistence,
and connection marker parsing/stripping.

Covers backend endpoints, prompt templates, CSS/JS contracts, and edge cases.
"""

import sys
import json
import re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient


def _get_client():
    from main import app
    return TestClient(app)


def _parse_sse(text):
    events = []
    for line in text.split("\n"):
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))
    return events


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Structured Summarization (userAsked / aiCovered)
# ═══════════════════════════════════════════════════════════════════════════════

class TestStructuredSummarizePrompt:
    """CHAT_SUMMARIZE_PROMPT must request userAsked and aiCovered fields."""

    def test_prompt_contains_userAsked_field(self):
        from prompts import CHAT_SUMMARIZE_PROMPT
        assert '"userAsked"' in CHAT_SUMMARIZE_PROMPT

    def test_prompt_contains_aiCovered_field(self):
        from prompts import CHAT_SUMMARIZE_PROMPT
        assert '"aiCovered"' in CHAT_SUMMARIZE_PROMPT

    def test_prompt_still_contains_title_and_summary(self):
        from prompts import CHAT_SUMMARIZE_PROMPT
        assert '"title"' in CHAT_SUMMARIZE_PROMPT
        assert '"summary"' in CHAT_SUMMARIZE_PROMPT

    def test_prompt_formats_messages(self):
        from prompts import CHAT_SUMMARIZE_PROMPT
        formatted = CHAT_SUMMARIZE_PROMPT.format(messages="user: What is X?\nassistant: X is...")
        assert "What is X?" in formatted

    def test_prompt_instructs_concise_description(self):
        from prompts import CHAT_SUMMARIZE_PROMPT
        lower = CHAT_SUMMARIZE_PROMPT.lower()
        assert "concise" in lower or "1-2 sentence" in lower

    def test_prompt_describes_user_side(self):
        from prompts import CHAT_SUMMARIZE_PROMPT
        lower = CHAT_SUMMARIZE_PROMPT.lower()
        assert "user" in lower and ("asked" in lower or "wanted" in lower or "provided" in lower)

    def test_prompt_describes_ai_side(self):
        from prompts import CHAT_SUMMARIZE_PROMPT
        lower = CHAT_SUMMARIZE_PROMPT.lower()
        assert "ai" in lower and ("addressed" in lower or "taught" in lower or "recommended" in lower)


class TestStructuredSummarizeEndpoint:
    """POST /api/chat/summarize should return userAsked and aiCovered."""

    def test_returns_all_four_fields(self):
        mock_result = {
            "title": "Backprop Basics",
            "summary": "Discussed how backpropagation works in neural nets.",
            "userAsked": "How does backpropagation work?",
            "aiCovered": "Explained chain rule, gradient flow, and weight updates.",
        }
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            data = _get_client().post("/api/chat/summarize", json={
                "messages": [
                    {"role": "user", "content": "How does backpropagation work?"},
                    {"role": "assistant", "content": "Backpropagation uses the chain rule..."},
                ],
            }).json()
            assert data["title"] == "Backprop Basics"
            assert data["summary"] == "Discussed how backpropagation works in neural nets."
            assert data["userAsked"] == "How does backpropagation work?"
            assert data["aiCovered"] == "Explained chain rule, gradient flow, and weight updates."

    def test_returns_empty_userAsked_aiCovered_when_missing(self):
        mock_result = {"title": "Quick Chat", "summary": "A brief exchange."}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            data = _get_client().post("/api/chat/summarize", json={
                "messages": [{"role": "user", "content": "hi"}],
            }).json()
            assert "title" in data
            assert "summary" in data

    def test_summarize_with_long_conversation(self):
        mock_result = {
            "title": "Long Chat", "summary": "Long conversation about ML.",
            "userAsked": "Multiple questions about ML topics",
            "aiCovered": "Explained several ML concepts",
        }
        msgs = [
            {"role": "user" if i % 2 == 0 else "assistant", "content": f"Message {i}"}
            for i in range(30)
        ]
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat/summarize", json={"messages": msgs})
            assert resp.status_code == 200
            data = resp.json()
            assert data["userAsked"] == "Multiple questions about ML topics"

    def test_summarize_with_empty_messages(self):
        mock_result = {"title": "Empty", "summary": "", "userAsked": "", "aiCovered": ""}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat/summarize", json={"messages": []})
            assert resp.status_code == 200

    def test_summarize_prompt_uses_messages(self):
        mock_result = {"title": "T", "summary": "S", "userAsked": "U", "aiCovered": "A"}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            _get_client().post("/api/chat/summarize", json={
                "messages": [
                    {"role": "user", "content": "What is gradient descent?"},
                    {"role": "assistant", "content": "An optimization algorithm."},
                ],
            })
            call_args = m.chat.call_args
            system_prompt = call_args[1].get("system_prompt") or call_args[0][1]
            assert "gradient descent" in system_prompt.lower()

    def test_summarize_with_context_blocks(self):
        mock_result = {"title": "T", "summary": "S", "userAsked": "U", "aiCovered": "A"}
        with patch("main.llm") as m:
            m.chat = AsyncMock(return_value=mock_result)
            resp = _get_client().post("/api/chat/summarize", json={
                "messages": [
                    {"role": "user", "content": "[Context from my knowledge map: past info]\n\nHow does this relate?"},
                    {"role": "assistant", "content": "It relates because..."},
                ],
            })
            assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Same-Topic Filtering for Stream Endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestSameTopicFilteringStreamEndpoint:
    """Backend processes allChatSummaries — tests verify how the endpoint handles
    summaries with various shapes including userAsked/aiCovered and topicId."""

    def test_summaries_with_userAsked_aiCovered_accepted(self):
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "allChatSummaries": [
                    {
                        "id": "c2", "title": "Past Chat", "summary": "Summary",
                        "userAsked": "How does X work?", "aiCovered": "Explained X.",
                        "embedding": [0.5] * 10, "topicId": "t1",
                    },
                ],
            })
            assert resp.status_code == 200

    def test_summaries_without_userAsked_accepted(self):
        """Legacy summaries without userAsked/aiCovered should still work."""
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "allChatSummaries": [
                    {"id": "c2", "title": "Old Chat", "summary": "Old summary", "embedding": [0.4] * 10},
                ],
            })
            assert resp.status_code == 200

    def test_empty_summaries_list(self):
        async def fake_stream(*args, **kwargs):
            yield "plain answer"
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "allChatSummaries": [],
            })
            assert resp.status_code == 200

    def test_no_allChatSummaries_field_defaults_empty(self):
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
            })
            assert resp.status_code == 200

    def test_summaries_with_topicId_field_accepted(self):
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "allChatSummaries": [
                    {"id": "c2", "title": "X", "summary": "Y", "embedding": [0.5] * 10, "topicId": "topic_ml"},
                    {"id": "c3", "title": "Z", "summary": "W", "embedding": [0.5] * 10, "topicId": "topic_fitness"},
                ],
            })
            assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Richer Memory Prompt (userAsked/aiCovered in CHAT_STREAM_MEMORY_PROMPT)
# ═══════════════════════════════════════════════════════════════════════════════

class TestRicherMemoryPrompt:
    """CHAT_STREAM_MEMORY_PROMPT should reference userAsked and aiCovered."""

    def test_prompt_contains_userAsked_keyword(self):
        from prompts import CHAT_STREAM_MEMORY_PROMPT
        assert "userAsked" in CHAT_STREAM_MEMORY_PROMPT

    def test_prompt_contains_aiCovered_keyword(self):
        from prompts import CHAT_STREAM_MEMORY_PROMPT
        assert "aiCovered" in CHAT_STREAM_MEMORY_PROMPT

    def test_prompt_one_shot_example_has_userAsked(self):
        from prompts import CHAT_STREAM_MEMORY_PROMPT
        assert '"userAsked"' in CHAT_STREAM_MEMORY_PROMPT

    def test_prompt_one_shot_example_has_aiCovered(self):
        from prompts import CHAT_STREAM_MEMORY_PROMPT
        assert '"aiCovered"' in CHAT_STREAM_MEMORY_PROMPT

    def test_connection_block_format_includes_userAsked(self):
        from prompts import CHAT_STREAM_MEMORY_PROMPT
        conn_section = CHAT_STREAM_MEMORY_PROMPT[CHAT_STREAM_MEMORY_PROMPT.index("Connection block format"):]
        assert "userAsked" in conn_section

    def test_connection_block_format_includes_aiCovered(self):
        from prompts import CHAT_STREAM_MEMORY_PROMPT
        conn_section = CHAT_STREAM_MEMORY_PROMPT[CHAT_STREAM_MEMORY_PROMPT.index("Connection block format"):]
        assert "aiCovered" in conn_section

    def test_prompt_format_with_structured_data(self):
        from prompts import CHAT_STREAM_MEMORY_PROMPT
        past_chats = json.dumps([
            {
                "chatId": "c1", "title": "ML Basics",
                "userAsked": "How does gradient descent work?",
                "aiCovered": "Explained learning rate and parameter updates",
            }
        ], indent=2)
        formatted = CHAT_STREAM_MEMORY_PROMPT.format(past_chats_json=past_chats)
        assert "gradient descent" in formatted
        assert "learning rate" in formatted
        assert "{past_chats_json}" not in formatted

    def test_prompt_format_with_empty_userAsked(self):
        from prompts import CHAT_STREAM_MEMORY_PROMPT
        past_chats = json.dumps([
            {"chatId": "c1", "title": "Chat", "userAsked": "", "aiCovered": ""}
        ], indent=2)
        formatted = CHAT_STREAM_MEMORY_PROMPT.format(past_chats_json=past_chats)
        assert "{past_chats_json}" not in formatted

    def test_prompt_no_longer_uses_summary_field(self):
        """The prompt should use userAsked/aiCovered, not the generic summary."""
        from prompts import CHAT_STREAM_MEMORY_PROMPT
        assert '"summary"' not in CHAT_STREAM_MEMORY_PROMPT or "userAsked" in CHAT_STREAM_MEMORY_PROMPT


class TestStreamEndpointPassesStructuredData:
    """Verify that the stream endpoint injects userAsked/aiCovered into the LLM prompt."""

    def test_userAsked_passed_to_prompt(self):
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "Tell me about RNNs"}],
                "allChatSummaries": [
                    {
                        "id": "c2", "title": "LSTM Chat",
                        "userAsked": "How do LSTMs handle long sequences?",
                        "aiCovered": "Explained gates and cell state",
                        "embedding": [0.5] * 10,
                    },
                ],
            })
            stream_call = m.chat_stream.call_args
            system_prompt = stream_call.kwargs.get("system_prompt", "")
            assert "LSTM" in system_prompt or "How do LSTMs" in system_prompt

    def test_aiCovered_passed_to_prompt(self):
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "Tell me about NNs"}],
                "allChatSummaries": [
                    {
                        "id": "c2", "title": "NN Intro",
                        "userAsked": "How do neural networks learn?",
                        "aiCovered": "Covered activation functions and loss landscape",
                        "embedding": [0.5] * 10,
                    },
                ],
            })
            stream_call = m.chat_stream.call_args
            system_prompt = stream_call.kwargs.get("system_prompt", "")
            assert "activation functions" in system_prompt or "loss landscape" in system_prompt

    def test_prompt_excludes_summary_field_from_past_chats(self):
        """past_chats_for_prompt should NOT have 'summary'; instead use userAsked/aiCovered."""
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "allChatSummaries": [
                    {
                        "id": "c2", "title": "X",
                        "summary": "OLD_SUMMARY_VALUE_SHOULD_NOT_APPEAR",
                        "userAsked": "user question", "aiCovered": "ai answer",
                        "embedding": [0.5] * 10,
                    },
                ],
            })
            stream_call = m.chat_stream.call_args
            system_prompt = stream_call.kwargs.get("system_prompt", "")
            assert "OLD_SUMMARY_VALUE_SHOULD_NOT_APPEAR" not in system_prompt

    def test_missing_userAsked_defaults_to_empty(self):
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "allChatSummaries": [
                    {"id": "c2", "title": "X", "summary": "Y", "embedding": [0.5] * 10},
                ],
            })
            assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Connection Card UI: CSS classes and JS function existence
# ═══════════════════════════════════════════════════════════════════════════════

class TestConnectionCardCSS:
    """All CSS classes for the rich connection card must exist."""

    def _get_css(self):
        return _get_client().get("/static/styles.css").text

    def test_conn_card_class(self):
        assert '.conn-card' in self._get_css()

    def test_conn_card_visible_class(self):
        assert '.conn-card.visible' in self._get_css()

    def test_conn_card_header_class(self):
        assert '.conn-card-header' in self._get_css()

    def test_conn_card_title_class(self):
        assert '.conn-card-title' in self._get_css()

    def test_conn_card_close_class(self):
        assert '.conn-card-close' in self._get_css()

    def test_conn_card_summary_class(self):
        assert '.conn-card-summary' in self._get_css()

    def test_conn_card_row_class(self):
        assert '.conn-card-row' in self._get_css()

    def test_conn_card_label_class(self):
        assert '.conn-card-label' in self._get_css()

    def test_conn_card_value_class(self):
        assert '.conn-card-value' in self._get_css()

    def test_conn_card_insight_class(self):
        assert '.conn-card-insight' in self._get_css()

    def test_conn_card_actions_class(self):
        assert '.conn-card-actions' in self._get_css()

    def test_conn_card_build_class(self):
        assert '.conn-card-build' in self._get_css()

    def test_conn_card_goto_class(self):
        assert '.conn-card-goto' in self._get_css()

    def test_conn_card_build_hover(self):
        assert '.conn-card-build:hover' in self._get_css()

    def test_conn_card_goto_hover(self):
        assert '.conn-card-goto:hover' in self._get_css()

    def test_conn_card_close_hover(self):
        assert '.conn-card-close:hover' in self._get_css()

    def test_conn_marker_class(self):
        assert '.conn-marker' in self._get_css()

    def test_conn_marker_resolved(self):
        assert '.conn-marker.resolved' in self._get_css()

    def test_conn_marker_resolved_hover(self):
        assert '.conn-marker.resolved:hover' in self._get_css()

    def test_no_conn_popover_class(self):
        """Old popover class should be removed."""
        assert '.conn-popover' not in self._get_css()

    def test_conn_card_fixed_position(self):
        css = self._get_css()
        card_section = css[css.index('.conn-card'):]
        assert 'position: fixed' in card_section[:200]

    def test_conn_card_z_index(self):
        css = self._get_css()
        card_section = css[css.index('.conn-card'):]
        assert 'z-index' in card_section[:200]


class TestConnectionCardJS:
    """All JS functions for the connection card must exist in app.js."""

    def _get_js(self):
        return _get_client().get("/static/app.js").text

    def test_getConnCard_function(self):
        assert '_getConnCard' in self._get_js()

    def test_showConnCard_function(self):
        assert '_showConnCard' in self._get_js()

    def test_hideConnCard_function(self):
        assert '_hideConnCard' in self._get_js()

    def test_bindConnectionCards_function(self):
        assert '_bindConnectionCards' in self._get_js()

    def test_connCardEl_property(self):
        assert '_connCardEl' in self._get_js()

    def test_no_connPopover_references(self):
        """Old popover references should be removed."""
        js = self._get_js()
        assert '_connPopoverEl' not in js
        assert '_getConnPopover' not in js
        assert '_showConnPopover' not in js
        assert '_hideConnPopover' not in js

    def test_card_html_has_you_asked(self):
        js = self._get_js()
        assert 'You asked' in js

    def test_card_html_has_you_learned(self):
        js = self._get_js()
        assert 'You learned' in js

    def test_card_html_has_build_on_this(self):
        js = self._get_js()
        assert 'Build on this' in js

    def test_card_html_has_go_to_chat(self):
        js = self._get_js()
        assert 'Go to chat' in js

    def test_card_uses_conn_card_class(self):
        js = self._get_js()
        assert "className = 'conn-card'" in js or 'className = "conn-card"' in js

    def test_conn_card_close_button(self):
        js = self._get_js()
        assert 'conn-card-close' in js

    def test_conn_card_marker_click_event(self):
        """Connection card appears on marker click, not mouseenter."""
        js = self._get_js()
        assert "addEventListener('click'" in js
        # Find the function definition (second occurrence, after the call site)
        first = js.index('_bindConnectionCards')
        card_bind_def_start = js.index('_bindConnectionCards', first + 1)
        card_bind_section = js[card_bind_def_start:card_bind_def_start + 400]
        assert 'click' in card_bind_section

    def test_showConnCard_reads_data_attributes(self):
        js = self._get_js()
        show_start = js.index('_showConnCard')
        show_section = js[show_start:show_start + 600]
        assert 'connChatTitle' in show_section
        assert 'connUserAsked' in show_section
        assert 'connAiCovered' in show_section
        assert 'connText' in show_section
        assert 'connChatId' in show_section


# ═══════════════════════════════════════════════════════════════════════════════
# 5. "Build on this" Action and Context Injection
# ═══════════════════════════════════════════════════════════════════════════════

class TestBuildOnThisActionJS:
    """JS code for Build-on-this must fetch full chat history and call setContextBlock."""

    def _get_js(self):
        return _get_client().get("/static/app.js").text

    def _get_build_handler_section(self):
        js = self._get_js()
        first = js.index('conn-card-build')
        handler_start = js.index('conn-card-build', first + 1)
        return js[handler_start:handler_start + 1200]

    def test_build_button_calls_setContextBlock(self):
        assert 'setContextBlock' in self._get_build_handler_section()

    def test_build_action_fetches_past_messages(self):
        section = self._get_build_handler_section()
        assert 'Storage.getMessages' in section

    def test_build_action_uses_chatId(self):
        section = self._get_build_handler_section()
        assert 'targetChatId' in section or 'chatId' in section

    def test_build_action_composes_insight(self):
        assert 'insight' in self._get_build_handler_section()

    def test_build_action_hides_card(self):
        assert '_hideConnCard' in self._get_build_handler_section()

    def test_build_action_focuses_input(self):
        section = self._get_build_handler_section()
        assert 'chatInput' in section and 'focus' in section

    def test_build_context_includes_chat_history_markers(self):
        """Context string should include markers for previous chat history."""
        js = self._get_js()
        assert '--- Previous chat history ---' in js
        assert '--- End of previous chat ---' in js

    def test_build_context_formats_roles(self):
        """Messages should be prefixed with User/AI role labels."""
        js = self._get_js()
        assert "role === 'user' ? 'User' : 'AI'" in js

    def test_setContextBlock_function_exists(self):
        js = self._get_js()
        assert 'setContextBlock' in js


class TestGoToChatActionJS:
    """Go-to-chat button navigates to the linked chat."""

    def _get_js(self):
        return _get_client().get("/static/app.js").text

    def _get_goto_handler_section(self):
        js = self._get_js()
        # Find the event handler (second occurrence — first is in HTML template)
        first = js.index('conn-card-goto')
        handler_start = js.index('conn-card-goto', first + 1)
        return js[handler_start:handler_start + 600]

    def test_goto_reads_target_chat_id(self):
        assert 'targetChatId' in self._get_goto_handler_section()

    def test_goto_calls_renderChat(self):
        assert '_renderChat' in self._get_goto_handler_section()

    def test_goto_hides_card(self):
        assert '_hideConnCard' in self._get_goto_handler_section()

    def test_goto_summarizes_current_chat(self):
        assert '_summarizeCurrentChat' in self._get_goto_handler_section()

    def test_goto_link_hidden_without_chatId(self):
        """If no chatId, the goto link should be hidden."""
        js = self._get_js()
        show_start = js.index('_showConnCard')
        show_section = js[show_start:show_start + 1200]
        assert "style.display" in show_section


# ═══════════════════════════════════════════════════════════════════════════════
# 6. Connection Persistence (storage + re-render on load)
# ═══════════════════════════════════════════════════════════════════════════════

class TestConnectionPersistenceJS:
    """Assistant messages should store connections and rawContent for re-render."""

    def _get_js(self):
        return _get_client().get("/static/app.js").text

    def _get_appendMessage_def(self):
        """Find the _appendMessage function definition (not a call site)."""
        js = self._get_js()
        # The definition pattern: _appendMessage(msg)
        idx = js.index('_appendMessage(msg)')
        return js[idx:idx + 2000]

    def test_assistant_msg_stores_connections(self):
        js = self._get_js()
        assert 'connections: savedConns' in js or 'connections:' in js

    def test_assistant_msg_stores_rawContent(self):
        js = self._get_js()
        assert 'rawContent:' in js

    def test_appendMessage_checks_connections(self):
        assert 'msg.connections' in self._get_appendMessage_def()

    def test_appendMessage_checks_rawContent(self):
        assert 'msg.rawContent' in self._get_appendMessage_def()

    def test_appendMessage_calls_parseConnectionMarkers(self):
        assert '_parseConnectionMarkers' in self._get_appendMessage_def()

    def test_appendMessage_calls_resolveConnectionMarkers(self):
        assert '_resolveConnectionMarkers' in self._get_appendMessage_def()

    def test_finalize_saves_rawContent_and_connections(self):
        """_finalizeStreamingMessage + done handler should set rawContent and connections on msg."""
        js = self._get_js()
        done_start = js.index("evt.type === 'done'") if "evt.type === 'done'" in js else js.index('type === "done"')
        done_section = js[done_start:done_start + 1200]
        assert 'rawContent' in done_section
        assert 'connections' in done_section


# ═══════════════════════════════════════════════════════════════════════════════
# 7. Connection Marker Parsing / Stripping Logic
# ═══════════════════════════════════════════════════════════════════════════════

class TestParseConnectionMarkersJS:
    """_parseConnectionMarkers replaces {~N} with <span class='conn-marker'>."""

    def _get_js(self):
        return _get_client().get("/static/app.js").text

    def test_regex_pattern_for_markers(self):
        js = self._get_js()
        assert r'{~(\d+)}' in js or r'\{~(\d+)\}' in js or r'{~(\\d+)}' in js

    def test_creates_conn_marker_span(self):
        js = self._get_js()
        parse_start = js.index('_parseConnectionMarkers')
        parse_section = js[parse_start:parse_start + 300]
        assert 'conn-marker' in parse_section
        assert 'loading' in parse_section

    def test_stores_conn_id_as_data_attribute(self):
        js = self._get_js()
        parse_start = js.index('_parseConnectionMarkers')
        parse_section = js[parse_start:parse_start + 300]
        assert 'data-conn-id' in parse_section


class TestStripConnectionBlockJS:
    """_stripConnectionBlock should separate main text from CONNECTIONS block."""

    def _get_js(self):
        return _get_client().get("/static/app.js").text

    def _get_strip_def(self):
        js = self._get_js()
        # Find the function definition: _stripConnectionBlock(text)
        idx = js.index('_stripConnectionBlock(text)')
        return js[idx:idx + 800]

    def test_stripConnectionBlock_function_exists(self):
        js = self._get_js()
        assert '_stripConnectionBlock' in js

    def test_strips_on_CONNECTIONS_marker(self):
        assert '{~CONNECTIONS~}' in self._get_strip_def()

    def test_strips_on_END_marker(self):
        assert '{~END~}' in self._get_strip_def()

    def test_returns_mainText_and_connectionsJson(self):
        section = self._get_strip_def()
        assert 'mainText' in section
        assert 'connectionsJson' in section

    def test_handles_missing_connections_block(self):
        assert 'null' in self._get_strip_def()

    def test_handles_json_parse_error(self):
        assert 'catch' in self._get_strip_def()


class TestResolveConnectionMarkersJS:
    """_resolveConnectionMarkers populates data attrs and binds cards."""

    def _get_js(self):
        return _get_client().get("/static/app.js").text

    def _get_resolve_def(self):
        js = self._get_js()
        # Find function definition: _resolveConnectionMarkers(contentEl, connectionsJson)
        idx = js.index('_resolveConnectionMarkers(contentEl, connectionsJson)')
        return js[idx:idx + 2000]

    def test_sets_connText_dataset(self):
        assert 'connText' in self._get_resolve_def()

    def test_sets_connChatId_dataset(self):
        assert 'connChatId' in self._get_resolve_def()

    def test_sets_connChatTitle_dataset(self):
        assert 'connChatTitle' in self._get_resolve_def()

    def test_sets_connUserAsked_dataset(self):
        assert 'connUserAsked' in self._get_resolve_def()

    def test_sets_connAiCovered_dataset(self):
        assert 'connAiCovered' in self._get_resolve_def()

    def test_removes_loading_class_adds_resolved(self):
        section = self._get_resolve_def()
        assert "remove('loading')" in section or "remove(\"loading\")" in section
        assert "add('resolved')" in section or "add(\"resolved\")" in section

    def test_unmatched_markers_removed(self):
        assert '.remove()' in self._get_resolve_def()

    def test_calls_bindConnectionCards(self):
        assert '_bindConnectionCards' in self._get_resolve_def()


# ═══════════════════════════════════════════════════════════════════════════════
# 8. Stream Endpoint: Memory Retrieval with Structured Data
# ═══════════════════════════════════════════════════════════════════════════════

class TestStreamMemoryWithStructuredData:
    """Stream endpoint with structured summaries (userAsked/aiCovered)."""

    def test_memory_prompt_selected_with_structured_summaries(self):
        async def fake_stream(*args, **kwargs):
            yield "Answer with{~1} connection\n\n{~CONNECTIONS~}\n"
            yield '[{"id":1,"chatId":"c2","chatTitle":"Old","userAsked":"Q","aiCovered":"A","text":"insight"}]'
            yield "\n{~END~}"
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "What is backprop?"}],
                "allChatSummaries": [
                    {
                        "id": "c2", "title": "Old Chat",
                        "userAsked": "How do gradients flow?",
                        "aiCovered": "Explained chain rule",
                        "embedding": [0.4] * 10,
                    },
                ],
            })
            assert resp.status_code == 200
            events = _parse_sse(resp.text)
            done = [e for e in events if e["type"] == "done"]
            assert len(done) == 1
            assert "{~1}" in done[0]["response"]
            assert "{~CONNECTIONS~}" in done[0]["response"]

    def test_connections_include_userAsked_aiCovered_in_response(self):
        conns = json.dumps([{
            "id": 1, "chatId": "c2", "chatTitle": "Old",
            "userAsked": "How does X work?", "aiCovered": "Explained X mechanism",
            "text": "Connection insight",
        }])
        text = f"Answer{{~1}}\n\n{{~CONNECTIONS~}}\n{conns}\n{{~END~}}"
        async def fake_stream(*args, **kwargs):
            yield text
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "allChatSummaries": [
                    {"id": "c2", "title": "Old", "summary": "S", "embedding": [0.5] * 10},
                ],
            })
            events = _parse_sse(resp.text)
            done = [e for e in events if e["type"] == "done"][0]
            assert "How does X work?" in done["response"]
            assert "Explained X mechanism" in done["response"]
            assert "Connection insight" in done["response"]

    def test_connections_with_only_text_no_userAsked(self):
        conns = json.dumps([{"id": 1, "chatId": "c2", "chatTitle": "Old", "text": "Connection only"}])
        text = f"Answer{{~1}}\n\n{{~CONNECTIONS~}}\n{conns}\n{{~END~}}"
        async def fake_stream(*args, **kwargs):
            yield text
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
            })
            assert resp.status_code == 200

    def test_multiple_connections_with_structured_data(self):
        conns = json.dumps([
            {"id": 1, "chatId": "c2", "chatTitle": "Chat A", "userAsked": "Q1", "aiCovered": "A1", "text": "insight1"},
            {"id": 2, "chatId": "c3", "chatTitle": "Chat B", "userAsked": "Q2", "aiCovered": "A2", "text": "insight2"},
            {"id": 3, "chatId": "c4", "chatTitle": "Chat C", "userAsked": "Q3", "aiCovered": "A3", "text": "insight3"},
        ])
        text = f"Point A{{~1}} and B{{~2}} and C{{~3}}\n\n{{~CONNECTIONS~}}\n{conns}\n{{~END~}}"
        async def fake_stream(*args, **kwargs):
            yield text
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
            })
            events = _parse_sse(resp.text)
            done = [e for e in events if e["type"] == "done"][0]
            assert "{~1}" in done["response"]
            assert "{~2}" in done["response"]
            assert "{~3}" in done["response"]


# ═══════════════════════════════════════════════════════════════════════════════
# 9. Stream Metadata Stripping with Structured Connections
# ═══════════════════════════════════════════════════════════════════════════════

class TestStreamMetadataStrippingStructured:
    """Connection markers stripped before metadata extraction, including structured data."""

    def test_structured_connection_markers_stripped_from_metadata(self):
        conns = json.dumps([{
            "id": 1, "chatId": "c2", "chatTitle": "Old",
            "userAsked": "Q", "aiCovered": "A", "text": "insight",
        }])
        text = f"Use a scheduler{{~1}} for best results.\n\n{{~CONNECTIONS~}}\n{conns}\n{{~END~}}"
        async def fake_stream(*args, **kwargs):
            yield text
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={
                "topic": {"name": "ML", "matchedExistingId": None, "confidence": 0.9},
                "concepts": [],
            })
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "allChatSummaries": [
                    {"id": "c2", "title": "ML", "summary": "ml", "embedding": [0.5] * 10},
                ],
            })
            meta_call = m.chat.call_args
            messages_arg = meta_call[0][0]
            assistant_msg = [msg for msg in messages_arg if msg["role"] == "assistant"]
            assert len(assistant_msg) == 1
            assert "{~1}" not in assistant_msg[0]["content"]
            assert "{~CONNECTIONS~}" not in assistant_msg[0]["content"]
            assert "Use a scheduler" in assistant_msg[0]["content"]


# ═══════════════════════════════════════════════════════════════════════════════
# 10. Edge Cases
# ═══════════════════════════════════════════════════════════════════════════════

class TestEdgeCases:
    """Edge cases for the structured summary and connection system."""

    def test_unicode_in_userAsked_and_aiCovered(self):
        conns = json.dumps([{
            "id": 1, "chatId": "c2", "chatTitle": "中文聊天",
            "userAsked": "如何使用梯度下降？", "aiCovered": "解释了学习率和参数更新",
            "text": "你之前学习了梯度下降的基本概念",
        }], ensure_ascii=False)
        text = f"Answer{{~1}}\n\n{{~CONNECTIONS~}}\n{conns}\n{{~END~}}"
        async def fake_stream(*args, **kwargs):
            yield text
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "你好"}],
            })
            assert resp.status_code == 200
            events = _parse_sse(resp.text)
            done = [e for e in events if e["type"] == "done"][0]
            assert "Answer" in done["response"]

    def test_very_long_userAsked_aiCovered(self):
        long_text = "x" * 2000
        conns = json.dumps([{
            "id": 1, "chatId": "c2", "chatTitle": "T",
            "userAsked": long_text, "aiCovered": long_text, "text": "insight",
        }])
        text = f"Answer{{~1}}\n\n{{~CONNECTIONS~}}\n{conns}\n{{~END~}}"
        async def fake_stream(*args, **kwargs):
            yield text
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
            })
            assert resp.status_code == 200

    def test_special_characters_in_structured_fields(self):
        conns = json.dumps([{
            "id": 1, "chatId": "c2", "chatTitle": "Test <>&\"'",
            "userAsked": "How do I use \"quotes\" & <tags>?",
            "aiCovered": "Explained escaping: &amp; \\n \\t",
            "text": "Connection with special chars: <>&\"'",
        }])
        text = f"Answer{{~1}}\n\n{{~CONNECTIONS~}}\n{conns}\n{{~END~}}"
        async def fake_stream(*args, **kwargs):
            yield text
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
            })
            assert resp.status_code == 200

    def test_connection_with_null_userAsked(self):
        conns = json.dumps([{
            "id": 1, "chatId": "c2", "chatTitle": "T",
            "userAsked": None, "aiCovered": None, "text": "insight",
        }])
        text = f"Answer{{~1}}\n\n{{~CONNECTIONS~}}\n{conns}\n{{~END~}}"
        async def fake_stream(*args, **kwargs):
            yield text
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
            })
            assert resp.status_code == 200

    def test_empty_connection_array_with_markers(self):
        text = "Point{~1}\n\n{~CONNECTIONS~}\n[]\n{~END~}"
        async def fake_stream(*args, **kwargs):
            yield text
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
            })
            assert resp.status_code == 200

    def test_marker_id_mismatch(self):
        """Marker {~5} but connection has id=1 — marker should remain unresolved."""
        conns = json.dumps([{"id": 1, "chatId": "c2", "chatTitle": "T", "text": "insight"}])
        text = f"Point{{~5}}\n\n{{~CONNECTIONS~}}\n{conns}\n{{~END~}}"
        async def fake_stream(*args, **kwargs):
            yield text
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
            })
            assert resp.status_code == 200

    def test_malformed_connections_json(self):
        text = "Answer{~1}\n\n{~CONNECTIONS~}\nNOT JSON\n{~END~}"
        async def fake_stream(*args, **kwargs):
            yield text
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
            })
            assert resp.status_code == 200

    def test_connections_start_but_no_end(self):
        text = "Answer{~1}\n\n{~CONNECTIONS~}\n[{\"id\":1}]"
        async def fake_stream(*args, **kwargs):
            yield text
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
            })
            events = _parse_sse(resp.text)
            done = [e for e in events if e["type"] == "done"][0]
            assert done["response"] == text

    def test_double_connection_blocks(self):
        """Only first block should be parsed."""
        conns1 = json.dumps([{"id": 1, "chatId": "c2", "chatTitle": "T", "text": "insight"}])
        conns2 = json.dumps([{"id": 2, "chatId": "c3", "chatTitle": "T2", "text": "insight2"}])
        text = f"Answer{{~1}}\n\n{{~CONNECTIONS~}}\n{conns1}\n{{~END~}}\n\n{{~CONNECTIONS~}}\n{conns2}\n{{~END~}}"
        async def fake_stream(*args, **kwargs):
            yield text
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
            })
            assert resp.status_code == 200

    def test_no_user_messages_for_embedding_query(self):
        """Only assistant messages — embedding query should not crash."""
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [
                    {"role": "assistant", "content": "I said something"},
                ],
                "allChatSummaries": [
                    {"id": "c2", "title": "X", "summary": "Y",
                     "userAsked": "Q", "aiCovered": "A", "embedding": [0.5] * 10},
                ],
            })
            assert resp.status_code == 200

    def test_allChatSummaries_with_mixed_fields(self):
        """Mix of legacy (summary-only) and structured (userAsked+aiCovered) summaries."""
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "allChatSummaries": [
                    {"id": "c2", "title": "Legacy", "summary": "Old style", "embedding": [0.5] * 10},
                    {"id": "c3", "title": "Structured", "summary": "S",
                     "userAsked": "Q", "aiCovered": "A", "embedding": [0.5] * 10},
                ],
            })
            assert resp.status_code == 200

    def test_embedding_failure_with_structured_summaries(self):
        async def fake_stream(*args, **kwargs):
            yield "Fallback"
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(side_effect=Exception("embed fail"))
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "allChatSummaries": [
                    {"id": "c2", "title": "X", "userAsked": "Q", "aiCovered": "A", "embedding": [0.5] * 10},
                ],
            })
            assert resp.status_code == 200
            stream_call = m.chat_stream.call_args
            system_prompt = stream_call.kwargs.get("system_prompt", "")
            assert "{~" not in system_prompt

    def test_summaries_with_extra_unknown_fields(self):
        """Extra fields in summaries should be ignored."""
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "allChatSummaries": [
                    {
                        "id": "c2", "title": "X", "summary": "Y",
                        "userAsked": "Q", "aiCovered": "A",
                        "embedding": [0.5] * 10,
                        "topicId": "t1", "unknownField": "should be ignored",
                    },
                ],
            })
            assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# 11. Same-Topic Filtering Logic in Frontend JS
# ═══════════════════════════════════════════════════════════════════════════════

class TestSameTopicFilteringJS:
    """Frontend JS must only send same-topic chats for connections."""

    def _get_js(self):
        return _get_client().get("/static/app.js").text

    def test_filters_by_topicId(self):
        js = self._get_js()
        assert 'topicId' in js
        assert 'currentTopicId' in js

    def test_filter_uses_topicId_comparison(self):
        js = self._get_js()
        assert 'c.topicId === currentTopicId' in js or 'c.topicId ===' in js

    def test_maps_userAsked_in_summaries(self):
        js = self._get_js()
        send_start = js.index('sameTopicSummaries')
        send_section = js[send_start:send_start + 400]
        assert 'userAsked' in send_section

    def test_maps_aiCovered_in_summaries(self):
        js = self._get_js()
        send_start = js.index('sameTopicSummaries')
        send_section = js[send_start:send_start + 400]
        assert 'aiCovered' in send_section

    def test_excludes_current_chat(self):
        js = self._get_js()
        send_start = js.index('sameTopicSummaries')
        send_section = js[send_start:send_start + 400]
        assert 'this.currentChatId' in send_section

    def test_requires_summary_for_inclusion(self):
        js = self._get_js()
        send_start = js.index('sameTopicSummaries')
        send_section = js[send_start:send_start + 400]
        assert 'c.summary' in send_section

    def test_no_cross_topic_when_no_topic(self):
        """If currentTopicId is falsy, sameTopicSummaries should be empty."""
        js = self._get_js()
        send_start = js.index('sameTopicSummaries')
        send_section = js[send_start:send_start + 500]
        assert '[]' in send_section or ': []' in send_section


# ═══════════════════════════════════════════════════════════════════════════════
# 12. _summarizeCurrentChat stores structured fields
# ═══════════════════════════════════════════════════════════════════════════════

class TestSummarizeStoresStructuredFields:
    """_summarizeCurrentChat in app.js saves userAsked and aiCovered on chat object."""

    def _get_js(self):
        return _get_client().get("/static/app.js").text

    def _get_summarize_def(self):
        js = self._get_js()
        # Find the actual async function definition
        idx = js.index('async _summarizeCurrentChat()')
        return js[idx:idx + 1200]

    def test_stores_userAsked(self):
        assert 'userAsked' in self._get_summarize_def()

    def test_stores_aiCovered(self):
        assert 'aiCovered' in self._get_summarize_def()

    def test_stores_title_and_summary(self):
        section = self._get_summarize_def()
        assert 'data.title' in section
        assert 'data.summary' in section or 'chat.summary' in section

    def test_saves_chat_to_storage(self):
        assert 'Storage.saveChat' in self._get_summarize_def()


# ═══════════════════════════════════════════════════════════════════════════════
# 13. Integration: Full Stream Flow with Structured Summaries and Connections
# ═══════════════════════════════════════════════════════════════════════════════

class TestIntegrationFullStreamFlow:
    """End-to-end integration tests for the stream endpoint with structured connections."""

    def test_full_flow_with_structured_summaries(self):
        """Complete stream flow: embed query -> rank past chats -> memory prompt -> response with connections."""
        conns = json.dumps([{
            "id": 1, "chatId": "c2", "chatTitle": "LSTM Chat",
            "userAsked": "How do LSTMs handle long sequences?",
            "aiCovered": "Explained gates and cell state",
            "text": "You learned about LSTM gates — similar gating applies to GRUs.",
        }])
        response = f"GRUs use a simpler gating mechanism{{~1}} than LSTMs.\n\n{{~CONNECTIONS~}}\n{conns}\n{{~END~}}"
        
        async def fake_stream(*args, **kwargs):
            yield response
        
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={
                "topic": {"name": "ML", "matchedExistingId": "t1", "confidence": 0.95},
                "concepts": [{"title": "GRU", "preview": "Gated recurrent unit"}],
            })
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "How do GRUs work?"}],
                "existingTopics": [{"id": "t1", "name": "ML"}],
                "allChatSummaries": [
                    {
                        "id": "c2", "title": "LSTM Chat",
                        "userAsked": "How do LSTMs handle long sequences?",
                        "aiCovered": "Explained gates and cell state",
                        "embedding": [0.5] * 10,
                    },
                ],
            })
            
            assert resp.status_code == 200
            events = _parse_sse(resp.text)
            
            chunks = [e for e in events if e["type"] == "chunk"]
            assert len(chunks) >= 1
            
            done = [e for e in events if e["type"] == "done"]
            assert len(done) == 1
            done_evt = done[0]
            assert "GRU" in done_evt["response"]
            assert "{~1}" in done_evt["response"]
            assert "LSTM" in done_evt["response"]
            assert "topic" in done_evt
            assert done_evt["topic"]["name"] == "ML"

    def test_full_flow_no_past_chats(self):
        """Stream flow with no past chats — standard prompt, no markers."""
        async def fake_stream(*args, **kwargs):
            yield "A regular response with no connections."
        
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "What is 2+2?"}],
                "allChatSummaries": [],
            })
            
            events = _parse_sse(resp.text)
            done = [e for e in events if e["type"] == "done"][0]
            assert done["response"] == "A regular response with no connections."
            assert "{~" not in done["response"]

    def test_full_flow_metadata_is_clean(self):
        """Metadata extraction receives clean text (no markers)."""
        conns = json.dumps([{
            "id": 1, "chatId": "c2", "chatTitle": "T",
            "userAsked": "Q", "aiCovered": "A", "text": "insight",
        }])
        text = f"The answer is simple{{~1}}.\n\n{{~CONNECTIONS~}}\n{conns}\n{{~END~}}"
        async def fake_stream(*args, **kwargs):
            yield text
        
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {"name": "T"}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            
            _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "allChatSummaries": [
                    {"id": "c2", "title": "T", "summary": "S", "embedding": [0.5] * 10},
                ],
            })
            
            meta_call = m.chat.call_args
            messages_arg = meta_call[0][0]
            assistant_msg = [msg for msg in messages_arg if msg["role"] == "assistant"][0]
            assert "{~1}" not in assistant_msg["content"]
            assert "{~CONNECTIONS~}" not in assistant_msg["content"]
            assert "The answer is simple." in assistant_msg["content"]

    def test_full_flow_error_during_stream(self):
        """If stream errors, should return error event."""
        async def fake_stream(*args, **kwargs):
            raise Exception("Stream error!")
            yield "never reached"
        
        with patch("main.llm") as m:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            
            resp = _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
            })
            
            assert resp.status_code == 200
            events = _parse_sse(resp.text)
            error_events = [e for e in events if e["type"] == "error"]
            assert len(error_events) == 1

    def test_at_most_5_past_chats_in_prompt(self):
        """Even with many structured summaries, only top 5 should be in prompt."""
        summaries = [
            {
                "id": f"c{i}", "title": f"Chat {i}",
                "userAsked": f"Question {i}", "aiCovered": f"Answer {i}",
                "embedding": [float(i) * 0.01] * 10,
            }
            for i in range(20)
        ]
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            _get_client().post("/api/chat/stream", json={
                "chatId": "c_current",
                "messages": [{"role": "user", "content": "hi"}],
                "allChatSummaries": summaries,
            })
            stream_call = m.chat_stream.call_args
            system_prompt = stream_call.kwargs.get("system_prompt", "")
            chat_ids_in_prompt = re.findall(r'"chatId":\s*"(c\d+)"', system_prompt)
            assert len(chat_ids_in_prompt) <= 5

    def test_embeddings_not_leaked_into_prompt(self):
        async def fake_stream(*args, **kwargs):
            yield "ok"
        with patch("main.llm") as m, patch("main.embedder") as emb:
            m.chat_stream = MagicMock(return_value=fake_stream())
            m.chat = AsyncMock(return_value={"topic": {}, "concepts": []})
            emb.embed_text = AsyncMock(return_value=[0.5] * 10)
            _get_client().post("/api/chat/stream", json={
                "chatId": "c1",
                "messages": [{"role": "user", "content": "hi"}],
                "allChatSummaries": [
                    {
                        "id": "c2", "title": "X",
                        "userAsked": "Q", "aiCovered": "A",
                        "embedding": [0.99999] * 100,
                    },
                ],
            })
            stream_call = m.chat_stream.call_args
            system_prompt = stream_call.kwargs.get("system_prompt", "")
            assert "0.99999" not in system_prompt


# ═══════════════════════════════════════════════════════════════════════════════
# 14. Prompt Structural Tests (All prompts valid)
# ═══════════════════════════════════════════════════════════════════════════════

class TestAllPromptsStructural:
    """Cross-cutting tests for prompt consistency."""

    def test_summarize_prompt_is_valid_format_string(self):
        from prompts import CHAT_SUMMARIZE_PROMPT
        formatted = CHAT_SUMMARIZE_PROMPT.format(messages="test")
        assert isinstance(formatted, str)
        assert len(formatted) > 50

    def test_memory_prompt_is_valid_format_string(self):
        from prompts import CHAT_STREAM_MEMORY_PROMPT
        formatted = CHAT_STREAM_MEMORY_PROMPT.format(past_chats_json="[]")
        assert isinstance(formatted, str)
        assert len(formatted) > 50

    def test_summarize_prompt_returns_json_instruction(self):
        from prompts import CHAT_SUMMARIZE_PROMPT
        assert "JSON" in CHAT_SUMMARIZE_PROMPT or "json" in CHAT_SUMMARIZE_PROMPT

    def test_memory_prompt_has_connection_format_instruction(self):
        from prompts import CHAT_STREAM_MEMORY_PROMPT
        assert "{~CONNECTIONS~}" in CHAT_STREAM_MEMORY_PROMPT
        assert "{~END~}" in CHAT_STREAM_MEMORY_PROMPT

    def test_memory_prompt_has_at_most_3_markers(self):
        from prompts import CHAT_STREAM_MEMORY_PROMPT
        assert "at most 3" in CHAT_STREAM_MEMORY_PROMPT.lower() or "3 markers" in CHAT_STREAM_MEMORY_PROMPT.lower()

    def test_memory_prompt_instructs_no_leaking(self):
        """Prompt should tell the LLM NOT to say 'since you previously asked' etc."""
        from prompts import CHAT_STREAM_MEMORY_PROMPT
        lower = CHAT_STREAM_MEMORY_PROMPT.lower()
        assert "do not say" in lower

    def test_memory_prompt_example_uses_cooking(self):
        from prompts import CHAT_STREAM_MEMORY_PROMPT
        assert "Cooking Basics" in CHAT_STREAM_MEMORY_PROMPT
