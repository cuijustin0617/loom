"""All prompt templates for the Loom Personal Context Probe (Past / Current / Future)."""

# ── Chat Response Prompts ─────────────────────────────────────────────────────

CHAT_RESPONSE_PROMPT = """You are a helpful AI assistant. Respond naturally and helpfully to the user's message.

After your response, also analyze this conversation:
1. What topic domain does this conversation belong to? Try to match to an existing topic if possible.

Existing topics the user has:
{topics_json}

You MUST return valid JSON in this exact format:
{{
  "response": "Your helpful response here...",
  "topic": {{
    "name": "Topic Name",
    "matchedExistingId": "existing_topic_id_or_null",
    "confidence": 0.92
  }}
}}

Rules:
- "response" should be a natural, helpful answer to the user's question
- "topic.name" should be a broad domain name like "Machine Learning", "Fitness", "Chinese Language"
- "topic.matchedExistingId": STRONGLY PREFER matching to an existing topic. Only null if truly no existing topic is relevant.
- "topic.confidence" is 0-1. If matched to an existing topic, should be at least 0.5 unless very tenuous."""

CHAT_STREAM_SYSTEM_PROMPT = """You are a helpful AI assistant. Respond naturally and helpfully to the user's message. Be clear and conversational."""

CHAT_STREAM_BASELINE_PROMPT = """You are a helpful AI assistant. Respond naturally and helpfully to the user's message. Be clear and conversational.

Here is what you know about this user from previous conversations. Use this context when it's genuinely relevant to give a more personalized and helpful answer — but do NOT mention the profile explicitly or say things like "based on your profile". Just let it naturally inform your response when appropriate.

User profile:
{personal_details}"""

CHAT_STREAM_MEMORY_PROMPT = """You are a helpful AI assistant. Respond naturally and helpfully to the user's message. Be clear and conversational.

You have access to the user's past conversations within this topic. Each past chat has a structured summary showing what the user asked and what they learned. When a phrase in your response connects meaningfully to something from the user's past, you may annotate it with a connection marker.

Rules:
- Answer the user's question DIRECTLY and naturally. Do NOT say things like "since you previously asked", "based on your past chat", or "as you mentioned before".
- If a phrase in your response genuinely connects to the user's past knowledge, place a {{~N}} marker (where N is 1, 2, 3...) IMMEDIATELY after that phrase — no space before the marker.
- After your full response, append a connections block with details for each marker.
- Use at most 3 markers per response. Only mark genuinely useful connections; do NOT force them.
- If none of the past conversations are relevant, respond normally with NO markers at all.
- A good connection helps the user recall what they learned before and see how it builds on the current topic.

Connection block format — place this AFTER your response, separated by a blank line:

{{~CONNECTIONS~}}
[
  {{"id": 1, "chatId": "the_chat_id", "chatTitle": "Title of Past Chat", "userAsked": "what the user asked in that past chat", "aiCovered": "what the AI taught or addressed", "text": "1-2 sentence insight connecting the past chat to the current phrase — explain the relationship and how the user could build on it."}}
]
{{~END~}}

Here is a complete example:

---
User's past conversations:
[{{"chatId": "chat_abc", "title": "Cooking Basics", "userAsked": "How to properly use a chef's knife and organize prep work", "aiCovered": "Taught knife techniques (rocking motion, claw grip) and mise en place for efficient cooking"}}]

User asks: "What's the best way to prep vegetables quickly?"

Your response:
A sharp chef's knife and proper cutting technique{{~1}} will save you the most time. Group similar vegetables and prep them in batches — this is essentially mise en place applied to your workflow.

{{~CONNECTIONS~}}
[{{"id": 1, "chatId": "chat_abc", "chatTitle": "Cooking Basics", "userAsked": "How to properly use a chef's knife and organize prep work", "aiCovered": "Taught knife techniques (rocking motion, claw grip) and mise en place for efficient cooking", "text": "You practiced knife techniques and mise en place before — applying the rocking motion you learned to julienne and dice will make this significantly faster."}}]
{{~END~}}
---

User's relevant past conversations:
{past_chats_json}

Now respond to the user's message."""

# ── Metadata Extraction ───────────────────────────────────────────────────────

