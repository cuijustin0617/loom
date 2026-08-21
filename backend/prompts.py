"""All prompt templates for the Loom Personal Context Probe (Past / Current / Future)."""

# ── Chat Response Prompts ─────────────────────────────────────────────────────

CHAT_RESPONSE_PROMPT = """You are a helpful AI assistant. Respond naturally and helpfully to the user's message. Prefer concise, clear responses — no fluff or unnecessary preamble.

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

CHAT_STREAM_SYSTEM_PROMPT = """You are a helpful AI assistant. Respond naturally and helpfully to the user's message. Prefer concise, clear responses — no fluff or unnecessary preamble."""

CHAT_STREAM_PROFILE_BLOCK = """You also have a profile of this user: what they've been doing (overview) and what they want (goals). Keep it in mind while replying — when the query naturally connects to a goal, subtly relate your answer to it; never force the association, and never mention the profile explicitly. Answer the user's question directly first.

User profile:
{profile}"""

CHAT_STREAM_HIGHLIGHT_BLOCK = """
HIGHLIGHTING: In your response, wrap 1–2 short spans (at most 12 words each) that the user
would most likely want to react to — a key fact, a recommendation, a claim they might
question or care about — using exactly these markers: {~HL~}span text{~/HL~}
Rules: at most 2 highlights; only complete sentences/fragments from your own text; never
inside code blocks, URLs, or markdown headers; never nest markers; if nothing is
highlight-worthy, use none."""

CHAT_STREAM_BASELINE_PROMPT = """You are a helpful AI assistant. Respond naturally and helpfully to the user's message. Prefer concise, clear responses — no fluff or unnecessary preamble.

Here is what you know about this user from previous conversations. Use this context when it's genuinely relevant to give a more personalized and helpful answer — but do NOT mention the profile explicitly or say things like "based on your profile". Just let it naturally inform your response when appropriate.

User profile:
{personal_details}"""

CHAT_STREAM_MEMORY_PROMPT = """You are a helpful AI assistant. Respond naturally and helpfully to the user's message. Prefer concise, clear responses — no fluff or unnecessary preamble.

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
{profile_block}
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

# ── Pre-Reply Topic Classification ───────────────────────────────────────────
CLASSIFY_FIRST_PROMPT = """Classify the user's message into a topic BEFORE answering it.
Existing topics (id — name):
{topics_list}
Reply with EXACTLY ONE of these, nothing else:
- An existing topic id from the list above, if the message clearly belongs to it
- NEW: <2-5 word topic name>, if it starts a genuinely new topic
- ONEOFF, if it is a trivial one-time request (formatting, quick lookup, translation) unlikely to be followed up
Rules:
- Prefer an existing topic whenever the message fits its domain, even loosely.
- Your entire reply must be a single short line. No explanation, no punctuation around it, no quotes."""

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

You are writing a profile of the USER — what they have told you about themselves,
what they are doing, and how they react to the assistant's responses.

The profile has two fields:
- Overview: descriptive only — things that happened, background, experience,
  reactions. Write "User is comparing X and Y for their thesis", never
  "User wants to learn X" / "User needs Y" / "User should explore Z" unless
  the user said so themselves. Describe, don't prescribe.
- Goals: short phrases of ~4–7 words naming the topic or direction — never
  a full sentence, never "User wants to…". Positive examples: "Explore
  generative AI system design", "Master offline and online evaluation".
  Banned: "User wants to learn X", "User is deciding whether to…", any
  sentence with a subject and verb.

Evidence, in order of authority:
1. Comments the user wrote (comment annotations) — explicit statements; almost
   always produce an ADD or EDIT. Phrase as a fact about the user, never as a
   quote of the comment.
2. Labels on specific spans (★ important / ? unsure)
   — direct reactions; update the profile to reflect them.
3. The user's own messages — what they explicitly stated or asked.

The ASSISTANT's messages are NOT evidence of what the user wants, needs, or is
learning. Never turn assistant suggestions, recommendations, or explanations
into profile bullets about the user — the user discussing a topic is not the
user adopting it.

- ★ Important (important): prioritize adding/updating overview bullets about that span. Legacy data may say interested with the same meaning.
- ? Unsure (unsure): note topics that need clarification in future responses
- Comments (comment): these are explicit user statements about the quoted span. They should usually produce an overview ADD or EDIT grounded in the comment's content — phrase it as a profile fact about the user, not as a quote of the comment itself.

Organize the overview as an ordered mix of short subtitle headers and bullets.
Use 2–4 short subtitles when they help (e.g. "Background", "Experience",
"Interests"). Do NOT put a "Goals" subtitle in overview — goals live in the
goals field. Bullets under a subtitle may be short fragments, not full
sentences. One level only — never nest headers under headers.

Rules (apply to both overview and goals):
- Only propose a change when there is concrete NEW evidence (new user message,
  label, or comment since the current profile was written). If nothing new is
  known about the user, return the current overview and goals unchanged.
- Propose only changes that are clearly necessary — a new point that is clearly
  missing, an old point that is clearly wrong or outdated, an edit with an
  obvious reason. Do NOT reword, shuffle, merge, split, or tweak bullets or
  headers without a clear reason; small stylistic rewrites are not a valid
  change. If in doubt, leave the item untouched.
- Mainly ADD or EDIT; don't remove unless directly contradicted by the user.
- Keep each bullet to 1 short line.
- Preserve any steering notes the user wrote about themselves (e.g. "skip
  basics of X", "avoid Z") — treat them as authoritative.
- Seed candidates: saved/confirmed goals already in the current profile MUST
  be preserved unless directly contradicted. Treat them as authoritative,
  like steering notes.
- Volume cap: at most 2 changes TOTAL per update (across overview and goals combined).
  Pick only the single most important new fact(s). If everything is marginal, return
  everything unchanged — a missed minor fact is acceptable, a noisy profile is not.
- Never tweak wording, reorder, merge, split, or restyle existing items unless the
  current text is factually wrong. Small improvements are NOT a valid reason to change.

Return JSON:
{{
  "overview": [
    {{"type": "header", "text": "Background"}},
    {{"type": "bullet", "text": "point under that subtitle"}},
    {{"type": "bullet", "text": "another point"}}
  ],
  "goals": [
    {{"text": "Explore generative AI system design"}},
    {{"text": "Master offline evaluation"}}
  ]
}}"""

