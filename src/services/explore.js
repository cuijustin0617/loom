import { sendGeminiMessage } from './gemini';
import { normalizeText } from '../utils/normalize';

// Default model for Explore flows
const EXPLORE_MODEL = 'gemini-2.5-flash+search';

// Fallback starter pack for cold start or JSON parse failures
const FALLBACK_CARDS = [
  {
    id: 'fb-vecdb',
    title: 'Vector Databases: When to Use',
    why_now: 'Popular topic and broadly useful for RAG.',
    minutes: 5,
    mode: 'Read',
    topic: 'vector-databases',
    prerequisites: ['Embeddings basics'],
    start_payload: 'Give me a concise 5‑minute read on when to use a vector database vs plain SQL full‑text, with 3 bullet guidance and 2 gotchas. End with a brief summary.',
    swap_prompt_stub: 'Near‑neighbor storage and retrieval topics',
  },
  {
    id: 'fb-map-ndcg',
    title: 'MAP vs nDCG: Pick the Right Metric',
    why_now: 'Core IR metrics for RAG quality.',
    minutes: 10,
    mode: 'Quiz',
    topic: 'information-retrieval-metrics',
    prerequisites: ['Precision/recall'],
    start_payload: 'Create a 10‑minute practice quiz comparing MAP and nDCG. Keep markdown minimal; provide questions only in the JSON quick‑check block.',
    swap_prompt_stub: 'Evaluation metrics adjacent to RAG',
  },
  {
    id: 'fb-ui-micropatterns',
    title: 'UI Micro‑Patterns for Learning Feeds',
    why_now: 'Serendipity: broaden product instincts.',
    minutes: 5,
    mode: 'Read',
    topic: 'hci-learning-feeds',
    prerequisites: [],
    start_payload: 'Outline 5 UI micro‑patterns that improve learning feeds with 1‑line rationale and a quick example each.',
    swap_prompt_stub: 'HCI adjacent design topics',
  },
];

const clampMinutes = (m) => ([3, 5, 10, 15].includes(m) ? m : 5);
const cleanMode = (s) => (['Read', 'Code', 'Quiz'].includes(s) ? s : 'Read');

// --- Grouped feed helpers ---
const sanitizeCard = (c, chips, idx = 0) => ({
  id: String(c?.id || `card-${Date.now()}-${idx}`),
  title: String(c?.title || 'Untitled'),
  why_now: String(c?.why_now || ''),
  minutes: chips?.minutes == null ? clampMinutes(Number(c?.minutes) || 5) : clampMinutes(Number(chips?.minutes) || 5),
  mode: chips?.mode == null ? cleanMode(String(c?.mode || 'Read')) : cleanMode(String(chips?.mode || 'Read')),
  topic: String(c?.topic || ''),
  prerequisites: Array.isArray(c?.prerequisites) ? c.prerequisites.slice(0, 2).map(String) : [],
  start_payload: String(c?.start_payload || ''),
  swap_prompt_stub: String(c?.swap_prompt_stub || ''),
});

const sanitizeGroups = (obj, chips) => {
  const want = [
    { id: 'review', label: 'Review' },
    { id: 'deep_dive', label: 'Deep Dive' },
    { id: 'adjacent', label: 'Adjacent' },
  ];
  const groupsIn = Array.isArray(obj?.groups) ? obj.groups : [];
  const out = [];
  for (const spec of want) {
    const found = groupsIn.find(
      (g) => String(g?.id || '').toLowerCase() === spec.id || String(g?.label || '').toLowerCase() === spec.label.toLowerCase()
    );
    const cardsIn = Array.isArray(found?.cards) ? found.cards : [];
    const cards = cardsIn.slice(0, 3).map((c, i) => sanitizeCard(c, chips, i));
    out.push({
      id: spec.id,
      label: String(found?.label || spec.label),
      description: String(found?.description || ''),
      cards,
    });
  }
  return out;
};

