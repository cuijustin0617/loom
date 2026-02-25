"""Unified LLM interface supporting OpenAI and Google Gemini."""

import os
import json
import re
import base64
from typing import Optional, AsyncGenerator


def _extract_json(text: str) -> dict:
    """Extract JSON from LLM response text, handling markdown code fences."""
    if not text or not text.strip():
        raise ValueError("Empty response from LLM")
    text = text.strip()
    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        json_match = re.search(r"\{.*\}", text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass
        raise ValueError(f"Could not extract JSON from: {text[:200]}")


_FALLBACK = {"response": "", "topic": {"name": "", "matchedExistingId": None, "confidence": 0}, "concepts": []}


def _fallback_response(raw: str) -> dict:
    """Build a graceful fallback when full JSON parsing fails."""
    m = re.search(r'"response"\s*:\s*"((?:[^"\\]|\\.)*)"', raw, re.DOTALL)
    text = m.group(1).replace("\\n", "\n").replace('\\"', '"') if m else raw
    return {**_FALLBACK, "response": text}


DEFAULT_MODEL = "gemini-2.5-flash"


def _route_provider(model: str) -> str:
    """Determine 'openai' or 'gemini' from model name."""
    if model.startswith("gpt-"):
        return "openai"
    return "gemini"


def _build_gemini_contents(messages, attachments=None):
    """Build Gemini-style contents list from messages."""
    from google.genai import types

    contents = []
    for i, msg in enumerate(messages):
        role = "user" if msg["role"] == "user" else "model"
        parts = [types.Part.from_text(text=msg["content"])]

        if attachments and i == len(messages) - 1 and role == "user":
            for att in attachments:
                raw_bytes = base64.b64decode(att["data"])
                parts.append(types.Part.from_bytes(
                    data=raw_bytes,
                    mime_type=att.get("mimeType", "image/jpeg"),
                ))
        contents.append(types.Content(role=role, parts=parts))
    return contents


def _build_gemini_config(system_prompt, model, json_mode=False, use_search=False):
    """Build Gemini GenerateContentConfig."""
    from google.genai import types

    config_kwargs = {"system_instruction": system_prompt}
    if json_mode:
        config_kwargs["response_mime_type"] = "application/json"
    if "gemini-3" in model:
        config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=1024)
    tools = []
    if use_search:
        tools.append(types.Tool(google_search=types.GoogleSearch()))
    if tools:
        config_kwargs["tools"] = tools
    return types.GenerateContentConfig(**config_kwargs)


def _build_openai_messages(messages, system_prompt, attachments=None):
    """Build OpenAI-style messages list."""
    full_messages = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        if msg["role"] == "user" and attachments and msg is messages[-1]:
            content_parts = [{"type": "text", "text": msg["content"]}]
            for att in attachments:
                if att.get("mimeType", "").startswith("image/"):
                    content_parts.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:{att['mimeType']};base64,{att['data']}"},
                    })
            full_messages.append({"role": msg["role"], "content": content_parts})
        else:
            full_messages.append({"role": msg["role"], "content": msg["content"]})
    return full_messages


class LLMRouter:
    def __init__(self, provider: Optional[str] = None):
        self.provider = provider or os.getenv("LLM_PROVIDER", "gemini")

    def _resolve_provider(self, model: str) -> str:
        if model.startswith("gpt-"):
            return "openai"
        if model.startswith("gemini-"):
            return "gemini"
        if self.provider in ("openai", "gemini"):
            return self.provider
        return self.provider  # will raise in caller if not openai/gemini

    # ── Non-streaming chat (existing) ─────────────────────────────────────

    async def chat(
        self,
        messages: list[dict],
        system_prompt: str,
        json_mode: bool = True,
        model: Optional[str] = None,
        attachments: Optional[list[dict]] = None,
        use_search: bool = False,
    ) -> dict:
        model = model or DEFAULT_MODEL
        provider = self._resolve_provider(model)
        if provider == "openai":
            return await self._openai_chat(messages, system_prompt, json_mode, model, attachments)
        elif provider == "gemini":
            return await self._gemini_chat(messages, system_prompt, json_mode, model, attachments, use_search)
        else:
            raise ValueError(f"Cannot route model: {model}")

    async def _openai_chat(
        self, messages: list[dict], system_prompt: str, json_mode: bool,
        model: str = "gpt-5-mini-2025-08-07",
        attachments: Optional[list[dict]] = None,
    ) -> dict:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        full_messages = _build_openai_messages(messages, system_prompt, attachments)

        kwargs = {"model": model, "messages": full_messages, "temperature": 0.7}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        response = await client.chat.completions.create(**kwargs)
        content = response.choices[0].message.content or ""
        if json_mode:
            try:
                return _extract_json(content)
            except (ValueError, json.JSONDecodeError):
                return _fallback_response(content)
        return {"response": content}

    async def _gemini_chat(
        self, messages: list[dict], system_prompt: str, json_mode: bool,
        model: str = "gemini-2.5-flash",
        attachments: Optional[list[dict]] = None,
        use_search: bool = False,
    ) -> dict:
        from google import genai

        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        contents = _build_gemini_contents(messages, attachments)
        config = _build_gemini_config(system_prompt, model, json_mode, use_search)

        response = await client.aio.models.generate_content(
            model=model, contents=contents, config=config,
        )
        content = response.text or ""
        if json_mode:
            try:
                return _extract_json(content)
            except (ValueError, json.JSONDecodeError):
                return _fallback_response(content)
        return {"response": content}

    # ── Streaming chat ────────────────────────────────────────────────────

    async def chat_stream(
        self,
        messages: list[dict],
        system_prompt: str,
        model: Optional[str] = None,
        attachments: Optional[list[dict]] = None,
        use_search: bool = False,
    ) -> AsyncGenerator[str, None]:
        """Async generator yielding text chunks (plain text, no JSON mode)."""
        model = model or DEFAULT_MODEL
        provider = self._resolve_provider(model)
        if provider == "openai":
            async for chunk in self._openai_stream(messages, system_prompt, model, attachments):
                yield chunk
        elif provider == "gemini":
            async for chunk in self._gemini_stream(messages, system_prompt, model, attachments, use_search):
                yield chunk
        else:
            raise ValueError(f"Cannot route model for streaming: {model}")

    async def _gemini_stream(
        self, messages: list[dict], system_prompt: str,
        model: str = "gemini-2.5-flash",
        attachments: Optional[list[dict]] = None,
        use_search: bool = False,
    ) -> AsyncGenerator[str, None]:
        from google import genai

        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        contents = _build_gemini_contents(messages, attachments)
        config = _build_gemini_config(system_prompt, model, json_mode=False, use_search=use_search)

        async for chunk in await client.aio.models.generate_content_stream(
            model=model, contents=contents, config=config,
        ):
            if chunk.text:
                yield chunk.text

    async def _openai_stream(
        self, messages: list[dict], system_prompt: str,
        model: str = "gpt-5-mini-2025-08-07",
        attachments: Optional[list[dict]] = None,
    ) -> AsyncGenerator[str, None]:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        full_messages = _build_openai_messages(messages, system_prompt, attachments)

        response = await client.chat.completions.create(
            model=model, messages=full_messages, temperature=0.7, stream=True,
        )
        async for chunk in response:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                yield delta.content