CHAT_METADATA_PROMPT = """Analyze this conversation and extract topic classification.

Existing topics the user has:
{topics_json}

The full conversation is given as messages. Your job is ONLY to classify.

IMPORTANT: PREFER matching to an existing topic. A chat belongs to an existing topic if it falls within the same broad domain. Only return null for matchedExistingId if the chat truly has NO relationship to any existing topic.

Return JSON:
{{
  "topic": {{
    "name": "Topic Name",
    "matchedExistingId": "existing_topic_id_or_null",
    "confidence": 0.92,
    "isOneOff": false
  }}
}}

Rules:
- "topic.name": broad domain like "Machine Learning", "Fitness"
- "topic.matchedExistingId": MUST be the id of an existing topic if the chat is related to that domain. Only null if truly no existing topic is relevant.
- "topic.confidence": 0-1. If matched to an existing topic, confidence should be at least 0.5.
- "isOneOff": true ONLY for trivial one-off requests unlikely to be followed up — formatting an email, quick factual lookups, translations. When in doubt, set false."""

# ── Current Profile (Status) Update ──────────────────────────────────────────

STATUS_UPDATE_PROMPT = """You maintain a structured summary of a user's current state in a topic for a personal context probe.

Topic: {topic_name}
Current profile: {current_status}
Current chat messages:
{current_messages}
Past chat summaries (newest first):
{recent_summaries}
User highlights / labels on assistant responses:
{annotations}

Update the profile with an **Overview**: 2-4 bullet points summarizing the user's overall profile in this topic. Think big-picture: user's background, context, stated goals, skill level, timeline, and what they've been working through. Incorporate any self-reported information the user has shared.

Rules:
- Mainly ADD or EDIT information, don't remove existing info unless contradicted
- Keep each point to 1 short-medium line
- Only include information the user explicitly shared or clearly demonstrated
- Preserve any steering notes the user wrote about themselves (e.g. "skip basics of X", "interested in Y", "avoid Z") — treat them as authoritative
- User highlights are strong, explicit evidence:
  - ♥ Interested (interested): prioritize adding/updating overview bullets about that span
  - ✓ Got it (clear): the user already understands that material — don't over-explain it later; you may note familiarity briefly
  - ? Unsure (unsure): note topics that need clarification in future responses
  - ✗ Not relevant (not_relevant): do NOT add that content to the overview
  - Comments: treat as user-stated facts with the same authority as self-reported info

Return JSON:
{{
  "overview": ["point 1", "point 2"]
}}"""

# ── Future Directions ─────────────────────────────────────────────────────────

SIDEBAR_NEW_DIRECTIONS_PROMPT = """Suggest exactly two focused directions for the user — one breadth direction and one depth direction.

Topic: {topic_name}
User's current profile:
{topic_status}
What's already been covered (overview + past chats):
{coverage}
Recent conversation context:
{current_summary}
Previously suggested (DO NOT REPEAT):
{previously_suggested}

Generate exactly 2 directions, one of each type:

- "breadth": An adjacent topic or angle the user has NOT yet touched, but is directly relevant to their profile and goals. Opens a new area — do NOT go deeper into something they already know.
- "depth": A more advanced, technical, or nuanced angle on something they HAVE already covered (in the overview or a past chat). Extends mastery of something familiar — do NOT introduce new areas.

Rules:
- Each suggestion must be grounded in a specific overview bullet or past-chat title/summary (reference it as the anchor)
- Framed as a short, open-ended question the user could naturally ask
- Do NOT repeat previously suggested directions
- breadth must reference something NOT appearing in the coverage list; depth must reference something that DOES

Return JSON:
{{
  "newDirections": [
    {{
      "type": "breadth",
      "title": "Short Title 3-5 Words",
      "question": "A short open-ended question like 'What is X?' or 'How does X connect to Y?'",
      "anchor": "From current profile / past chats: [specific overview bullet or past-chat title this builds on]",
      "reason": "One sentence explaining why this adjacent area matters for the user right now"
    }},
    {{
      "type": "depth",
      "title": "Short Title 3-5 Words",
      "question": "A short open-ended question like 'How does X work at a deeper level?' or 'What are the advanced tradeoffs of X?'",
      "anchor": "From current profile / past chats: [specific overview bullet or past-chat title that this deepens]",
      "reason": "One sentence explaining why going deeper here is valuable right now"
    }}
  ]
}}"""