// Ensure diversity across 9 cards when chips are not forcing a single minutes/mode
const ensureDiversity = (groups, chips) => {
  if (!Array.isArray(groups)) return groups;
  const out = groups.map(g => ({ ...g, cards: (g.cards || []).map(c => ({ ...c })) }));
  const all = out.flatMap(g => g.cards);
  const modes = ['Read', 'Code', 'Quiz'];
  const minutesList = [3, 5, 10, 15];
  if (chips?.mode == null) {
    for (let i = 0; i < all.length; i++) {
      const c = all[i];
      if (!modes.includes(c.mode)) c.mode = modes[i % modes.length];
    }
  }
  if (chips?.minutes == null) {
    for (let i = 0; i < all.length; i++) {
      const c = all[i];
      if (![3,5,10,15].includes(Number(c.minutes))) c.minutes = minutesList[i % minutesList.length];
    }
  }
  return out;
};

const fallbackGroupsFromIntent = (intent, chips) => {
  const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const mk = ({ title, topic, why_now, seed, minutes, mode }) => sanitizeCard(
    {
      id: id(),
      title,
      topic,
      why_now,
      minutes,
      mode,
      prerequisites: [],
      start_payload: seed,
      swap_prompt_stub: `${topic} neighbors`,
    },
    // If chips specify fixed minutes/mode, enforce; otherwise allow per-card diversity
    chips?.minutes == null && chips?.mode == null ? null : chips
  );

  const subject = intent && intent.trim() ? intent.trim() : 'recent topics';

  const minsList = [3, 5, 10, 15];
  const modes = ['Read', 'Code', 'Quiz'];
  const seedFor = (m, mins) => (
    m === 'Code'
      ? `Create a tiny coding task with a minimal snippet and 3–4 verification steps. Budget ${mins || chips?.minutes || 10} minutes.`
      : m === 'Quiz'
        ? `Generate ONLY the JSON quick‑check quiz with about ${Math.max(5, Math.round((mins || chips?.minutes || 5) * 1.5))} MCQ questions, EACH with exactly 4 choices and one correct index. Keep markdown minimal or omit.`
        : `Write a structured reading that fits about ${mins || chips?.minutes || 5} minutes (headings, short paragraphs, lists/tables as helpful). Do NOT include a quiz in the markdown; provide it via the JSON quick‑check block (exactly 3 MCQ questions, each with 4 choices).`
  );

  return [
    {
      id: 'review',
      label: 'Review',
      description: 'Quick recaps based on your recent chats.',
      cards: [
        mk({ title: `${subject}: Quick Recap`, topic: 'recap-overview', why_now: `Reinforce what you just covered.`, mode: modes[0], minutes: minsList[1], seed: seedFor(modes[0], minsList[1]) }),
        mk({ title: `${subject}: Key Ideas`, topic: 'recap-key-ideas', why_now: 'Solidify core concepts before moving on.', mode: modes[1], minutes: minsList[0], seed: seedFor(modes[1], minsList[0]) }),
        mk({ title: `${subject}: Common Pitfalls`, topic: 'recap-pitfalls', why_now: 'Catch mistakes early with a brief pass.', mode: modes[2], minutes: minsList[2], seed: seedFor(modes[2], minsList[2]) }),
      ],
    },
    {
      id: 'deep_dive',
      label: 'Deep Dive',
      description: 'Go one level deeper on what you started.',
      cards: [
        mk({ title: `${subject}: Next‑Step Concept`, topic: 'deeper-next-step', why_now: 'Build depth by extending prior work.', mode: modes[0], minutes: minsList[3], seed: seedFor(modes[0], minsList[3]) }),
        mk({ title: `${subject}: Under‑the‑Hood`, topic: 'deeper-internals', why_now: 'Understand the mechanics behind the idea.', mode: modes[1], minutes: minsList[2], seed: seedFor(modes[1], minsList[2]) }),
        mk({ title: `${subject}: Evaluation & Trade‑offs`, topic: 'deeper-eval', why_now: 'Develop judgment for practical choices.', mode: modes[2], minutes: minsList[1], seed: seedFor(modes[2], minsList[1]) }),
      ],
    },
    {
      id: 'adjacent',
      label: 'Adjacent',
      description: 'Broaden with closely related, highly relevant topics.',
      cards: [
        mk({ title: `${subject}: Nearby Technique`, topic: 'adjacent-technique', why_now: 'See a parallel approach in the same family.', mode: modes[1], minutes: minsList[1], seed: seedFor(modes[1], minsList[1]) }),
        mk({ title: `${subject}: Complementary Tool`, topic: 'adjacent-tool', why_now: 'Round out your toolkit with a sibling topic.', mode: modes[0], minutes: minsList[0], seed: seedFor(modes[0], minsList[0]) }),
        mk({ title: `${subject}: Real‑world Parallel`, topic: 'adjacent-application', why_now: 'Connect to a neighboring real‑world use case.', mode: modes[2], minutes: minsList[3], seed: seedFor(modes[2], minsList[3]) }),
      ],
    },
  ];
};

