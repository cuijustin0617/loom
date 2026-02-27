"""All prompt templates for the Loom knowledge sidebar system."""

CHAT_RESPONSE_PROMPT = """You are a helpful AI assistant. Respond naturally and helpfully to the user's message.

After your response, also analyze this conversation:
1. What topic domain does this conversation belong to? Try to match to an existing topic if possible.
2. What key concepts were discussed or referenced?

Existing topics the user has:
{topics_json}

You MUST return valid JSON in this exact format:
{{
  "response": "Your helpful response here...",
  "topic": {{
    "name": "Topic Name",
    "matchedExistingId": "existing_topic_id_or_null",
    "confidence": 0.92
  }},
  "concepts": [
    {{ "title": "Concept Title Up To 5 Words", "preview": "10-15 word description of the concept" }}
  ]
}}

Rules:
- "response" should be a natural, helpful answer to the user's question
- "topic.name" should be a broad domain name like "Machine Learning", "Fitness", "Chinese Language"
- "topic.matchedExistingId" should be the id of an existing topic if one matches, or null if this is a new domain
- "topic.confidence" is 0-1 how confident you are this belongs to that topic
- "concepts" should list 1-4 key concepts discussed, each with a short title and preview
- Concept titles should be max 5 words, previews max 15 words"""

CHAT_STREAM_SYSTEM_PROMPT = """You are a helpful AI assistant. Respond naturally and helpfully to the user's message. Be clear and conversational."""

CHAT_METADATA_PROMPT = """Analyze this conversation and extract topic classification and key concepts.

Existing topics the user has:
{topics_json}

The full conversation is given as messages. Your job is ONLY to classify:

Return JSON:
{{
  "topic": {{
    "name": "Topic Name",
    "matchedExistingId": "existing_topic_id_or_null",
    "confidence": 0.92
  }},
  "concepts": [
    {{ "title": "Concept Title Up To 5 Words", "preview": "10-15 word description" }}
  ]
}}

Rules:
- "topic.name": broad domain like "Machine Learning", "Fitness"
- "topic.matchedExistingId": id of existing topic if one matches, or null
- "topic.confidence": 0-1
- "concepts": 1-4 key concepts, title max 5 words, preview max 15 words"""

SIDEBAR_BRIDGE_QUESTIONS_PROMPT = """You help users connect their current conversation to their past knowledge.

Current conversation (most recent messages):
{current_messages}

Current topic: {topic_name}
User's status in this topic: {topic_status}

Here are the user's most relevant past chats and concepts (ranked by relevance):
{ranked_items_json}

For each item, generate a personalized bridge question that connects it to the CURRENT conversation. The question should:
- Reference what the user previously discussed specifically
- Naturally connect the past knowledge to the current topic
- Read like something the user would naturally ask
- Include personal details if relevant (e.g., "I learned about X before...")

Return JSON:
{{
  "relatedCards": [
    {{
      "sourceType": "chat" or "concept",
      "sourceId": "the_source_id",
      "sourceTitle": "Title of past chat or concept",
      "sourceSummary": "Brief 1-line summary of the past item",
      "bridgeQuestion": "A natural question connecting past knowledge to current chat"
    }}
  ]
}}

Return 3-5 cards maximum. If fewer relevant items exist, return fewer."""

SIDEBAR_NEW_DIRECTIONS_PROMPT = """Suggest areas the user has NOT explored yet within this topic.

Topic: {topic_name}
User's current status: {topic_status}
Concepts they've already covered:
{covered_concepts}

Current conversation context:
{current_summary}

Suggest 2-3 new directions that are:
- Adjacent to what the user knows but they haven't asked about
- Naturally connected to the current conversation
- Phrased as questions the user could ask

Return JSON:
{{
  "newDirections": [
    {{
      "title": "Short Title 3-5 Words",
      "question": "A natural question the user could ask to explore this direction"
    }}
  ]
}}"""

STATUS_UPDATE_PROMPT = """You maintain a structured summary of a user's status in a topic.

Topic: {topic_name}
Current status: {current_status}
Current chat messages:
{current_messages}
Past chat summaries (newest first):
{recent_summaries}

Update the status with two sections:

1. **Overview**: 2-4 bullet points summarizing the user's overall profile in this topic. Think big-picture: user's background, context, traits, level, stats, goals, timeline. Incorporate any self-reported knowledge, notes, or stated expertise the user has shared. Example: "CS undergrad at Harvard, comfortable with classical ML, new to deep learning, want to work in silicon Valley"

2. **Specifics**: Individual items the user has explored, one per chat or concept. For each, include a short label and inferred understanding level based on how they asked (their own questions show deeper interest; clicking a suggested question means brief exposure).

Rules:
- mainly ADD or EDIT(more detailed) information, don't remove existing info unless contradicted or clearly changed
- Keep each point to 1 short-medium line
- Write specifics in a personal, descriptive style — e.g. "asked about X and dug into Y", "explored how X works", "briefly touched on X as part of a broader answer" — not just a bare concept name
- Infer understanding: "solid" if user asked deep follow-ups, "familiar" if they asked about it, "brief" if it's only part of the system's reply and user hasn't seemed to care much yet
- If the user explicitly states what they know, learned, or shares notes on a topic, include those as specifics with level "solid"/"familiar"
- If current status is a plain string (legacy), convert it to the structured format

Return JSON:
{{
  "overview": ["point 1", "point 2"],
  "specifics": [
    {{"text": "asked about Raft consensus protocol and dug into leader election implementation", "level": "solid"}},
    {{"text": "explored Paxos algorithm and how it differs from Raft", "level": "familiar"}},
    {{"text": "briefly touched on Byzantine fault tolerance as part of a broader answer", "level": "brief"}}
  ]
}}"""

CHAT_SUMMARIZE_PROMPT = """Summarize this conversation in 1-2 concise sentences capturing the main question asked and key takeaway. Also generate a short title (3-6 words).

Conversation:
{messages}

Return JSON:
{{ "title": "Short Title Here", "summary": "1-2 sentence summary of the conversation." }}"""

TOPIC_AUTO_DETECT_PROMPT = """Analyze these recent chat summaries and identify recurring topic clusters. A topic must have at least 2 chats that clearly belong to the same domain.

Chat summaries (each with an id):
{summaries_json}

Existing topics (avoid duplicates):
{existing_topics}

Return JSON:
{{
  "newTopics": [
    {{ "name": "Topic Name", "chatIds": ["chat_id_1", "chat_id_2"] }}
  ]
}}

If no new topics are detected, return {{ "newTopics": [] }}"""
