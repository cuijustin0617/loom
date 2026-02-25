"""Comprehensive tests for llm_router.py – JSON extraction and LLM routing."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from llm_router import LLMRouter, _extract_json, DEFAULT_MODEL


# ── Helper to build Gemini mock ──────────────────────────────────────────────

def _gemini_mock(text='{"ok": true}'):
    """Return (mock_client_class, mock_client_instance) for google.genai.Client."""
    mock_resp = MagicMock()
    mock_resp.text = text
    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(return_value=mock_resp)
    return mock_client


def _openai_mock(content='{"ok": true}'):
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = content
    return mock_response


# ── _extract_json ─────────────────────────────────────────────────────────────

class TestExtractJson:
    def test_plain_json(self):
        assert _extract_json('{"key": "value"}') == {"key": "value"}

    def test_json_with_code_fence(self):
        assert _extract_json('```json\n{"key": "value"}\n```') == {"key": "value"}

    def test_json_with_plain_fence(self):
        assert _extract_json('```\n{"key": "value"}\n```') == {"key": "value"}

    def test_json_embedded_in_text(self):
        assert _extract_json('Result:\n{"key": "value"}\nDone.') == {"key": "value"}

    def test_nested_json(self):
        result = _extract_json('{"outer": {"inner": [1, 2, 3]}}')
        assert result["outer"]["inner"] == [1, 2, 3]

    def test_json_with_whitespace(self):
        assert _extract_json('  \n  {"key": "value"}  \n  ') == {"key": "value"}

    def test_invalid_json_raises(self):
        with pytest.raises(ValueError, match="Could not extract JSON"):
            _extract_json("not json at all")

    def test_empty_string_raises(self):
        with pytest.raises(ValueError):
            _extract_json("")

    def test_json_with_newlines_in_values(self):
        result = _extract_json('{"key": "line1\\nline2"}')
        assert "line1" in result["key"]

    def test_json_with_unicode(self):
        assert _extract_json('{"word": "你好"}') == {"word": "你好"}

    def test_json_with_special_chars(self):
        result = _extract_json('{"text": "he said \\"hello\\""}')
        assert "hello" in result["text"]

    def test_complex_response_format(self):
        text = '''```json
{
  "response": "The vanishing gradient problem...",
  "topic": {"name": "Machine Learning", "matchedExistingId": null, "confidence": 0.95},
  "concepts": [{"title": "Vanishing Gradients", "preview": "Why deep networks struggle"}]
}
```'''
        result = _extract_json(text)
        assert result["topic"]["name"] == "Machine Learning"
        assert len(result["concepts"]) == 1

    def test_json_with_null_values(self):
        result = _extract_json('{"key": null, "other": "val"}')
        assert result["key"] is None
        assert result["other"] == "val"

    def test_json_with_boolean_values(self):
        result = _extract_json('{"truthy": true, "falsy": false}')
        assert result["truthy"] is True
        assert result["falsy"] is False

    def test_json_with_numbers(self):
        result = _extract_json('{"int": 42, "float": 3.14, "neg": -1}')
        assert result["int"] == 42
        assert result["float"] == pytest.approx(3.14)
        assert result["neg"] == -1

    def test_empty_json_object(self):
        assert _extract_json("{}") == {}

    def test_json_with_array_values(self):
        result = _extract_json('{"items": [1, "two", 3.0, null, true]}')
        assert len(result["items"]) == 5

    def test_deeply_nested_json(self):
        text = '{"a": {"b": {"c": {"d": "deep"}}}}'
        assert _extract_json(text)["a"]["b"]["c"]["d"] == "deep"

    def test_json_surrounded_by_markdown(self):
        text = "Here is the output:\n\n```json\n{\"result\": \"ok\"}\n```\n\nEnd."
        assert _extract_json(text) == {"result": "ok"}

    def test_json_with_trailing_text(self):
        text = 'Here is the JSON: {"first": 1}'
        result = _extract_json(text)
        assert result["first"] == 1

    def test_json_with_escaped_newlines_in_content(self):
        text = '{"text": "Hello\\nWorld"}'
        result = _extract_json(text)
        assert "Hello" in result["text"]

    def test_json_with_empty_string_values(self):
        result = _extract_json('{"key": "", "other": ""}')
        assert result["key"] == ""

    def test_whitespace_only_raises(self):
        with pytest.raises(ValueError):
            _extract_json("   \n\t  ")

    def test_just_a_number_raises(self):
        with pytest.raises((ValueError, TypeError)):
            result = _extract_json("42")
            if not isinstance(result, dict):
                raise TypeError("Not a dict")


# ── LLMRouter init ────────────────────────────────────────────────────────────

class TestLLMRouterInit:
    def test_default_provider(self):
        import os
        os.environ.pop("LLM_PROVIDER", None)
        assert LLMRouter().provider == "gemini"

    def test_custom_provider(self):
        assert LLMRouter(provider="gemini").provider == "gemini"

    def test_env_provider(self):
        import os
        os.environ["LLM_PROVIDER"] = "openai"
        assert LLMRouter().provider == "openai"
        os.environ.pop("LLM_PROVIDER", None)

    @pytest.mark.asyncio
    async def test_unknown_model_with_unknown_provider_raises(self):
        router = LLMRouter(provider="unknown_llm")
        with pytest.raises(ValueError, match="Cannot route model"):
            await router.chat([], "system prompt", model="unknown-model")

    def test_provider_stored(self):
        router = LLMRouter(provider="openai")
        assert router.provider == "openai"

    def test_default_model_constant(self):
        assert DEFAULT_MODEL == "gemini-2.5-flash"


# ── LLMRouter.chat with mocked OpenAI ─────────────────────────────────────────

class TestLLMRouterOpenAI:
    @pytest.mark.asyncio
    async def test_json_mode(self):
        router = LLMRouter(provider="openai")
        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            instance.chat.completions.create = AsyncMock(return_value=_openai_mock('{"response": "hello"}'))
            result = await router.chat([{"role": "user", "content": "hi"}], "sys", json_mode=True, model="gpt-5-mini-2025-08-07")
            assert result == {"response": "hello"}

    @pytest.mark.asyncio
    async def test_non_json_mode(self):
        router = LLMRouter(provider="openai")
        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            instance.chat.completions.create = AsyncMock(return_value=_openai_mock("plain text"))
            result = await router.chat([{"role": "user", "content": "hi"}], "sys", json_mode=False, model="gpt-5-mini-2025-08-07")
            assert result == {"response": "plain text"}

    @pytest.mark.asyncio
    async def test_system_prompt_prepended(self):
        router = LLMRouter(provider="openai")
        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            mock_create = AsyncMock(return_value=_openai_mock('{"ok": true}'))
            instance.chat.completions.create = mock_create
            await router.chat([{"role": "user", "content": "test"}], "MY_SYSTEM", model="gpt-5-mini-2025-08-07")
            messages = mock_create.call_args.kwargs.get("messages", mock_create.call_args[1].get("messages", []))
            assert messages[0]["role"] == "system"
            assert messages[0]["content"] == "MY_SYSTEM"

    @pytest.mark.asyncio
    async def test_json_mode_sets_response_format(self):
        router = LLMRouter(provider="openai")
        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            mock_create = AsyncMock(return_value=_openai_mock('{"ok": true}'))
            instance.chat.completions.create = mock_create
            await router.chat([{"role": "user", "content": "test"}], "sys", json_mode=True, model="gpt-5-mini-2025-08-07")
            kwargs = mock_create.call_args.kwargs or mock_create.call_args[1]
            assert kwargs.get("response_format") == {"type": "json_object"}

    @pytest.mark.asyncio
    async def test_non_json_mode_no_response_format(self):
        router = LLMRouter(provider="openai")
        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            mock_create = AsyncMock(return_value=_openai_mock("text"))
            instance.chat.completions.create = mock_create
            await router.chat([{"role": "user", "content": "test"}], "sys", json_mode=False, model="gpt-5-mini-2025-08-07")
            kwargs = mock_create.call_args.kwargs or mock_create.call_args[1]
            assert "response_format" not in kwargs

    @pytest.mark.asyncio
    async def test_multiple_messages_passed(self):
        router = LLMRouter(provider="openai")
        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            mock_create = AsyncMock(return_value=_openai_mock('{"ok": true}'))
            instance.chat.completions.create = mock_create
            msgs = [{"role": "user", "content": "q1"}, {"role": "assistant", "content": "a1"}, {"role": "user", "content": "q2"}]
            await router.chat(msgs, "sys", model="gpt-5-mini-2025-08-07")
            messages = mock_create.call_args.kwargs.get("messages", mock_create.call_args[1].get("messages", []))
            assert len(messages) == 4

    @pytest.mark.asyncio
    async def test_uses_specified_model(self):
        router = LLMRouter(provider="openai")
        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            mock_create = AsyncMock(return_value=_openai_mock('{"ok": true}'))
            instance.chat.completions.create = mock_create
            await router.chat([{"role": "user", "content": "test"}], "sys", model="gpt-5.2-2025-12-11")
            kwargs = mock_create.call_args.kwargs or mock_create.call_args[1]
            assert kwargs.get("model") == "gpt-5.2-2025-12-11"

    @pytest.mark.asyncio
    async def test_openai_with_image_attachment(self):
        """Image attachments should be passed as image_url content parts."""
        router = LLMRouter(provider="openai")
        import base64
        b64_data = base64.b64encode(b"fake-image-bytes").decode()
        attachments = [{"mimeType": "image/jpeg", "data": b64_data}]
        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            mock_create = AsyncMock(return_value=_openai_mock('{"ok": true}'))
            instance.chat.completions.create = mock_create
            await router.chat(
                [{"role": "user", "content": "What is this?"}],
                "sys", model="gpt-5-mini-2025-08-07",
                attachments=attachments,
            )
            messages = mock_create.call_args.kwargs.get("messages", [])
            last_user = messages[-1]
            assert isinstance(last_user["content"], list)
            assert last_user["content"][0]["type"] == "text"
            assert last_user["content"][1]["type"] == "image_url"

    @pytest.mark.asyncio
    async def test_openai_no_attachments_plain_content(self):
        """Without attachments, message content should be plain string."""
        router = LLMRouter(provider="openai")
        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            mock_create = AsyncMock(return_value=_openai_mock('{"ok": true}'))
            instance.chat.completions.create = mock_create
            await router.chat(
                [{"role": "user", "content": "hi"}],
                "sys", model="gpt-5-mini-2025-08-07",
                attachments=None,
            )
            messages = mock_create.call_args.kwargs.get("messages", [])
            assert isinstance(messages[-1]["content"], str)


# ── LLMRouter.chat with mocked Gemini (new SDK) ──────────────────────────────

class TestLLMRouterGemini:
    @pytest.mark.asyncio
    async def test_json_mode(self):
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"response": "hello from gemini"}')
        with patch("google.genai.Client", return_value=mock_client):
            result = await router.chat([{"role": "user", "content": "hi"}], "sys", json_mode=True)
            assert result == {"response": "hello from gemini"}

    @pytest.mark.asyncio
    async def test_non_json_mode(self):
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock("plain gemini text")
        with patch("google.genai.Client", return_value=mock_client):
            result = await router.chat([{"role": "user", "content": "hi"}], "sys", json_mode=False)
            assert result == {"response": "plain gemini text"}

    @pytest.mark.asyncio
    async def test_multi_turn_history(self):
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            msgs = [
                {"role": "user", "content": "q1"},
                {"role": "assistant", "content": "a1"},
                {"role": "user", "content": "q2"},
            ]
            await router.chat(msgs, "sys")
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            contents = call_kwargs.get("contents", [])
            assert len(contents) == 3

    @pytest.mark.asyncio
    async def test_fenced_json_response(self):
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('```json\n{"result": "fenced"}\n```')
        with patch("google.genai.Client", return_value=mock_client):
            result = await router.chat([{"role": "user", "content": "hi"}], "sys", json_mode=True)
            assert result == {"result": "fenced"}

    @pytest.mark.asyncio
    async def test_model_passed_to_generate_content(self):
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "sys", model="gemini-3-flash-preview")
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            assert call_kwargs["model"] == "gemini-3-flash-preview"

    @pytest.mark.asyncio
    async def test_system_instruction_in_config(self):
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "MY_SYSTEM")
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            config = call_kwargs["config"]
            assert config.system_instruction == "MY_SYSTEM"

    @pytest.mark.asyncio
    async def test_json_mode_sets_response_mime_type(self):
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "sys", json_mode=True)
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            config = call_kwargs["config"]
            assert config.response_mime_type == "application/json"

    @pytest.mark.asyncio
    async def test_non_json_mode_no_mime_type(self):
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock("text")
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "sys", json_mode=False)
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            config = call_kwargs["config"]
            assert config.response_mime_type is None

    @pytest.mark.asyncio
    async def test_gemini3_has_thinking_config(self):
        """Gemini 3 models should get thinking_budget=1024."""
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "sys", model="gemini-3-flash-preview")
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            config = call_kwargs["config"]
            assert config.thinking_config is not None
            assert config.thinking_config.thinking_budget == 1024

    @pytest.mark.asyncio
    async def test_gemini25_no_thinking_config(self):
        """Gemini 2.5 models should NOT get thinking config."""
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "sys", model="gemini-2.5-flash")
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            config = call_kwargs["config"]
            assert config.thinking_config is None

    @pytest.mark.asyncio
    async def test_gemini31_pro_has_thinking_config(self):
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "sys", model="gemini-3.1-pro-preview")
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            config = call_kwargs["config"]
            assert config.thinking_config is not None


# ── Google Search grounding ───────────────────────────────────────────────────

class TestGeminiSearchGrounding:
    @pytest.mark.asyncio
    async def test_use_search_adds_tool(self):
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"response": "searched"}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat(
                [{"role": "user", "content": "hi"}], "sys",
                model="gemini-2.5-flash", use_search=True,
            )
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            config = call_kwargs["config"]
            assert config.tools is not None
            assert len(config.tools) == 1

    @pytest.mark.asyncio
    async def test_no_search_no_tools(self):
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat(
                [{"role": "user", "content": "hi"}], "sys",
                model="gemini-2.5-flash", use_search=False,
            )
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            config = call_kwargs["config"]
            assert config.tools is None or len(config.tools) == 0

    @pytest.mark.asyncio
    async def test_search_grounding_default_off(self):
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "sys")
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            config = call_kwargs["config"]
            assert not getattr(config, 'tools', None)


# ── Attachment / multimodal ───────────────────────────────────────────────────

class TestGeminiAttachments:
    @pytest.mark.asyncio
    async def test_image_attachment_added_to_contents(self):
        import base64
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"ok": true}')
        b64 = base64.b64encode(b"image-bytes").decode()
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat(
                [{"role": "user", "content": "What is this?"}], "sys",
                model="gemini-2.5-flash",
                attachments=[{"mimeType": "image/jpeg", "data": b64}],
            )
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            contents = call_kwargs["contents"]
            last_content = contents[-1]
            assert len(last_content.parts) == 2  # text + image

    @pytest.mark.asyncio
    async def test_no_attachments_single_text_part(self):
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "sys")
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            contents = call_kwargs["contents"]
            assert len(contents[-1].parts) == 1

    @pytest.mark.asyncio
    async def test_multiple_attachments(self):
        import base64
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"ok": true}')
        attachments = [
            {"mimeType": "image/png", "data": base64.b64encode(b"img1").decode()},
            {"mimeType": "image/jpeg", "data": base64.b64encode(b"img2").decode()},
        ]
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat(
                [{"role": "user", "content": "Describe these."}], "sys",
                attachments=attachments,
            )
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            contents = call_kwargs["contents"]
            assert len(contents[-1].parts) == 3  # text + 2 images

    @pytest.mark.asyncio
    async def test_attachment_only_on_last_message(self):
        """Attachments should only be added to the last user message."""
        import base64
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"ok": true}')
        b64 = base64.b64encode(b"img").decode()
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat(
                [
                    {"role": "user", "content": "q1"},
                    {"role": "assistant", "content": "a1"},
                    {"role": "user", "content": "q2"},
                ],
                "sys",
                attachments=[{"mimeType": "image/jpeg", "data": b64}],
            )
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            contents = call_kwargs["contents"]
            assert len(contents[0].parts) == 1  # first message: text only
            assert len(contents[2].parts) == 2  # last message: text + image


# ── Model-based routing ────────────────────────────────────────────────────────

class TestModelRouting:
    @pytest.mark.asyncio
    async def test_gpt_prefix_routes_to_openai(self):
        router = LLMRouter(provider="gemini")
        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            instance.chat.completions.create = AsyncMock(return_value=_openai_mock('{"response": "from openai"}'))
            result = await router.chat([{"role": "user", "content": "hi"}], "sys", model="gpt-5-mini-2025-08-07")
            assert result == {"response": "from openai"}

    @pytest.mark.asyncio
    async def test_gemini_prefix_routes_to_gemini(self):
        router = LLMRouter(provider="openai")
        mock_client = _gemini_mock('{"response": "from gemini"}')
        with patch("google.genai.Client", return_value=mock_client):
            result = await router.chat([{"role": "user", "content": "hi"}], "sys", model="gemini-3-flash-preview")
            assert result == {"response": "from gemini"}

    @pytest.mark.asyncio
    async def test_default_model_routes_to_gemini(self):
        router = LLMRouter(provider="openai")
        mock_client = _gemini_mock('{"response": "default"}')
        with patch("google.genai.Client", return_value=mock_client):
            result = await router.chat([{"role": "user", "content": "hi"}], "sys")
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            assert call_kwargs["model"] == "gemini-2.5-flash"

    @pytest.mark.asyncio
    async def test_gpt5_nano_routes_to_openai(self):
        router = LLMRouter(provider="gemini")
        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            mock_create = AsyncMock(return_value=_openai_mock('{"ok": true}'))
            instance.chat.completions.create = mock_create
            await router.chat([{"role": "user", "content": "hi"}], "sys", model="gpt-5-nano-2025-08-07")
            kwargs = mock_create.call_args.kwargs or mock_create.call_args[1]
            assert kwargs["model"] == "gpt-5-nano-2025-08-07"

    @pytest.mark.asyncio
    async def test_gpt52_routes_to_openai(self):
        router = LLMRouter(provider="gemini")
        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            mock_create = AsyncMock(return_value=_openai_mock('{"ok": true}'))
            instance.chat.completions.create = mock_create
            await router.chat([{"role": "user", "content": "hi"}], "sys", model="gpt-5.2-2025-12-11")
            kwargs = mock_create.call_args.kwargs or mock_create.call_args[1]
            assert kwargs["model"] == "gpt-5.2-2025-12-11"

    @pytest.mark.asyncio
    async def test_gemini_25_flash_lite_routes_to_gemini(self):
        router = LLMRouter()
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "sys", model="gemini-2.5-flash-lite")
            assert mock_client.aio.models.generate_content.call_args.kwargs["model"] == "gemini-2.5-flash-lite"

    @pytest.mark.asyncio
    async def test_gemini_3_flash_preview_model_name(self):
        router = LLMRouter()
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "sys", model="gemini-3-flash-preview")
            assert mock_client.aio.models.generate_content.call_args.kwargs["model"] == "gemini-3-flash-preview"

    @pytest.mark.asyncio
    async def test_gemini_31_pro_preview_model_name(self):
        router = LLMRouter()
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "sys", model="gemini-3.1-pro-preview")
            assert mock_client.aio.models.generate_content.call_args.kwargs["model"] == "gemini-3.1-pro-preview"

    @pytest.mark.asyncio
    async def test_provider_fallback_openai_for_unknown_prefix(self):
        router = LLMRouter(provider="openai")
        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            instance.chat.completions.create = AsyncMock(return_value=_openai_mock('{"response": "fallback"}'))
            result = await router.chat([{"role": "user", "content": "hi"}], "sys", model="custom-model-v1")
            assert result == {"response": "fallback"}

    @pytest.mark.asyncio
    async def test_provider_fallback_gemini_for_unknown_prefix(self):
        router = LLMRouter(provider="gemini")
        mock_client = _gemini_mock('{"response": "fallback gemini"}')
        with patch("google.genai.Client", return_value=mock_client):
            result = await router.chat([{"role": "user", "content": "hi"}], "sys", model="custom-model-v1")
            assert result == {"response": "fallback gemini"}

    @pytest.mark.asyncio
    async def test_none_model_uses_default(self):
        router = LLMRouter()
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "sys", model=None)
            assert mock_client.aio.models.generate_content.call_args.kwargs["model"] == "gemini-2.5-flash"


# ── New signature: attachments and use_search params ──────────────────────────

class TestChatSignature:
    @pytest.mark.asyncio
    async def test_attachments_default_none(self):
        router = LLMRouter()
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "sys")

    @pytest.mark.asyncio
    async def test_use_search_default_false(self):
        router = LLMRouter()
        mock_client = _gemini_mock('{"ok": true}')
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat([{"role": "user", "content": "hi"}], "sys")
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            config = call_kwargs["config"]
            assert not getattr(config, 'tools', None)

    @pytest.mark.asyncio
    async def test_all_params_together(self):
        import base64
        router = LLMRouter()
        mock_client = _gemini_mock('{"ok": true}')
        b64 = base64.b64encode(b"img").decode()
        with patch("google.genai.Client", return_value=mock_client):
            await router.chat(
                [{"role": "user", "content": "hi"}], "sys",
                json_mode=True, model="gemini-3-flash-preview",
                attachments=[{"mimeType": "image/png", "data": b64}],
                use_search=True,
            )
            call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
            assert call_kwargs["model"] == "gemini-3-flash-preview"
            config = call_kwargs["config"]
            assert config.response_mime_type == "application/json"
            assert config.thinking_config is not None
            assert len(config.tools) == 1
            assert len(call_kwargs["contents"][-1].parts) == 2


# ── Streaming: chat_stream ───────────────────────────────────────────────────

class TestGeminiStreaming:
    @pytest.mark.asyncio
    async def test_stream_yields_text_chunks(self):
        """chat_stream should yield text chunks from the Gemini streaming API."""
        router = LLMRouter(provider="gemini")

        chunk1 = MagicMock(); chunk1.text = "Hello"
        chunk2 = MagicMock(); chunk2.text = " world"

        async def fake_async_iter(*args, **kwargs):
            for c in [chunk1, chunk2]:
                yield c

        mock_client = MagicMock()
        mock_client.aio.models.generate_content_stream = AsyncMock(return_value=fake_async_iter())

        with patch("google.genai.Client", return_value=mock_client):
            chunks = []
            async for text in router.chat_stream(
                [{"role": "user", "content": "hi"}], "sys"
            ):
                chunks.append(text)
            assert chunks == ["Hello", " world"]

    @pytest.mark.asyncio
    async def test_stream_skips_empty_chunks(self):
        """Chunks with empty text should be skipped."""
        router = LLMRouter(provider="gemini")

        chunk1 = MagicMock(); chunk1.text = "Hello"
        chunk2 = MagicMock(); chunk2.text = ""
        chunk3 = MagicMock(); chunk3.text = None
        chunk4 = MagicMock(); chunk4.text = " end"

        async def fake_async_iter(*args, **kwargs):
            for c in [chunk1, chunk2, chunk3, chunk4]:
                yield c

        mock_client = MagicMock()
        mock_client.aio.models.generate_content_stream = AsyncMock(return_value=fake_async_iter())

        with patch("google.genai.Client", return_value=mock_client):
            chunks = []
            async for text in router.chat_stream(
                [{"role": "user", "content": "hi"}], "sys"
            ):
                chunks.append(text)
            assert chunks == ["Hello", " end"]

    @pytest.mark.asyncio
    async def test_stream_no_json_mode(self):
        """Streaming should not use JSON mode (no response_mime_type)."""
        router = LLMRouter(provider="gemini")

        async def fake_async_iter(*args, **kwargs):
            chunk = MagicMock(); chunk.text = "ok"
            yield chunk

        mock_client = MagicMock()
        mock_client.aio.models.generate_content_stream = AsyncMock(return_value=fake_async_iter())

        with patch("google.genai.Client", return_value=mock_client):
            async for _ in router.chat_stream(
                [{"role": "user", "content": "hi"}], "sys"
            ):
                pass
            call_kwargs = mock_client.aio.models.generate_content_stream.call_args.kwargs
            config = call_kwargs["config"]
            assert config.response_mime_type is None

    @pytest.mark.asyncio
    async def test_stream_passes_model(self):
        router = LLMRouter(provider="gemini")

        async def fake_async_iter(*args, **kwargs):
            chunk = MagicMock(); chunk.text = "ok"
            yield chunk

        mock_client = MagicMock()
        mock_client.aio.models.generate_content_stream = AsyncMock(return_value=fake_async_iter())

        with patch("google.genai.Client", return_value=mock_client):
            async for _ in router.chat_stream(
                [{"role": "user", "content": "hi"}], "sys",
                model="gemini-3-flash-preview",
            ):
                pass
            call_kwargs = mock_client.aio.models.generate_content_stream.call_args.kwargs
            assert call_kwargs["model"] == "gemini-3-flash-preview"

    @pytest.mark.asyncio
    async def test_stream_with_search(self):
        router = LLMRouter(provider="gemini")

        async def fake_async_iter(*args, **kwargs):
            chunk = MagicMock(); chunk.text = "ok"
            yield chunk

        mock_client = MagicMock()
        mock_client.aio.models.generate_content_stream = AsyncMock(return_value=fake_async_iter())

        with patch("google.genai.Client", return_value=mock_client):
            async for _ in router.chat_stream(
                [{"role": "user", "content": "hi"}], "sys",
                use_search=True,
            ):
                pass
            call_kwargs = mock_client.aio.models.generate_content_stream.call_args.kwargs
            config = call_kwargs["config"]
            assert config.tools is not None
            assert len(config.tools) == 1


class TestOpenAIStreaming:
    @pytest.mark.asyncio
    async def test_openai_stream_yields_chunks(self):
        router = LLMRouter(provider="openai")

        chunk1 = MagicMock()
        chunk1.choices = [MagicMock()]
        chunk1.choices[0].delta.content = "Hello"
        chunk2 = MagicMock()
        chunk2.choices = [MagicMock()]
        chunk2.choices[0].delta.content = " world"

        async def fake_async_iter():
            for c in [chunk1, chunk2]:
                yield c

        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            instance.chat.completions.create = AsyncMock(return_value=fake_async_iter())

            chunks = []
            async for text in router.chat_stream(
                [{"role": "user", "content": "hi"}], "sys",
                model="gpt-5-mini-2025-08-07",
            ):
                chunks.append(text)
            assert chunks == ["Hello", " world"]

    @pytest.mark.asyncio
    async def test_openai_stream_skips_empty_deltas(self):
        router = LLMRouter(provider="openai")

        chunk1 = MagicMock()
        chunk1.choices = [MagicMock()]
        chunk1.choices[0].delta.content = "A"
        chunk2 = MagicMock()
        chunk2.choices = [MagicMock()]
        chunk2.choices[0].delta.content = None
        chunk3 = MagicMock()
        chunk3.choices = []

        async def fake_async_iter():
            for c in [chunk1, chunk2, chunk3]:
                yield c

        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            instance.chat.completions.create = AsyncMock(return_value=fake_async_iter())

            chunks = []
            async for text in router.chat_stream(
                [{"role": "user", "content": "hi"}], "sys",
                model="gpt-5-mini-2025-08-07",
            ):
                chunks.append(text)
            assert chunks == ["A"]

    @pytest.mark.asyncio
    async def test_openai_stream_sets_stream_true(self):
        router = LLMRouter(provider="openai")

        async def fake_async_iter():
            c = MagicMock()
            c.choices = [MagicMock()]
            c.choices[0].delta.content = "ok"
            yield c

        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            mock_create = AsyncMock(return_value=fake_async_iter())
            instance.chat.completions.create = mock_create

            async for _ in router.chat_stream(
                [{"role": "user", "content": "hi"}], "sys",
                model="gpt-5-mini-2025-08-07",
            ):
                pass
            kwargs = mock_create.call_args.kwargs or mock_create.call_args[1]
            assert kwargs.get("stream") is True


class TestStreamRouting:
    @pytest.mark.asyncio
    async def test_gpt_model_routes_to_openai_stream(self):
        router = LLMRouter(provider="gemini")

        async def fake_async_iter():
            c = MagicMock()
            c.choices = [MagicMock()]
            c.choices[0].delta.content = "from openai"
            yield c

        with patch("openai.AsyncOpenAI") as MockClient:
            instance = MockClient.return_value
            instance.chat.completions.create = AsyncMock(return_value=fake_async_iter())

            chunks = []
            async for text in router.chat_stream(
                [{"role": "user", "content": "hi"}], "sys",
                model="gpt-5-mini-2025-08-07",
            ):
                chunks.append(text)
            assert chunks == ["from openai"]

    @pytest.mark.asyncio
    async def test_gemini_model_routes_to_gemini_stream(self):
        router = LLMRouter(provider="openai")

        async def fake_async_iter(*args, **kwargs):
            c = MagicMock(); c.text = "from gemini"
            yield c

        mock_client = MagicMock()
        mock_client.aio.models.generate_content_stream = AsyncMock(return_value=fake_async_iter())

        with patch("google.genai.Client", return_value=mock_client):
            chunks = []
            async for text in router.chat_stream(
                [{"role": "user", "content": "hi"}], "sys",
                model="gemini-3-flash-preview",
            ):
                chunks.append(text)
            assert chunks == ["from gemini"]

    @pytest.mark.asyncio
    async def test_default_model_uses_gemini_stream(self):
        router = LLMRouter()

        async def fake_async_iter(*args, **kwargs):
            c = MagicMock(); c.text = "default"
            yield c

        mock_client = MagicMock()
        mock_client.aio.models.generate_content_stream = AsyncMock(return_value=fake_async_iter())

        with patch("google.genai.Client", return_value=mock_client):
            chunks = []
            async for text in router.chat_stream(
                [{"role": "user", "content": "hi"}], "sys"
            ):
                chunks.append(text)
            assert chunks == ["default"]