// Try hard to pull a JSON array out of model text
const extractJSONArray = (raw) => {
  const s = String(raw || '');
  let start = -1;
  let inStr = false;
  let escape = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inStr = false; }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '[') { if (depth === 0) start = i; depth++; continue; }
    if (ch === ']') { depth--; if (depth === 0 && start !== -1) { return s.slice(start, i + 1); } }
  }
  return null;
};

const safeParseJSON = (text) => {
  try {
    const t = String(text || '').trim();
    // Trim common code fences
    const fenceTrimmed = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    try { return JSON.parse(fenceTrimmed); } catch {}
    const extracted = extractJSONArray(t);
    if (extracted) {
      try { return JSON.parse(extracted); } catch {}
    }
  } catch {}
  return null;
};

const fallbackFromIntent = (intent, chips) => {
  const base = (title, topic) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    why_now: intent ? `Based on your intent: “${intent}”.` : 'Quick starter pick.',
    minutes: chips.minutes,
    mode: chips.mode,
    topic,
    prerequisites: [],
    start_payload:
      chips.mode === 'Read'
        ? `Write a structured reading on ${intent || topic} that fits about ${chips.minutes} minutes (headings, short paragraphs, lists/tables as helpful). No quiz in the markdown; provide questions via the JSON quick‑check block.`
        : chips.mode === 'Code'
          ? `Create a tiny coding task about ${intent || topic}. Include a minimal snippet and 3–4 verification steps. Budget ${chips.minutes} minutes. No quiz.`
          : `Generate ONLY the JSON quick‑check quiz on ${intent || topic} with about ${Math.max(5, Math.round((chips.minutes || 5) * 1.5))} MCQ questions. Minimal or no markdown.`,
    swap_prompt_stub: `${intent || topic} neighbors`,
  });
  const t = (suffix) => (intent ? `${intent}: ${suffix}` : suffix);
  return [
    base(t('Quick Overview'), 'overview'),
    base(t('Key Concepts'), 'key-concepts'),
    base(t('Common Pitfalls'), 'pitfalls'),
    base(t('Applied Example'), 'applied-example'),
    base(t('Mini Quiz'), 'mini-quiz'),
  ];
};

export async function getExploreBatch({
  historySnippets = [],
  minutes,
  mode,
  vibe,
  intent = '',
  mutedTopics = [],
  savedIds = [],
  model = EXPLORE_MODEL,
} = {}) {
  const chips = {
    minutes: minutes == null ? null : clampMinutes(minutes),
    mode: mode == null ? null : cleanMode(mode),
    vibe: vibe === 'Focused' ? 'Focused' : (vibe === 'Chill' ? 'Chill' : null),
  };

  const sys = [
    'You are my study feed packager.',
    'Return ONLY a JSON object — no prose, no code fences.',
    'Shape: { groups: [ { id, label, description, cards: [Card, Card, Card] } x3 ] }.',
    'Groups (exact IDs):',
    '- review: concise recap of topics already discussed in chats. Summarize, do not elaborate.',
    '- deep_dive: go one level deeper on existing themes; introduce a next‑step concept rooted in discussed topics (may be a new concept but clearly builds on them).',
    '- adjacent: broaden breadth with closely‑related, parallel topics to what was discussed (e.g., asked about k‑means → suggest SVM or GMM).',
    'Card fields: {id, title, why_now, minutes, mode, topic, prerequisites[<=2], start_payload, swap_prompt_stub}.',
    'Constraints: If chips.minutes or chips.mode are provided, use them for every card. Otherwise, diversify minutes across [3,5,10,15] and include a balanced mix of modes [Read, Code, Quiz] across the 9 cards. IDs must be unique strings. Avoid muted_topics and saved_ids. Keep topics tightly relevant. No markdown/code fences in the JSON output.',
  ].join(' ');

  const user = {
    intent,
    chips, // treat as target minutes and preferred mode
    recent_history_snippets: historySnippets.slice(0, 200).map((s) => normalizeText(String(s || '').slice(0, 2000))),
    muted_topics: mutedTopics,
    saved_ids: savedIds,
  };

  const messages = [
    { role: 'user', content: `${sys}\n\nINPUT:\n${JSON.stringify(user)}` },
  ];

  try {
    const raw = await sendGeminiMessage(messages, model);
    const parsed = safeParseJSON(raw);
    let groups = sanitizeGroups(parsed, chips);
    groups = ensureDiversity(groups, chips);
    if (!Array.isArray(groups) || groups.length !== 3 || groups.some(g => g.cards.length === 0)) throw new Error('Bad groups');
    return { groups };
  } catch (e) {
    // Intent‑aware fallback using chips (grouped)
    let groups = fallbackGroupsFromIntent(intent, chips);
    groups = ensureDiversity(groups, chips);
    return { groups };
  }
}