# ── Future Directions ─────────────────────────────────────────────────────────

SIDEBAR_NEW_DIRECTIONS_PROMPT = """Suggest exactly two focused goal-level directions for the user — one breadth goal and one depth goal.

Topic: {topic_name}
User's current profile:
{topic_status}
User highlights / labels on assistant responses:
{annotations}

Labels are direct evidence from the user — suggestions should prioritize important
material, respond to uncertainty, and build on comment-labeled material.
What's already been covered (overview + past chats):
{coverage}
Recent conversation context:
{current_summary}
Previously suggested (DO NOT REPEAT):
{previously_suggested}

Generate exactly 2 suggestions, one of each type:

- "breadth": An adjacent topic or angle the user has NOT yet touched, but is directly relevant to their profile and goals. Opens a new area — do NOT go deeper into something they already know.
- "depth": A more advanced, technical, or nuanced angle on something they HAVE already covered (in the overview or a past chat). Extends mastery of something familiar — do NOT introduce new areas.

Rules:
- title = a general goal in 4–6 words (e.g. "Explore evaluation methods", "Deepen model intuition") — NOT a question, NOT a niche/specific scenario
- Prefer broad, reusable intentions over narrow one-off topics; leave specifics for exampleQuestion
- exampleQuestion = one concrete first question the user could ask right now to act on that goal
- exampleQuestion must be ≤ 12 words, a single direct question, plain language — no compound or multi-part questions.
- Each suggestion must be grounded in a specific overview bullet or past-chat title/summary (reference it as the anchor)
- Do NOT repeat previously suggested directions
- breadth must reference something NOT appearing in the coverage list; depth must reference something that DOES

Return JSON:
{{
  "newDirections": [
    {{
      "type": "breadth",
      "title": "4-6 word general goal",
      "exampleQuestion": "A concrete first question the user could ask right now",
      "anchor": "From current profile / past chats: [specific overview bullet or past-chat title this builds on]",
      "reason": "One sentence explaining why this adjacent area matters for the user right now"
    }},
    {{
      "type": "depth",
      "title": "4-6 word general goal",
      "exampleQuestion": "A concrete first question the user could ask right now",
      "anchor": "From current profile / past chats: [specific overview bullet or past-chat title that this deepens]",
      "reason": "One sentence explaining why going deeper here is valuable right now"
    }}
  ]
}}"""

SIDEBAR_GOAL_QUESTION_PROMPT = """Generate one concrete example question the user could ask right now to act on a saved goal.

Topic: {topic_name}
User's current profile:
{topic_status}
What's already been covered (overview + past chats):
{coverage}
Goal: {goal_title}
Do not repeat this prior question (if any): {exclude_question}

Rules:
- Return exactly one short, open-ended question the user could naturally type into chat
- the question must be ≤ 12 words, a single direct question, plain language — no compound or multi-part questions.
- Ground it in the goal title and the user's profile/coverage
- Do not restate the goal as a statement — output a question only

Return JSON:
{{
  "question": "A short open-ended question"
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
Current overview (markdown: ## headers, - bullets):
{current_overview}

User's instruction: {instruction}

The overview is an ordered mix of subtitle headers and bullets (one level only).
Apply the user's instruction. You may:
- Add, rename, or remove subtitle headers
- Add new bullets if the user provides new information about themselves
- Edit existing bullets to reflect updated goals, focus, or context
- Remove bullets the user says are no longer relevant
- Rephrase, merge, or regroup bullets under headers for clarity

Rules:
- Preserve items that are NOT affected by the instruction
- Keep each bullet to 1 short-medium line; headers are short labels (1-3 words)
- One level only — never nest headers
- Do NOT invent information the user didn't provide

Return JSON:
{{
  "overview": [
    {{"type": "header", "text": "Background"}},
    {{"type": "bullet", "text": "updated point"}}
  ]
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
