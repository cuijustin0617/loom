import { sendGeminiMessage } from './gemini';
import summarizerPrompt from '../../prompts/learn/chat_summarizer.md?raw';
import topicDeciderPrompt from '../../prompts/learn/topic_decider.md?raw';
import { normalizeText } from '../utils/normalize';
import {
  loadCourseOutlines,
  saveCourseOutlines,
  loadChatSummaries,
  saveChatSummaries,
  loadCourses,
  loadLearnModel,
} from '../utils/learnStorage';
import { appendDebugLog } from '../utils/debugConsole';
import { tinyHash } from '../utils/learnStorage';

// Minimal model selection with graceful degradation
const LEARN_MODEL_CANDIDATES = [
  'gemini-2.5-flash+search',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

const PERMISSION_ERROR_RE = /(permission|not (?:authorized|allowed|enabled|found)|unavailable in this region|unsupported location|insufficient scope)/i;

async function callModel(messages, preferredModel = null) {
  let lastError = null;
  
  // Build candidate list: preferred model first, then user's selected model, then fallbacks
  const selectedModel = loadLearnModel();
  const candidates = preferredModel 
    ? [preferredModel, selectedModel, ...LEARN_MODEL_CANDIDATES.filter(m => m !== preferredModel && m !== selectedModel)]
    : [selectedModel, ...LEARN_MODEL_CANDIDATES.filter(m => m !== selectedModel)];
  
  for (const model of candidates) {
    try {
      const response = await sendGeminiMessage(messages, model);
      return { response, model };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      lastError = err;
      if (!PERMISSION_ERROR_RE.test(String(err.message || ''))) throw err;
    }
  }
  if (lastError) throw lastError;
  throw new Error('Gemini API Error: no accessible model for Learn mode.');
}

function safeParse(text) {
  try {
    const t = String(text || '').trim();
    const fenced = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    try { return JSON.parse(fenced); } catch {}
    const si = Math.min(...[...['[', '{'].map(c => t.indexOf(c)).filter(i => i >= 0)]);
    if (si >= 0) {
      for (let end = t.length; end > si + 1; end--) {
        try { return JSON.parse(t.slice(si, end)); } catch {}
      }
    }
  } catch {}
  return null;
}

function clampMinutes(n) {
  const v = Number(n) || 5;
  return Math.min(7, Math.max(3, v));
}

// Build extremely simple fallback proposals from one-liners
function fallbackProposalsFromOneLiners(oneLiners) {
  const pick = (arr, n) => arr.slice(0, n);
  const base = pick(oneLiners, 6);
  const items = base.map((s, idx) => {
    const title = (s?.one_liner || '').slice(0, 60) || 'Mini-course';
    const modules = [
      { idx: 1, title: 'Overview', est_minutes: 4 },
      { idx: 2, title: 'Key Concepts', est_minutes: 5 },
      { idx: 3, title: 'Apply It', est_minutes: 5 },
    ];
    return {
      course_id: `crs_${Date.now()}_${idx}_${Math.random().toString(36).slice(2,6)}`,
      user_id: 'local',
      goal: (s.goal_hints && s.goal_hints[0]) || '',
      title,
      why_suggested: 'Suggested based on recent chats.',
      questions_you_will_answer: [
        'What is this about?',
        'Why does it matter now?',
        'How do I apply it?',
        'What should I watch out for?',
      ],
      modules,
      source_chat_ids: s?.chat_id ? [s.chat_id] : [],
      suggest_kind: 'strengthen',
      status: 'suggested',
    };
  });
  return items;
}

// Create one-liners with graceful fallback per conversation
async function buildOneLiners(conversations) {
  const existing = loadChatSummaries() || [];
  const map = new Map(existing.map(s => [s.chat_id, s]));
  const out = [];
  const diag = { step: 'summarize', ok: true, count: 0, errors: [] };
  const now = Date.now();

  for (const c of conversations || []) {
    const msgs = Array.isArray(c.messages) ? c.messages : [];
    if (msgs.length === 0) continue;
    const prev = map.get(c.id);
    const parsedTs = Date.parse(msgs[msgs.length - 1]?.timestamp || '');
    const latestTs = Number.isFinite(parsedTs) && parsedTs > 0 ? parsedTs : (Date.parse(prev?.timestamp || '') || now);
    const prevTs = Date.parse(prev?.timestamp || '') || 0;
    const hasNew = latestTs > prevTs;
    if (prev && !hasNew) {
      out.push({ ...prev, active_thread: (now - latestTs) < 5 * 24 * 60 * 60 * 1000 });
      continue;
    }
    // Try model; if it fails, fallback to a naive summary
    const recentSlice = msgs.slice(-12);
    const recentText = recentSlice.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const fingerprint = tinyHash(recentSlice.map(m => `${m.role}:${m.content}`).join('\n'));
    const message = { role: 'user', content: `${summarizerPrompt}\n\nTEXT: <<<CHAT_EXCERPT>>>\n${recentText}` };
    try {
      const { response } = await callModel([message]);
      const parsed = safeParse(response) || {};
      out.push({
        chat_id: c.id,
        user_id: 'local',
        timestamp: new Date(latestTs).toISOString(),
        fingerprint,
        one_liner: normalizeText(String(parsed.one_liner || '').slice(0, 160)),
        goal_hints: Array.isArray(parsed.goal_hints) ? parsed.goal_hints.slice(0,3).map(String) : [],
        used_in_course_id: prev?.used_in_course_id || null,
        active_thread: (now - latestTs) < 5 * 24 * 60 * 60 * 1000,
        difficulty_hint: ['beginner','intermediate','advanced'].includes(String(parsed.difficulty_hint||'').toLowerCase()) ? String(parsed.difficulty_hint) : 'beginner',
      });
    } catch (e) {
      // Fallback: use last user message as a one-liner
      diag.ok = false;
      diag.errors.push(e?.message || String(e));
      const lastUser = [...msgs].reverse().find(m => m.role === 'user');
      const guess = (lastUser?.content || msgs[msgs.length - 1]?.content || '').split(/\n+/)[0];
      out.push({
        chat_id: c.id,
        user_id: 'local',
        timestamp: new Date(latestTs).toISOString(),
        one_liner: normalizeText(String(guess || 'Follow-up learning topic').slice(0, 160)),
        goal_hints: [],
        used_in_course_id: prev?.used_in_course_id || null,
        active_thread: (now - latestTs) < 5 * 24 * 60 * 60 * 1000,
        difficulty_hint: 'beginner',
      });
    }
  }

  saveChatSummaries(out);
  diag.count = out.length;
  return { oneLiners: out, diag };
}

// Prefer stored summaries; refresh only missing or outdated per-conversation
async function refreshSummariesIfNeeded(conversations) {
  const stored = loadChatSummaries() || [];
  const byId = new Map(stored.map(s => [s.chat_id, s]));
  const out = [];
  const now = Date.now();
  const diag = { step: 'summaries_refreshed', ok: true, count: 0, refreshed: 0, reused: 0, created: 0, errors: [] };

  for (const c of conversations || []) {
    const msgs = Array.isArray(c.messages) ? c.messages : [];
    if (msgs.length === 0) continue;
    const latestTs = Date.parse(msgs[msgs.length - 1]?.timestamp || '') || now;
    const prev = byId.get(c.id);
      const prevTs = Date.parse(prev?.timestamp || '') || 0;
      const recentSlice = msgs.slice(-12);
      const fingerprint = tinyHash(recentSlice.map(m => `${m.role}:${m.content}`).join('\n'));
      const needsUpdate = !prev || (prev.fingerprint && prev.fingerprint !== fingerprint) || latestTs > prevTs;

    if (!needsUpdate && prev) {
      out.push(prev);
      diag.reused++;
      continue;
    }

    // Generate only for missing/outdated
    const recentText = recentSlice.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const message = { role: 'user', content: `${summarizerPrompt}\n\nTEXT: <<<CHAT_EXCERPT>>>\n${recentText}` };
    try {
      const { response } = await callModel([message]);
      const parsed = safeParse(response) || {};
      const rec = {
        chat_id: c.id,
        user_id: 'local',
        timestamp: new Date(latestTs).toISOString(),
        fingerprint,
        one_liner: normalizeText(String(parsed.one_liner || '').slice(0, 160)),
        goal_hints: Array.isArray(parsed.goal_hints) ? parsed.goal_hints.slice(0,3).map(String) : [],
        used_in_course_id: prev?.used_in_course_id || null,
        active_thread: (now - latestTs) < 5 * 24 * 60 * 60 * 1000,
        difficulty_hint: ['beginner','intermediate','advanced'].includes(String(parsed.difficulty_hint||'').toLowerCase()) ? String(parsed.difficulty_hint) : 'beginner',
      };
      out.push(rec);
      diag.created += prev ? 0 : 1;
      diag.refreshed += prev ? 1 : 0;
    } catch (e) {
      diag.ok = false;
      diag.errors.push(e?.message || String(e));
      // Fallback if we had a previous summary: keep it; else naive one-line
      if (prev) {
        out.push(prev);
      } else {
        const lastUser = [...msgs].reverse().find(m => m.role === 'user');
        const guess = (lastUser?.content || msgs[msgs.length - 1]?.content || '').split(/\n+/)[0];
        out.push({
          chat_id: c.id,
          user_id: 'local',
          timestamp: new Date(latestTs).toISOString(),
          fingerprint,
          one_liner: normalizeText(String(guess || 'Follow-up learning topic').slice(0, 160)),
          goal_hints: [],
          used_in_course_id: null,
          active_thread: (now - latestTs) < 5 * 24 * 60 * 60 * 1000,
          difficulty_hint: 'beginner',
        });
        diag.created += 1;
      }
    }
  }

  saveChatSummaries(out);
  diag.count = out.length;
  return { oneLiners: out, diag };
}

function sanitizeTopicDeciderItems(list) {
  const items = Array.isArray(list) ? list : [];
  return items.slice(0, 9).map((p, idx) => {
    const modules = Array.isArray(p?.module_outline) ? p.module_outline.slice(0,4).map((m, i) => ({
      idx: Number(m?.idx || i+1),
      title: String(m?.title || `Module ${i+1}`),
      est_minutes: clampMinutes(Number(m?.est_minutes) || 5),
    })) : [];
    const qs = Array.isArray(p?.questions_you_will_answer) ? p.questions_you_will_answer.slice(0,4).map(String) : [];
    const chatIds = Array.isArray(p?.source_chat_ids) ? p.source_chat_ids.map(String) : [];
    const kind = (p?.suggest_kind === 'explore' || p?.suggest_kind === 'strengthen') ? p.suggest_kind : (chatIds.length > 0 ? 'strengthen' : 'explore');
    return {
      course_id: `crs_${Date.now()}_${idx}_${Math.random().toString(36).slice(2,6)}`,
      user_id: 'local',
      goal: String(p?.goal || '').slice(0, 80),
      title: String(p?.course_title || 'Untitled').slice(0, 120),
      why_suggested: String(p?.reason || '').slice(0, 200),
      questions_you_will_answer: qs,
      modules,
      source_chat_ids: chatIds,
      suggest_kind: kind,
      status: 'suggested',
    };
  });
}

// Standalone function to generate all missing summaries (useful for pre-populating from chat mode)
export async function generateMissingSummaries({ conversations, preferredModel = 'gemini-2.5-flash-lite' }) {
  const existing = loadChatSummaries() || [];
  const byId = new Map(existing.map(s => [s.chat_id, s]));
  const out = [];
  const now = Date.now();
  const stats = { total: 0, existing: 0, generated: 0, failed: 0 };

  for (const c of conversations || []) {
    const msgs = Array.isArray(c.messages) ? c.messages : [];
    if (msgs.length === 0) continue;
    
    stats.total++;
    const prev = byId.get(c.id);
    const latestTs = Date.parse(msgs[msgs.length - 1]?.timestamp || '') || now;
    const prevTs = Date.parse(prev?.timestamp || '') || 0;
    const recentSlice = msgs.slice(-12);
    const fingerprint = tinyHash(recentSlice.map(m => `${m.role}:${m.content}`).join('\n'));
    const needsUpdate = !prev || (prev.fingerprint && prev.fingerprint !== fingerprint) || latestTs > prevTs;

    if (!needsUpdate && prev) {
      out.push(prev);
      stats.existing++;
      continue;
    }

    // Generate for missing/outdated
    const recentText = recentSlice.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const message = { role: 'user', content: `${summarizerPrompt}\n\nTEXT: <<<CHAT_EXCERPT>>>\n${recentText}` };
    try {
      const { response } = await callModel([message], preferredModel);
      const parsed = safeParse(response) || {};
      const rec = {
        chat_id: c.id,
        user_id: 'local',
        timestamp: new Date(latestTs).toISOString(),
        fingerprint,
        one_liner: normalizeText(String(parsed.one_liner || '').slice(0, 160)),
        goal_hints: Array.isArray(parsed.goal_hints) ? parsed.goal_hints.slice(0,3).map(String) : [],
        used_in_course_id: prev?.used_in_course_id || null,
        active_thread: (now - latestTs) < 5 * 24 * 60 * 60 * 1000,
        difficulty_hint: ['beginner','intermediate','advanced'].includes(String(parsed.difficulty_hint||'').toLowerCase()) ? String(parsed.difficulty_hint) : 'beginner',
      };
      out.push(rec);
      stats.generated++;
    } catch (e) {
      stats.failed++;
      // Fallback if we had a previous summary: keep it; else naive one-line
      if (prev) {
        out.push(prev);
      } else {
        const lastUser = [...msgs].reverse().find(m => m.role === 'user');
        const guess = (lastUser?.content || msgs[msgs.length - 1]?.content || '').split(/\n+/)[0];
        out.push({
          chat_id: c.id,
          user_id: 'local',
          timestamp: new Date(latestTs).toISOString(),
          fingerprint,
          one_liner: normalizeText(String(guess || 'Follow-up learning topic').slice(0, 160)),
          goal_hints: [],
          used_in_course_id: null,
          active_thread: (now - latestTs) < 5 * 24 * 60 * 60 * 1000,
          difficulty_hint: 'beginner',
        });
      }
    }
  }

  saveChatSummaries(out);
  return { summaries: out, stats };
}

export async function generateLearnProposalsSimple({ conversations, useExistingSummaries = true }) {
  const diags = [];

  // 1) Get one-liners: prefer existing summaries; build only if missing; refresh only missing/outdated
  let oneLiners = [];
  let summarizeDiag = { step: 'summarize', ok: true, count: 0, errors: [] };
  if (useExistingSummaries) {
    try {
      oneLiners = (loadChatSummaries() || []).filter(Boolean);
      summarizeDiag = { step: 'summaries_used', ok: true, count: oneLiners.length, errors: [] };
    } catch {
      oneLiners = [];
    }
  }
  if (!useExistingSummaries || oneLiners.length === 0) {
    // If we have conversations, refresh only missing/outdated; otherwise do a one-shot build
    const built = conversations && conversations.length
      ? await refreshSummariesIfNeeded(conversations)
      : await buildOneLiners(conversations);
    oneLiners = built.oneLiners;
    summarizeDiag = built.diag;
  }
  // Skip the "optional light refresh" - if we're using existing summaries, trust they're good
  // This saves time after restart when summaries are already current
  diags.push(summarizeDiag);

  // 2) Topic decider from one-liners + minimal progress
  const allCourses = loadCourses() || [];
  const progress = {
    goals: Array.from(new Set(allCourses.map(c => c.goal).filter(Boolean))),
    started: allCourses.filter(c => c.status === 'started').map(c => ({ goal: c.goal || '', title: c.title })),
    completed: allCourses.filter(c => c.status === 'completed').map(c => ({ goal: c.goal || '', title: c.title })),
  };
  const messages = [
    { role: 'user', content: `${topicDeciderPrompt}\n\nINPUT_ONE_LINERS: <<<LIST_JSON>>>\n${JSON.stringify(oneLiners)}\n\nEXISTING_GOALS: ${JSON.stringify(progress.goals)}\n\nLEARNER_PROGRESS: ${JSON.stringify(progress)}` },
  ];
  let response = '';
  let items = [];
  const tdDiag = { step: 'topic_decider', ok: true, count: 0, error: '' };
  try {
    const { response: raw, model } = await callModel(messages);
    appendDebugLog({ scope: 'learn', kind: 'topic_decider_request', model, prompt: messages[0].content });
    appendDebugLog({ scope: 'learn', kind: 'topic_decider_response', model, response: raw });
    response = raw;
    const parsed = safeParse(raw);
    if (!Array.isArray(parsed)) throw new Error('Invalid JSON array');
    items = sanitizeTopicDeciderItems(parsed);
  } catch (e) {
    tdDiag.ok = false;
    tdDiag.error = e?.message || String(e);
    // Fallback to naive proposals
    items = fallbackProposalsFromOneLiners(oneLiners);
  }
  tdDiag.count = items.length;
  diags.push(tdDiag);

  // Persist outlines: replace previous suggested with new ones; drop dismissed
  const existing = loadCourseOutlines() || [];
  const keep = existing.filter(o => o.status === 'saved' || o.status === 'started' || o.status === 'completed');
  const next = [...keep, ...items];
  saveCourseOutlines(next);
  appendDebugLog({ scope: 'learn', kind: 'learn_pipeline_summary', messages: { summaries: oneLiners.length, proposals: items.length, replacedSuggested: existing.length - keep.length } });

  return { proposals: items, diagnostics: diags, savedOutlines: next };
}