export async function swapCard({ rejectedCard, contextCards = [], minutes, mode, model = EXPLORE_MODEL } = {}) {
  const chips = {
    minutes: clampMinutes(minutes || rejectedCard?.minutes || 5),
    mode: cleanMode(mode || rejectedCard?.mode || 'Read'),
  };

  const prompt = [
    'Given rejected_card and context_cards, propose 1 alternative card as JSON.',
    'Keep same minutes and mode unless told otherwise. Prefer same theme family or nearest neighbor.',
    'Card fields: {id, title, why_now, minutes, mode, topic, prerequisites[≤2], start_payload, swap_prompt_stub}.',
    'Only JSON, no prose.',
  ].join(' ');

  const input = { rejected_card: rejectedCard, context_cards: contextCards.slice(0, 5), chips };
  const messages = [
    { role: 'user', content: `${prompt}\n\nINPUT:\n${JSON.stringify(input)}` },
  ];
  try {
    const raw = await sendGeminiMessage(messages, model);
    const parsed = safeParseJSON(raw);
    const card = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!card) throw new Error('No card');
    return { card: {
      id: String(card.id || `swap-${Date.now()}`),
      title: String(card.title || 'Untitled'),
      why_now: String(card.why_now || ''),
      minutes: clampMinutes(Number(card.minutes) || chips.minutes),
      mode: cleanMode(String(card.mode || chips.mode)),
      topic: String(card.topic || rejectedCard?.topic || ''),
      prerequisites: Array.isArray(card.prerequisites) ? card.prerequisites.slice(0, 2).map(String) : [],
      start_payload: String(card.start_payload || ''),
      swap_prompt_stub: String(card.swap_prompt_stub || ''),
    } };
  } catch (e) {
    // Best effort: return a fallback not equal to the rejected topic
    const alt = FALLBACK_CARDS.find((c) => c.topic !== rejectedCard?.topic) || FALLBACK_CARDS[0];
    return { card: { ...alt, id: `swapfb-${Date.now()}` } };
  }
}

export async function whyThis({ card, recentUserThemes = [], model = EXPLORE_MODEL } = {}) {
  const prompt = 'Explain in one sentence why this card was selected using fields {why_now, prerequisites, recent_user_themes}. No fluff.';
  const input = { card, recent_user_themes: recentUserThemes };
  const messages = [
    { role: 'user', content: `${prompt}\n\nINPUT:\n${JSON.stringify(input)}` },
  ];
  try {
    const text = await sendGeminiMessage(messages, model);
    return { sentence: normalizeText(String(text || '').trim()) };
  } catch (e) {
    return { sentence: card?.why_now || '' };
  }
}