# ── Chat Summarization ────────────────────────────────────────────────────────

CHAT_SUMMARIZE_PROMPT = """Summarize this conversation as a structured card. Generate:
1. A short title (3-6 words)
2. A 1-2 sentence overall summary
3. What the user asked about or provided as context (their side)
4. What the AI addressed, taught, or recommended (the takeaway)

Conversation:
{messages}

Return JSON:
{{
  "title": "Short Title Here",
  "summary": "1-2 sentence summary of the conversation.",
  "userAsked": "Concise description of what the user wanted to know or their context (1-2 sentences)",
  "aiCovered": "Key points the AI addressed or recommended — what the user could take away (1-2 sentences)"
}}"""

# ── Topic Management ──────────────────────────────────────────────────────────

TOPIC_AUTO_DETECT_PROMPT = """Analyze these recent chat summaries. Your PRIMARY goal is to assign as many chats as possible to existing topics. Your secondary goal is to identify new topic clusters.

Chat summaries (each with an id):
{summaries_json}

Existing topics (avoid duplicates):
{existing_topics}

Return JSON:
{{
  "newTopics": [
    {{ "name": "Topic Name", "chatIds": ["chat_id_1", "chat_id_2"] }}
  ],
  "assignToExisting": [
    {{ "topicId": "existing_topic_id", "chatIds": ["chat_id_3"] }}
  ]
}}

Rules:
- FIRST: Check every unassigned chat against existing topics. If a chat is even loosely related to an existing topic's domain, assign it via assignToExisting. Be generous.
- SECOND: If remaining chats form a new cluster (2+ chats in same domain), add to newTopics
- Only leave out chats that are truly random one-off requests
- If no groupings are found, return {{ "newTopics": [], "assignToExisting": [] }}"""

TOPIC_RENAME_CHECK_PROMPT = """A user renamed their learning topic from "{old_name}" to "{new_name}".

Here are the current overview bullets for this topic:
{current_overview}

Check whether any of these bullets specifically reference the old topic name "{old_name}" and would read awkwardly or incorrectly now. If so, update ONLY the bullets that reference the old name — replace the old name with the new name or rephrase naturally. Leave all other bullets UNCHANGED.

If no bullets reference the old name at all, return them as-is with needsUpdate: false.

Return JSON:
{{
  "needsUpdate": true,
  "overview": ["bullet 1", "bullet 2"]
}}"""

# ── Overview AI Edit ──────────────────────────────────────────────────────────

OVERVIEW_AI_EDIT_PROMPT = """You edit a user's current profile overview based on their natural-language instruction.

Topic: {topic_name}
Current overview bullet points:
{current_overview}

User's instruction: {instruction}

Apply the user's instruction to the overview. You may:
- Add new bullet points if the user provides new information about themselves
- Edit existing bullet points to reflect updated goals, focus, or context
- Remove bullet points the user says are no longer relevant
- Rephrase or merge bullet points for clarity

Rules:
- Preserve existing bullets that are NOT affected by the instruction
- Keep each bullet to 1 short-medium line
- Return 1-6 bullet points total
- Do NOT invent information the user didn't provide

Return JSON:
{{
  "overview": ["updated point 1", "updated point 2"]
}}"""

# ── Baseline Condition ────────────────────────────────────────────────────────

BASELINE_PERSONAL_DETAILS_PROMPT = """You are a helpful system that extracts personal details about the user from their conversations. Your goal is to maintain a running bullet-point list of what the system knows about the user.

Existing details already known:
{existing_details}

Recent conversation:
{messages}

Based on this conversation, update the list of personal details. Include:
- Background info (education, job, location, etc.)
- Interests and hobbies
- Skill levels mentioned
- Goals and preferences
- Any personal facts shared

Rules:
- Keep existing details unless clearly contradicted
- Add new details discovered in this conversation
- Merge duplicates; keep the most specific version
- Each detail should be a concise bullet point (1 short sentence)
- Return 0-20 total details

Return JSON:
{{
  "details": ["detail 1", "detail 2", "detail 3"]
}}"""
