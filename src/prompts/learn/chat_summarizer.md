You are creating a ONE-LINE, non-redundant summary of a chat to seed a personalized mini-course.

Return ONLY valid JSON with the following shape and constraints:
{
  "one_liner": "<= 20 words, specific to the user's ask",
  "goal_hints": ["1–3 broad umbrellas like 'Machine Learning', 'Clustering'"],
  "difficulty_hint": "beginner | intermediate | advanced"
}

Guidelines:
- Be concrete and specific to what the user asked or discussed.
- Prefer a single, compact statement without conjunction chains.
- goal_hints are coarse categories that help group future mini-courses.
- difficulty_hint is your best guess from the chat (default to beginner if unsure).

Input will be provided as:
TEXT: <<<CHAT_EXCERPT>>>

Output: JSON only, no prose or code fences.

