import { sendGeminiMessage } from './gemini';
import summarizerPrompt from '../../prompts/learn/chat_summarizer.md?raw';
import topicDeciderPrompt from '../../prompts/learn/topic_decider.md?raw';
import courseGeneratorPrompt from '../../prompts/learn/course_generator.md?raw';
import goalRegroupPrompt from '../../prompts/learn/goal_regroup.md?raw';
import { normalizeText } from '../utils/normalize';
import { appendDebugLog } from '../utils/debugConsole';
import {
  loadChatSummaries,
  saveChatSummaries,
  loadCourseOutlines,
  saveCourseOutlines,
  loadCourses,
  saveCourses,
  loadGoals,
  saveGoals,
  loadPendingCourses,
  savePendingCourses,
  loadSuppressions,
  saveSuppressions,
  appendLearnLog,
  tinyHash,
  loadPrefetchedCourses,
  savePrefetchedCourses,
  isRegrouping,
  setRegrouping,
  loadLearnModel,
} from '../utils/learnStorage';
import {
  updateCourseStatus,
  setGenerationFlag,
  isGenerating as isGeneratingCourse,
  cleanupExpiredFlags
} from '../utils/learnStateManager';

const LEARN_MODEL_CANDIDATES = [
  // Prefer Flash by default for Learn flows
  'gemini-2.5-flash',
  'gemini-2.5-flash+search',
  'gemini-2.5-pro+search',
  'gemini-2.0-flash'
];
const PERMISSION_ERROR_RE = /(permission|not (?:authorized|allowed|enabled|found)|unavailable in this region|unsupported location|insufficient scope)/i;

async function callLearnModel(messages) {
  let lastError = null;
  
  // Try user's selected model first, then fallbacks
  const selectedModel = loadLearnModel();
  const candidates = [selectedModel, ...LEARN_MODEL_CANDIDATES.filter(m => m !== selectedModel)];
  
  for (const candidate of candidates) {
    try {
      const response = await sendGeminiMessage(messages, candidate);
      return { response, model: candidate };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      err.learnModel = candidate;
      lastError = err;
      const message = String(err.message || '');
      if (!PERMISSION_ERROR_RE.test(message)) {
        throw err;
      }
    }
  }
  if (lastError) throw lastError;
  throw new Error('Gemini API Error: Learn mode requires an accessible Gemini Flash or Pro model. Update your API key in Settings.');
}

// Robust JSON parse for arbitrary LLM output
function safeParse(text) {
  try {
    const t = String(text || '').trim();
    const fenced = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    try { return JSON.parse(fenced); } catch {}
    // Attempt to extract first JSON object/array
    const idxStart = t.indexOf('{');
    const idxArr = t.indexOf('[');
    const start = (idxStart === -1) ? idxArr : (idxArr === -1 ? idxStart : Math.min(idxStart, idxArr));
    if (start >= 0) {
      for (let end = t.length; end > start + 1; end--) {
        const sub = t.slice(start, end);
        try { return JSON.parse(sub); } catch {}
      }
    }
  } catch {}
  return null;
}

function clampMinutes(n) {
  const v = Number(n) || 5;
  if (v < 3) return 3;
  if (v > 7) return 7; // per module time, not course total
  return v;
}

function normalizeLabel(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[()\[\]:,]/g, ' ')
    .replace(/\b(basics|intro|introduction|overview|fundamentals|guide|101)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/k[-\s]?means/g, 'kmeans');
}