export async function getSessionContent({ card, model = EXPLORE_MODEL } = {}) {
  const mode = String(card?.mode || 'Read');
  const minutes = clampMinutes(Number(card?.minutes) || 5);

  // Build a robust seed text from the card, avoiding "[object Object]" cases
  let seed = '';
  if (typeof card?.start_payload === 'string') {
    seed = card.start_payload;
  } else if (card?.start_payload && typeof card.start_payload === 'object') {
    try { seed = JSON.stringify(card.start_payload, null, 2); } catch { seed = ''; }
  }

  const request = [
    `Title: ${card?.title || ''}`,
    card?.topic ? `Topic: ${card.topic}` : null,
    card?.why_now ? `Why now: ${card.why_now}` : null,
    Array.isArray(card?.prerequisites) && card.prerequisites.length > 0
      ? `Prerequisites: ${card.prerequisites.join(', ')}`
      : null,
    seed ? `Seed:\n${seed}` : null,
  ].filter(Boolean).join('\n');

  const prompt = [
    'You are a study card generator. Produce a compact, useful session based on the structured request below.',
    `Time budget: ${minutes} minutes. Mode: ${mode}.`,
    'Output must be Markdown for the learning content (headings, lists, code, tables, math ok). No front-matter.',
  ];
  if (mode === 'Read') {
    prompt.push('Write a structured reading that fits the time budget (use headings, short paragraphs, lists/tables as helpful). Do NOT include any quiz in the markdown. Avoid headings like "Micro quiz" or "Quiz" in the markdown.');
  } else if (mode === 'Code') {
    prompt.push('Include: a tiny task, a minimal code snippet, and 3–4 verification steps.');
  } else if (mode === 'Quiz') {
    prompt.push('Keep markdown minimal (optional one‑line instructions). Do NOT include the textual quiz body; provide questions only in the JSON quick‑check block. Do not reveal answers in markdown.');
  }
  prompt.push('If details are sparse, infer sensible content from Title/Topic; do not ask the user for more input.');
  // Let the app render a unified Sources block; avoid embedding in markdown
  prompt.push('Do NOT include a "Sources" or "References" section in the markdown; links/citations will be handled separately.');
  // Append machine-readable quiz block for interactivity (Read/Quiz modes only)
  if (mode === 'Read' || mode === 'Quiz') {
    const count = mode === 'Quiz' ? Math.max(3, Math.round(minutes * 1.5)) : 3;
    prompt.push(`Then append ONLY one JSON code block as the last element with exactly ${count} MCQ questions (one correct index per question, each with EXACTLY 4 choices) in this shape (no markdown inside values):`);
    prompt.push('```json');
    prompt.push('{ "quiz": { "questions": [ { "id": "q1", "text": "...", "choices": ["A","B","C","D"], "answerIndex": 1, "explanation": "..." } ] } }');
    prompt.push('```');
    prompt.push('Constraints for quiz JSON: valid JSON, short choice strings, EXACTLY 4 choices per question, single correct index per question (0–3), do not include question text or answers in markdown, and no trailing prose after the block.');
  }

  const messages = [
    { role: 'user', content: `${prompt.join(' ')}\n\nREQUEST (structured):\n${request}` },
  ];
  try {
    const text = await sendGeminiMessage(messages, model);
    return { text: normalizeText(String(text || '').trim()) };
  } catch (e) {
    throw new Error(`Session generation failed: ${e.message}`);
  }
}

// Fallback: generate ONLY the quick‑check JSON for a given card/content
export async function generateQuickCheck({ card, minutes, reading, model = EXPLORE_MODEL } = {}) {
  const m = clampMinutes(Number(minutes || card?.minutes) || 5);
  const count = (card?.mode === 'Read') ? 3 : Math.max(3, Math.round(m * 1.5));
  const prompt = [
    `Create ONLY a JSON quick‑check block with exactly ${count} MCQ questions for the topic "${card?.title || card?.topic || ''}".`,
    'Shape must be: { "quiz": { "questions": [ { "id": "q1", "text": "...", "choices": ["A","B","C","D"], "answerIndex": 1, "explanation": "..." } ] } }',
    'Constraints: valid JSON, no markdown fences, EXACTLY 4 choices per question, single correct index (0–3), short choice strings.',
  ];
  if (reading) prompt.push('Base the questions on this reading:\n' + String(reading).slice(0, 4000));
  const messages = [ { role: 'user', content: prompt.join(' ') } ];
  try {
    const text = await sendGeminiMessage(messages, model);
    const parsed = safeParseJSON(text);
    if (parsed && parsed.quiz && Array.isArray(parsed.quiz.questions)) return { quiz: parsed.quiz };
  } catch {}
  return { quiz: null };
}