function jaccardSim(a, b) {
  const A = new Set(normalizeLabel(a).split(' ').filter(Boolean));
  const B = new Set(normalizeLabel(b).split(' ').filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function getExistingGoalLabels() {
  const goals = loadGoals() || [];
  const courses = loadCourses() || [];
  const labels = new Set();
  for (const g of goals) if (g?.label) labels.add(g.label);
  for (const c of courses) if (c?.goal) labels.add(c.goal);
  return Array.from(labels);
}

// Build or refresh one-line summaries for recent conversations
export async function buildOneLinersFromConversations(conversations) {
  const existing = loadChatSummaries();
  const map = new Map(existing.map(s => [s.chat_id, s]));
  const out = [];
  const now = Date.now();

  for (const c of conversations || []) {
    // Skip entirely empty convos
    const msgs = Array.isArray(c.messages) ? c.messages : [];
    if (msgs.length === 0) continue;
    // Consider if we already have a fresh summary
    const prev = map.get(c.id);
    const latestTs = Date.parse(msgs[msgs.length - 1]?.timestamp || '') || now;
    const prevTs = Date.parse(prev?.timestamp || '') || 0;
    const hasNewMessages = latestTs > prevTs;
    // If we have a previous summary and there are no new messages, reuse it
    if (prev && !hasNewMessages) {
      // Active window: 5 days
      out.push({ ...prev, active_thread: (now - latestTs) < 5 * 24 * 60 * 60 * 1000 });
      continue;
    }

    // Build short excerpt to keep token-light
    const recentText = msgs.slice(-12).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const message = { role: 'user', content: `${summarizerPrompt}\n\nTEXT: <<<CHAT_EXCERPT>>>\n${recentText}` };
    try {
      const { response: raw } = await callLearnModel([message]);
      const parsed = safeParse(raw) || {};
      const s = {
        chat_id: c.id,
        user_id: 'local',
        timestamp: new Date(latestTs).toISOString(),
        one_liner: normalizeText(String(parsed.one_liner || '').slice(0, 160)),
        goal_hints: Array.isArray(parsed.goal_hints) ? parsed.goal_hints.slice(0, 3).map(x => String(x)) : [],
        used_in_course_id: prev?.used_in_course_id || null,
        // Active window: 5 days
        active_thread: (now - latestTs) < 5 * 24 * 60 * 60 * 1000,
        difficulty_hint: ['beginner','intermediate','advanced'].includes(String(parsed.difficulty_hint||'').toLowerCase()) ? String(parsed.difficulty_hint) : 'beginner',
      };
      out.push(s);
    } catch {
      // If summarization fails, keep previous if any (same 5-day active window)
      if (prev) out.push({ ...prev, active_thread: (now - latestTs) < 5 * 24 * 60 * 60 * 1000 });
    }
  }

  saveChatSummaries(out);
  return out;
}

// Propose mini-course outlines
export async function proposeMiniCourseOutlines({ oneLiners }) {
  const filtered = (oneLiners || []); // Use all summaries
  if (filtered.length === 0) return [];

  // Build compact learner progress summary to inform generation
  const allCourses = loadCourses() || [];
  const progress = {
    goals: getExistingGoalLabels(),
    started: allCourses.filter(c => c.status === 'started').map(c => ({ goal: c.goal || '', title: c.title })),
    completed: allCourses.filter(c => c.status === 'completed').map(c => ({ goal: c.goal || '', title: c.title })),
  };

  const messages = [
    { role: 'user', content: `${topicDeciderPrompt}\n\nINPUT_ONE_LINERS: <<<LIST_JSON>>>\n${JSON.stringify(filtered)}\n\nEXISTING_GOALS: ${JSON.stringify(getExistingGoalLabels())}\n\nLEARNER_PROGRESS: ${JSON.stringify(progress)}` },
  ];
  let raw;
  let usedModel;
  try {
    ({ response: raw, model: usedModel } = await callLearnModel(messages));
  } catch (error) {
    appendDebugLog({ scope: 'learn', kind: 'topic_decider_error', model: error?.learnModel || 'auto', prompt: messages[0].content, error: error?.stack || error?.message || String(error) });
    throw error;
  }
  appendDebugLog({ scope: 'learn', kind: 'topic_decider_request', model: usedModel, prompt: messages[0].content });
  appendDebugLog({ scope: 'learn', kind: 'topic_decider_response', model: usedModel, response: raw });
  const parsed = safeParse(raw);
  if (!Array.isArray(parsed)) return [];

  // Sanitize and apply constraints
  const items = parsed.slice(0, 9).map((p, idx) => {
    const title = String(p?.course_title || 'Untitled').trim();
    // Use the provided goal as a local tag only; do not force-match to existing goals
    const goal = String(p?.goal || '').trim();
    const questions = Array.isArray(p?.questions_you_will_answer) ? p.questions_you_will_answer.slice(0, 4).map(String) : [];
    const modules = Array.isArray(p?.module_outline) ? p.module_outline.slice(0, 4).map((m, i) => ({ idx: i+1, title: String(m?.title || `Module ${i+1}`), est_minutes: clampMinutes(Number(m?.est_minutes) || 5) })) : [];
    const chatIds = Array.isArray(p?.source_chat_ids) ? p.source_chat_ids.map(String) : [];
    const suggest_kind = (p?.suggest_kind === 'explore' || p?.suggest_kind === 'strengthen')
      ? p.suggest_kind
      : (chatIds.length > 0 ? 'strengthen' : 'explore');
    return {
      course_id: `crs_${Date.now()}_${idx}_${Math.random().toString(36).slice(2,6)}`,
      user_id: 'local',
      goal,
      title,
      why_suggested: String(p?.reason || '').slice(0, 200),
      questions_you_will_answer: questions,
      modules,
      source_chat_ids: chatIds,
      suggest_kind,
      status: 'suggested',
    };
  });

  // No deduplication - save all generated outlines
  if (items.length > 0) {
    const existing = loadCourseOutlines();
    const nextOutlines = [...existing, ...items];
    saveCourseOutlines(nextOutlines);
    
    // Mark chat summaries as used (best-effort)
    const summaries = loadChatSummaries();
    const assignment = new Map();
    for (const d of items) {
      for (const cid of d.source_chat_ids || []) {
        if (!assignment.has(cid)) assignment.set(cid, d.course_id);
      }
    }
    const updatedSummaries = summaries.map(s => {
      if (s.used_in_course_id) return s;
      const assigned = assignment.get(s.chat_id);
      return assigned ? { ...s, used_in_course_id: assigned } : s;
    });
    saveChatSummaries(updatedSummaries);
  }

  return items;
}

// Generate full course content when user presses Start
export async function generateFullCourse({ outline, conversations, avoidOutlines = [] }) {
  // Clean up expired flags first
  cleanupExpiredFlags();
  
  // Never regenerate if a saved course already exists for this id
  try {
    const existing = (loadCourses() || []).find(c => c.course_id === outline?.course_id);
    if (existing) {
      // Ensure outline reflects current status for consistency
      updateCourseStatus(outline.course_id, existing.status);
      return existing;
    }
  } catch {}
  
  // Set generation flag to prevent concurrent attempts
  setGenerationFlag(outline.course_id, true);
  const sourceIds = Array.isArray(outline?.source_chat_ids) ? outline.source_chat_ids : [];
  const excerpts = [];
  for (const cid of sourceIds) {
    const conv = (conversations || []).find(c => c.id === cid);
    if (!conv) continue;
    const msgs = (conv.messages || []).slice(-14);
    excerpts.push(`CHAT ${cid}:\n` + msgs.map(m => `${m.role === 'user' ? 'U' : 'A'}: ${m.content}`).join('\n'));
  }
  const input = [
    `INPUT_OUTLINE: <<<OUTLINE_JSON>>>\n${JSON.stringify({
      title: outline.title,
      goal: outline.goal,
      questions_you_will_answer: outline.questions_you_will_answer,
      modules: outline.modules,
    })}`,
    `\nRELEVANT_CHAT_EXCERPTS: <<<TEXT>>>\n${excerpts.join('\n\n')}`,
    `\nAVOID_OUTLINES: <<<LIST_JSON>>>\n${JSON.stringify(avoidOutlines.map(o => ({ title: o.title, gist: (o.questions_you_will_answer || []).join(' | ') })))}\n`,
  ].join('\n');

  const cgMsg = { role: 'user', content: `${courseGeneratorPrompt}\n\n${input}` };
  let raw;
  let usedModel;
  try {
    ({ response: raw, model: usedModel } = await callLearnModel([cgMsg]));
  } catch (error) {
    // Clear generation flag on error
    setGenerationFlag(outline.course_id, false);
    appendDebugLog({ scope: 'learn', kind: 'course_generator_error', model: error?.learnModel || 'auto', prompt: cgMsg.content, error: error?.stack || error?.message || String(error) });
    throw error;
  }
  appendDebugLog({ scope: 'learn', kind: 'course_generator_request', model: usedModel, prompt: cgMsg.content });
  appendDebugLog({ scope: 'learn', kind: 'course_generator_response', model: usedModel, response: raw });
  const parsed = safeParse(raw);
  if (!parsed || !Array.isArray(parsed.modules)) {
    // Clear generation flag on parse error
    setGenerationFlag(outline.course_id, false);
    throw new Error('Course generation returned invalid JSON. Try again.');
  }

  // Build course object
  const course = {
    course_id: outline.course_id,
    user_id: 'local',
    goal: outline.goal,
    title: parsed.title || outline.title,
    questions_you_will_answer: Array.isArray(parsed.questions_you_will_answer) && parsed.questions_you_will_answer.length === 4
      ? parsed.questions_you_will_answer.map(String)
      : outline.questions_you_will_answer,
    modules: parsed.modules.map((m, i) => ({
      module_id: m.module_id || `${outline.course_id}_m${i+1}`,
      idx: Number(m.idx || i+1),
      title: String(m.title || outline.modules?.[i]?.title || `Module ${i+1}`),
      est_minutes: clampMinutes(Number(m.est_minutes || outline.modules?.[i]?.est_minutes || 5)),
      lesson: normalizeText(String(m.lesson || '')),
      micro_task: '',
      quiz: Array.isArray(m.quiz) ? m.quiz.slice(0,2).map(q => ({
        prompt: normalizeText(String(q?.prompt || '')),
        choices: Array.isArray(q?.choices) ? q.choices.slice(0,5).map(String) : [],
        answer_index: Number.isInteger(q?.answer_index) ? q.answer_index : 0,
      })) : [],
      refs: Array.isArray(m.refs) ? m.refs.map(String) : [],
    })),
    where_to_go_next: String(parsed.where_to_go_next || ''),
    status: 'started',
    progress_by_module: {},
    completed_via: null,
  };
  for (const m of course.modules) course.progress_by_module[m.module_id] = 'not_started';

  // If outline has been dismissed meanwhile, abort saving to avoid reviving removed items
  try {
    const outlinesNow = loadCourseOutlines();
    const match = (outlinesNow || []).find(o => o.course_id === outline.course_id);
    if (match && match.status === 'dismissed') {
      setGenerationFlag(outline.course_id, false);
      throw new Error('Generation cancelled: outline dismissed');
    }
  } catch (error) {
    setGenerationFlag(outline.course_id, false);
    throw error;
  }

  // Persist courses and update outline status atomically
  try {
    const existingCourses = loadCourses();
    const nextCourses = [course, ...existingCourses.filter(c => c.course_id !== course.course_id)];
    saveCourses(nextCourses);

    // Update outline status to match course status
    const outlines = loadCourseOutlines() || [];
    const updatedOutlines = outlines.map(o =>
      o.course_id === course.course_id ? { ...o, status: 'started' } : o
    );
    saveCourseOutlines(updatedOutlines);

    // Verify course was saved
    const verify = (loadCourses() || []).some(c => c.course_id === course.course_id && c.status === 'started');
    if (!verify) {
      throw new Error('Course save verification failed - data may not have persisted correctly');
    }
  } catch (saveError) {
    // Clear generation flag on save failure
    setGenerationFlag(outline.course_id, false);
    
    // Provide helpful error message
    const errorMsg = saveError.message || String(saveError);
    if (errorMsg.includes('localStorage') || errorMsg.includes('quota')) {
      throw new Error('Failed to save course: Browser storage is full. Try clearing some space or completing existing courses.');
    }
    throw new Error(`Failed to save course: ${errorMsg}`);
  }

  // Clean up any prefetched cache for this course id
  try {
    const cache = loadPrefetchedCourses() || {};
    if (cache[course.course_id]) {
      delete cache[course.course_id];
      savePrefetchedCourses(cache);
    }
  } catch {}

  // Clear generation flag on success
  setGenerationFlag(outline.course_id, false);
  
  appendLearnLog({ type: 'course_started', course_id: course.course_id });
  return course;
}

// Prefetch full course content without changing user progress/state
export async function prefetchCourseContent({ outline, conversations, avoidOutlines = [] }) {
  // If course already exists, do not regenerate or cache
  try {
    const existing = (loadCourses() || []).find(c => c.course_id === outline?.course_id);
    if (existing) return existing;
  } catch {}
  
  // Check if already generating (user-initiated takes priority)
  if (isGeneratingCourse(outline.course_id)) {
    return null; // Let user-initiated generation proceed
  }
  
  // Set flag to prevent concurrent generation
  setGenerationFlag(outline.course_id, true);
  const sourceIds = Array.isArray(outline?.source_chat_ids) ? outline.source_chat_ids : [];
  const excerpts = [];
  for (const cid of sourceIds) {
    const conv = (conversations || []).find(c => c.id === cid);
    if (!conv) continue;
    const msgs = (conv.messages || []).slice(-14);
    excerpts.push(`CHAT ${cid}:\n` + msgs.map(m => `${m.role === 'user' ? 'U' : 'A'}: ${m.content}`).join('\n'));
  }
  const input = [
    `INPUT_OUTLINE: <<<OUTLINE_JSON>>>\n${JSON.stringify({
      title: outline.title,
      goal: outline.goal,
      questions_you_will_answer: outline.questions_you_will_answer,
      modules: outline.modules,
    })}`,
    `\nRELEVANT_CHAT_EXCERPTS: <<<TEXT>>>\n${excerpts.join('\n\n')}`,
    `\nAVOID_OUTLINES: <<<LIST_JSON>>>\n${JSON.stringify(avoidOutlines.map(o => ({ title: o.title, gist: (o.questions_you_will_answer || []).join(' | ') })))}\n`,
  ].join('\n');

  const cgMsg = { role: 'user', content: `${courseGeneratorPrompt}\n\n${input}` };
  let raw;
  try {
    ({ response: raw } = await callLearnModel([cgMsg]));
  } catch (error) {
    // Clear flag on error
    setGenerationFlag(outline.course_id, false);
    appendDebugLog({ scope: 'learn', kind: 'course_prefetch_error', model: error?.learnModel || 'auto', prompt: cgMsg.content, error: error?.stack || error?.message || String(error) });
    throw error;
  }
  appendDebugLog({ scope: 'learn', kind: 'course_prefetch_request', model: 'auto', prompt: cgMsg.content });
  appendDebugLog({ scope: 'learn', kind: 'course_prefetch_response', model: 'auto', response: raw });
  const parsed = safeParse(raw);
  if (!parsed || !Array.isArray(parsed.modules)) {
    // Clear flag on parse error
    setGenerationFlag(outline.course_id, false);
    throw new Error('Course prefetch returned invalid JSON.');
  }

  const course = {
    course_id: outline.course_id,
    user_id: 'local',
    goal: outline.goal,
    title: parsed.title || outline.title,
    questions_you_will_answer: Array.isArray(parsed.questions_you_will_answer) && parsed.questions_you_will_answer.length === 4
      ? parsed.questions_you_will_answer.map(String)
      : outline.questions_you_will_answer,
    modules: parsed.modules.map((m, i) => ({
      module_id: m.module_id || `${outline.course_id}_m${i+1}`,
      idx: Number(m.idx || i+1),
      title: String(m.title || outline.modules?.[i]?.title || `Module ${i+1}`),
      est_minutes: clampMinutes(Number(m.est_minutes || outline.modules?.[i]?.est_minutes || 5)),
      lesson: normalizeText(String(m.lesson || '')),
      micro_task: '',
      quiz: Array.isArray(m.quiz) ? m.quiz.slice(0,2).map(q => ({
        prompt: normalizeText(String(q?.prompt || '')),
        choices: Array.isArray(q?.choices) ? q.choices.slice(0,5).map(String) : [],
        answer_index: Number.isInteger(q?.answer_index) ? q.answer_index : 0,
      })) : [],
      refs: Array.isArray(m.refs) ? m.refs.map(String) : [],
    })),
    where_to_go_next: String(parsed.where_to_go_next || ''),
    status: 'prefetched',
    progress_by_module: Object.fromEntries((outline.modules || []).map((m, i) => [`${outline.course_id}_m${i+1}`, 'not_started'])),
    completed_via: null,
  };
  for (const m of course.modules) course.progress_by_module[m.module_id] = 'not_started';

  // Save into prefetch cache
  const cache = loadPrefetchedCourses() || {};
  cache[course.course_id] = course;
  savePrefetchedCourses(cache);
  
  // Clear generation flag on success
  setGenerationFlag(outline.course_id, false);
  
  return course;
}

export function markSaved(outline) {
  const outlines = loadCourseOutlines();
  const next = outlines.map(o => o.course_id === outline.course_id ? { ...o, status: 'saved' } : o);
  saveCourseOutlines(next);
}

export function markDismissed(outline) {
  const outlines = loadCourseOutlines();
  const next = outlines.map(o => o.course_id === outline.course_id ? { ...o, status: 'dismissed' } : o);
  saveCourseOutlines(next);
  const suppress = loadSuppressions();
  suppress[outline.title] = true;
  saveSuppressions(suppress);
}

export async function markAlreadyKnowIt(outline) {
  // Atomically mark as completed via self-report
  const courses = loadCourses();
  const hasCourse = courses.some(c => c.course_id === outline.course_id);
  
  if (!hasCourse) {
    // Create a tiny shell record so we can show completion
    const course = {
      course_id: outline.course_id,
      user_id: 'local',
      goal: outline.goal,
      title: outline.title,
      questions_you_will_answer: outline.questions_you_will_answer,
      modules: outline.modules.map((m, i) => ({ 
        module_id: `${outline.course_id}_m${i+1}`, 
        idx: i+1, 
        title: m.title, 
        est_minutes: m.est_minutes, 
        lesson: '', 
        micro_task: '', 
        quiz: [],
        refs: [] 
      })),
      where_to_go_next: '',
      status: 'completed',
      progress_by_module: Object.fromEntries(outline.modules.map((m, i) => [`${outline.course_id}_m${i+1}`, 'done'])),
      completed_via: 'self_report',
    };
    saveCourses([course, ...courses]);
  } else {
    // Update existing
    const next = courses.map(c => c.course_id === outline.course_id ? { 
      ...c, 
      status: 'completed', 
      completed_via: 'self_report', 
      progress_by_module: Object.fromEntries(c.modules.map(m => [m.module_id, 'done'])) 
    } : c);
    saveCourses(next);
  }

  // Update outline status to match course status
  const outlines = loadCourseOutlines() || [];
  const updatedOutlines = outlines.map(o =>
    o.course_id === outline.course_id ? { ...o, status: 'completed' } : o
  );
  saveCourseOutlines(updatedOutlines);
  
  // Add to pending for regrouping
  try {
    const pending = new Set(loadPendingCourses() || []);
    pending.add(outline.course_id);
    savePendingCourses(Array.from(pending));
  } catch {}
}

export async function setModuleProgress(courseId, moduleId, status) {
  const courses = loadCourses();
  const next = courses.map(c => {
    if (c.course_id !== courseId) return c;
    const pbm = { ...(c.progress_by_module || {}) };
    pbm[moduleId] = status;
    // Derive course status
    const vals = Object.values(pbm);
    const allDone = vals.length > 0 && vals.every(v => v === 'done');
    const newStatus = allDone ? 'completed' : 'started';
    return { ...c, progress_by_module: pbm, status: newStatus };
  });
  saveCourses(next);

  // Sync outline status with course status immediately
  const course = next.find(c => c.course_id === courseId);
  if (course) {
    const outlines = loadCourseOutlines() || [];
    const updatedOutlines = outlines.map(o =>
      o.course_id === courseId ? { ...o, status: course.status } : o
    );
    saveCourseOutlines(updatedOutlines);

    // If course completed, add to pending immediately
    if (course.status === 'completed') {
      const pending = new Set(loadPendingCourses() || []);
      pending.add(courseId);
      savePendingCourses(Array.from(pending));
    }

    const goals = loadGoals();
    const gIdx = goals.findIndex(g => g.label === course.goal);
    if (gIdx === -1) {
      goals.push({ 
        goal_id: `g_${tinyHash(course.goal)}`, 
        user_id: 'local', 
        label: course.goal, 
        completed_courses: course.status === 'completed' ? [courseId] : [], 
        started_courses: course.status === 'completed' ? [] : [courseId], 
        suggested_or_saved: [] 
      });
    } else {
      const g = goals[gIdx];
      const started = new Set(g.started_courses || []);
      const done = new Set(g.completed_courses || []);
      if (course.status === 'completed') {
        done.add(courseId);
        started.delete(courseId);
      } else {
        started.add(courseId);
      }
      goals[gIdx] = { ...g, started_courses: Array.from(started), completed_courses: Array.from(done) };
    }
    saveGoals(goals);
  }
}

// Regroup a completed course under an existing or new goal, with optional rename of an existing goal
export async function regroupAfterCompletion(_courseId) {
  // Backward-compatible no-op; regroup is handled globally in regroupAllCompleted
  return regroupAllCompleted();
}

// Regroup all completed items lacking a canonical goal or with non-canonical labels
export async function regroupAllCompleted() {
  // LLM-only regrouping: send ALL pending items + existing canonical groups to the prompt.
  const courses = loadCourses() || [];
  let goals = Array.isArray(loadGoals()) ? loadGoals() : [];
  const pendingSet = new Set(loadPendingCourses() || []);

  // Seed pending with any completed courses not part of any canonical group
  const groupCourseIds = new Set([].concat(...(goals || []).map(g => Array.isArray(g.completed_courses) ? g.completed_courses : [])));
  for (const c of courses) {
    if (c.status === 'completed' && !groupCourseIds.has(c.course_id)) pendingSet.add(c.course_id);
  }

  // Build lookup helpers
  const byId = new Map(courses.map(c => [c.course_id, c]));
  const canonicalGoals = (goals || []).filter(g => Array.isArray(g.completed_courses) && g.completed_courses.length >= 2);

  // Prepare compact inputs for the LLM
  const pendingCourses = Array.from(pendingSet).map(id => byId.get(id)).filter(Boolean);
  const pendingBrief = pendingCourses.map(c => ({
    id: c.course_id,
    title: c.title || '',
    tag: c.goal || '',
    questions: Array.isArray(c.questions_you_will_answer) ? c.questions_you_will_answer.slice(0,4) : [],
    modules: (Array.isArray(c.modules) ? c.modules : []).slice(0,6).map(m => m.title || ''),
  }));
  const existingBrief = canonicalGoals.map(g => ({
    label: g.label,
    members: (g.completed_courses || []).map(cid => byId.get(cid)).filter(Boolean).slice(0, 12).map(m => ({
      id: m.course_id,
      title: m.title || '',
      modules: (Array.isArray(m.modules) ? m.modules : []).slice(0,4).map(x => x.title || ''),
    })),
  }));

  // If nothing pending, nothing to regroup
  if (pendingBrief.length === 0) {
    return { regrouped: 0, pending: pendingSet.size, groups: canonicalGoals.length };
  }

  const msg = {
    role: 'user',
    content: `${goalRegroupPrompt}\n\nPENDING_COURSES: ${JSON.stringify(pendingBrief)}\nEXISTING_GROUPS: ${JSON.stringify(existingBrief)}`,
  };
  let raw, usedModel;
  try {
    ({ response: raw, model: usedModel } = await callLearnModel([msg]));
  } catch (error) {
    appendDebugLog({ scope: 'learn', kind: 'goal_regroup_error', model: error?.learnModel || 'auto', prompt: msg.content, error: error?.stack || error?.message || String(error) });
    // On failure, keep state unchanged
    return { regrouped: 0, pending: pendingSet.size, groups: canonicalGoals.length };
  }
  appendDebugLog({ scope: 'learn', kind: 'goal_regroup_request', model: usedModel, prompt: msg.content });
  appendDebugLog({ scope: 'learn', kind: 'goal_regroup_response', model: usedModel, response: raw });
  const parsed = safeParse(raw) || {};

  const renameOps = Array.isArray(parsed.rename) ? parsed.rename : [];
  const addOps = Array.isArray(parsed.add_to_existing) ? parsed.add_to_existing : [];
  const newOps = Array.isArray(parsed.new_groups) ? parsed.new_groups : [];
  const leaveSet = new Set(Array.isArray(parsed.leave_pending) ? parsed.leave_pending : []);

  // Build label index for existing goals (case-insensitive match)
  const findGoalIndexByLabel = (label) => {
    const exact = (goals || []).findIndex(g => String(g.label || '') === String(label || ''));
    if (exact >= 0) return exact;
    const ci = (goals || []).findIndex(g => String(g.label || '').toLowerCase() === String(label || '').toLowerCase());
    return ci;
  };

  // Apply renames first
  for (const op of renameOps) {
    const from = String(op?.from || '').trim();
    const to = String(op?.to || '').trim();
    if (!from || !to) continue;
    const idx = findGoalIndexByLabel(from);
    if (idx < 0) continue;
    // If target label already exists, merge groups
    const existingIdx = findGoalIndexByLabel(to);
    if (existingIdx >= 0 && existingIdx !== idx) {
      const a = goals[idx];
      const b = goals[existingIdx];
      const combined = Array.from(new Set([...(a.completed_courses||[]), ...(b.completed_courses||[])]));
      goals[existingIdx] = { ...b, label: to, completed_courses: combined };
      goals.splice(idx, 1);
    } else {
      goals[idx] = { ...goals[idx], label: to };
    }
  }

  // Add pending to existing labels
  const assigned = new Set();
  for (const op of addOps) {
    const cid = String(op?.course_id || '').trim();
    const target = String(op?.target_label || '').trim();
    if (!cid || !target) continue;
    const gi = findGoalIndexByLabel(target);
    if (gi < 0) continue; // target group must exist
    const g = goals[gi];
    const set = new Set(g.completed_courses || []);
    if (byId.has(cid)) { set.add(cid); assigned.add(cid); }
    goals[gi] = { ...g, completed_courses: Array.from(set) };
  }

  // Create new groups with >= 2 members
  for (const op of newOps) {
    const label = String(op?.label || '').trim();
    const members = Array.isArray(op?.members) ? op.members.filter(id => byId.has(String(id))) : [];
    if (!label || members.length < 2) continue;
    // If label collides with existing, just add members there
    const gi = findGoalIndexByLabel(label);
    if (gi >= 0) {
      const g = goals[gi];
      const set = new Set(g.completed_courses || []);
      for (const id of members) { set.add(String(id)); assigned.add(String(id)); }
      goals[gi] = { ...g, completed_courses: Array.from(set) };
    } else {
      goals.push({ goal_id: `g_${tinyHash(label)}`, user_id: 'local', label, completed_courses: members.map(String), started_courses: [], suggested_or_saved: [] });
      for (const id of members) assigned.add(String(id));
    }
  }

  // Compute still-pending: anything not assigned remains pending
  const stillPending = new Set(pendingSet);
  for (const id of assigned) stillPending.delete(id);
  // Leave-pending instructions are implicit; no-op here.

  // Keep only canonical groups (>=2) and dedupe membership
  const canonical = [];
  for (const g of goals) {
    const comp = Array.from(new Set(g.completed_courses || []));
    if (comp.length >= 2) {
      canonical.push({ ...g, completed_courses: comp });
      for (const id of comp) stillPending.delete(id);
    }
  }

  saveGoals(canonical);
  savePendingCourses(Array.from(stillPending));

  appendDebugLog({ scope: 'learn', kind: 'goal_regroup_applied', summary: { renamed: renameOps.length, added: addOps.length, new_groups: newOps.length, assigned: assigned.size, pending_after: stillPending.size, groups_after: canonical.length } });
  return { regrouped: assigned.size, pending: stillPending.size, groups: canonical.length };
}
