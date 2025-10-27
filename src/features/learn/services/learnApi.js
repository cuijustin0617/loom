/**
 * Learn API Service
 * 
 * Adapted from original learn.js to use Zustand stores.
 * Keeps all prompts and LLM logic identical.
 */

import { sendGeminiMessage } from '../../../lib/ai/gemini';
import { normalizeText } from '../../../shared/utils/normalize';
import { useLearnStore } from '../store/learnStore';
import { useSettingsStore } from '../../../shared/store/settingsStore';
import { generateId, now } from '../../../lib/db/database';
import { autoRegroupPendingCourses, shouldTriggerAutoRegroup } from './autoOperations';

// Import prompts (unchanged)
import summarizerPrompt from '../../../prompts/learn/chat_summarizer.md?raw';
import topicDeciderPrompt from '../../../prompts/learn/topic_decider.md?raw';
import courseGeneratorPrompt from '../../../prompts/learn/course_generator.md?raw';
import goalRegroupPrompt from '../../../prompts/learn/goal_regroup.md?raw';

// Constants
const LEARN_MODEL_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-2.5-flash+search',
  'gemini-2.5-pro+search',
  'gemini-2.0-flash'
];

const PERMISSION_ERROR_RE = /(permission|not (?:authorized|allowed|enabled|found)|unavailable in this region|unsupported location|insufficient scope)/i;

/**
 * Call Learn model with fallbacks
 */
async function callLearnModel(messages) {
  let lastError = null;
  
  const selectedModel = useSettingsStore.getState().learnModel;
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
  throw new Error('Gemini API Error: Learn mode requires an accessible Gemini Flash or Pro model.');
}

/**
 * Safe JSON parse (handles LLM output)
 */
function safeParse(text) {
  try {
    const t = String(text || '').trim();
    const fenced = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    try { return JSON.parse(fenced); } catch {}
    
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

/**
 * Clamp module minutes
 */
function clampMinutes(n) {
  const v = Number(n) || 5;
  if (v < 3) return 3;
  if (v > 7) return 7;
  return v;
}

/**
 * Get existing goal labels
 */
function getExistingGoalLabels() {
  const goals = Object.values(useLearnStore.getState().goals);
  const courses = Object.values(useLearnStore.getState().courses);
  const labels = new Set();
  for (const g of goals) if (g?.label) labels.add(g.label);
  for (const c of courses) if (c?.goal) labels.add(c.goal);
  return Array.from(labels);
}

/**
 * Generate learn proposals (topic decider)
 */
export async function generateLearnProposals({ conversations, model }) {
  console.log('[LearnAPI] generateLearnProposals called');
  console.log('[LearnAPI] Conversations received:', conversations.length);
  
  // Build one-liners from conversations (simplified - full summaries handled separately)
  const oneLiners = conversations
    .filter(c => Array.isArray(c.messages) && c.messages.length > 0)
    .map(c => ({
      chat_id: c.id,
      one_liner: c.summary || c.title || 'Conversation',
      active_thread: true
    }));
  
  console.log('[LearnAPI] One-liners built:', oneLiners.length);
  
  if (oneLiners.length === 0) {
    console.log('[LearnAPI] No conversations with messages, returning empty');
    return { outlines: [] };
  }
  
  // Build learner progress
  const allCourses = Object.values(useLearnStore.getState().courses);
  const progress = {
    goals: getExistingGoalLabels(),
    started: allCourses.filter(c => c.status === 'started').map(c => ({ goal: c.goal || '', title: c.title })),
    completed: allCourses.filter(c => c.status === 'completed').map(c => ({ goal: c.goal || '', title: c.title }))
  };

  const messages = [
    { 
      role: 'user', 
      content: `${topicDeciderPrompt}\n\nINPUT_ONE_LINERS: <<<LIST_JSON>>>\n${JSON.stringify(oneLiners)}\n\nEXISTING_GOALS: ${JSON.stringify(getExistingGoalLabels())}\n\nLEARNER_PROGRESS: ${JSON.stringify(progress)}`
    }
  ];
  
  console.log('[LearnAPI] Calling topic decider with messages...');
  
  let raw, usedModel;
  try {
    ({ response: raw, model: usedModel } = await callLearnModel(messages));
    console.log('[LearnAPI] Topic decider response received, length:', raw?.length);
  } catch (error) {
    console.error('[LearnAPI] Topic decider error:', error);
    throw error;
  }
  
  console.log('[LearnAPI] Parsing response...');
  const parsed = safeParse(raw);
  console.log('[LearnAPI] Parsed result:', parsed);
  
  if (!Array.isArray(parsed)) {
    console.log('[LearnAPI] Parsed result is not an array, returning empty');
    return { outlines: [] };
  }
  
  // Build outlines
  const outlines = parsed.slice(0, 9).map((p, idx) => {
    const courseId = generateId('course');
    return {
      id: courseId,
      courseId: courseId,
      title: String(p?.course_title || 'Untitled').trim(),
      whySuggested: String(p?.reason || '').slice(0, 200),
      questions: Array.isArray(p?.questions_you_will_answer) 
        ? p.questions_you_will_answer.slice(0, 4).map(String) 
        : [],
      moduleSummary: Array.isArray(p?.module_outline) 
        ? p.module_outline.slice(0, 4).map((m, i) => ({ 
            title: String(m?.title || `Module ${i+1}`), 
            estMinutes: clampMinutes(Number(m?.est_minutes) || 5) 
          }))
        : [],
      sourceChatIds: Array.isArray(p?.source_chat_ids) ? p.source_chat_ids.map(String) : [],
      suggestKind: (p?.suggest_kind === 'explore' || p?.suggest_kind === 'strengthen') 
        ? p.suggest_kind 
        : 'explore',
      status: 'suggested',
      createdAt: now()
    };
  });

  return { outlines };
}

/**
 * Generate full course content
 */
export async function generateFullCourse({ outline, conversations, model }) {
  const sourceIds = Array.isArray(outline?.sourceChatIds) ? outline.sourceChatIds : [];
  const excerpts = [];
  
  for (const cid of sourceIds) {
    const conv = conversations.find(c => c.id === cid);
    if (!conv) continue;
    const msgs = (conv.messages || []).slice(-14);
    excerpts.push(`CHAT ${cid}:\n` + msgs.map(m => `${m.role === 'user' ? 'U' : 'A'}: ${m.content}`).join('\n'));
  }
  
  const input = [
    `INPUT_OUTLINE: <<<OUTLINE_JSON>>>\n${JSON.stringify({
      title: outline.title,
      questions_you_will_answer: outline.questions,
      modules: outline.moduleSummary
    })}`,
    `\nRELEVANT_CHAT_EXCERPTS: <<<TEXT>>>\n${excerpts.join('\n\n')}`,
    `\nAVOID_OUTLINES: <<<LIST_JSON>>>\n${JSON.stringify([])}\n`
  ].join('\n');

  const cgMsg = { role: 'user', content: `${courseGeneratorPrompt}\n\n${input}` };
  
  let raw, usedModel;
  try {
    ({ response: raw, model: usedModel } = await callLearnModel([cgMsg]));
  } catch (error) {
    console.error('[LearnAPI] Course generator error:', error);
    throw error;
  }
  
  const parsed = safeParse(raw);
  if (!parsed || !Array.isArray(parsed.modules)) {
    throw new Error('Course generation returned invalid JSON');
  }

  // Build course object
  const course = {
    id: outline.courseId,
    title: outline.title, // Always use outline title, ignore LLM changes
    goal: outline.goal || '',
    questionIds: Array.isArray(parsed.questions_you_will_answer) && parsed.questions_you_will_answer.length === 4
      ? parsed.questions_you_will_answer.map(String)
      : outline.questions,
    modules: parsed.modules.map((m, i) => ({
      id: generateId('mod'),
      idx: Number(m.idx || i+1),
      title: String(m.title || outline.moduleSummary?.[i]?.title || `Module ${i+1}`),
      estMinutes: clampMinutes(Number(m.est_minutes || outline.moduleSummary?.[i]?.estMinutes || 5)),
      lesson: normalizeText(String(m.lesson || '')),
      microTask: '',
      quiz: Array.isArray(m.quiz) ? m.quiz.slice(0,2).map(q => ({
        prompt: normalizeText(String(q?.prompt || '')),
        choices: Array.isArray(q?.choices) ? q.choices.slice(0,5).map(String) : [],
        answerIndex: Number.isInteger(q?.answer_index) ? q.answer_index : 0
      })) : [],
      refs: Array.isArray(m.refs) ? m.refs.map(String) : []
    })),
    whereToGoNext: String(parsed.where_to_go_next || ''),
    status: 'started',
    progressByModule: {},
    completedVia: null,
    createdAt: now()
  };
  
  return course;
}

/**
 * Regroup all completed courses
 */
export async function regroupAllCompleted() {
  const store = useLearnStore.getState();
  const courses = Object.values(store.courses);
  const goals = Object.values(store.goals);
  
  // Get completed courses that need grouping
  const completedCourses = courses.filter(c => c.status === 'completed');
  
  if (completedCourses.length === 0) {
    return { regrouped: 0, pending: 0, groups: goals.length };
  }
  
  // Build compact inputs for LLM
  const pendingBrief = completedCourses.map(c => ({
    id: c.id,
    title: c.title || '',
    tag: c.goal || '',
    questions: Array.isArray(c.questionIds) ? c.questionIds.slice(0,4) : [],
    modules: (Array.isArray(c.modules) ? c.modules : []).slice(0,6).map(m => m.title || '')
  }));
  
  const existingBrief = goals.map(g => {
    const goalCourses = store.getGoalCourses(g.id);
    return {
      label: g.label,
      members: goalCourses.completed.slice(0, 12).map(course => ({
        id: course.id,
        title: course.title || '',
        modules: (Array.isArray(course.modules) ? course.modules : []).slice(0,4).map(m => m.title || '')
      }))
    };
  });

  const msg = {
    role: 'user',
    content: `${goalRegroupPrompt}\n\nPENDING_COURSES: ${JSON.stringify(pendingBrief)}\nEXISTING_GROUPS: ${JSON.stringify(existingBrief)}`
  };
  
  console.log('[LearnAPI] Calling regroup with', completedCourses.length, 'completed courses');
  
  let raw, usedModel;
  try {
    ({ response: raw, model: usedModel } = await callLearnModel([msg]));
  } catch (error) {
    console.error('[LearnAPI] Regroup error:', error);
    return { regrouped: 0, pending: completedCourses.length, groups: goals.length };
  }
  
  console.log('[LearnAPI] Regroup response:', raw);
  
  const parsed = safeParse(raw);
  console.log('[LearnAPI] Parsed regroup result:', parsed);

  if (!parsed) {
    console.warn('[LearnAPI] Failed to parse regroup result');
    return { regrouped: 0, pending: completedCourses.length, groups: goals.length };
  }

  // Apply regrouping
  let regroupedCount = 0;
  const db = (await import('../../../lib/db/database')).default;
  
  // 1. Handle renames (rename existing goal labels)
  if (Array.isArray(parsed.rename)) {
    for (const rename of parsed.rename) {
      const oldLabel = rename.from;
      const newLabel = rename.to;
      
      if (!oldLabel || !newLabel) continue;
      
      const goal = goals.find(g => g.label === oldLabel);
      if (!goal) continue;
      
      console.log('[LearnAPI] Renaming goal:', oldLabel, '->', newLabel);
      
      // Check if target label already exists (uniqueness constraint)
      const targetGoal = goals.find(g => g.label === newLabel);
      
      if (targetGoal) {
        // Target label exists - merge instead of rename
        console.log('[LearnAPI] Target goal already exists, merging goals');
        
        // Move all courses from old goal to existing goal
        const goalCourses = courses.filter(c => c.goal === oldLabel);
        for (const course of goalCourses) {
          await db.courses.update(course.id, { goal: newLabel });
        }
        
        // Delete the old goal
        await db.goals.delete(goal.id);
        
        console.log('[LearnAPI] Merged', goalCourses.length, 'courses from', oldLabel, 'to', newLabel);
      } else {
        // Target label doesn't exist - safe to rename
        await db.goals.update(goal.id, { label: newLabel });
        
        // Update all courses with this goal
        const goalCourses = courses.filter(c => c.goal === oldLabel);
        for (const course of goalCourses) {
          await db.courses.update(course.id, { goal: newLabel });
        }
        
        console.log('[LearnAPI] Renamed goal and updated', goalCourses.length, 'courses');
      }
      
      // Reload store data to reflect changes
      await store.loadLearnData();
    }
  }
  
  // 2. Handle add_to_existing (assign pending courses to existing goals)
  if (Array.isArray(parsed.add_to_existing)) {
    for (const assignment of parsed.add_to_existing) {
      const courseId = assignment.course_id;
      const targetLabel = assignment.target_label;
      
      if (!courseId || !targetLabel) continue;
      
      const course = courses.find(c => c.id === courseId);
      if (!course) continue;
      
      console.log('[LearnAPI] Assigning course', course.title, 'to goal', targetLabel);
      
      // Update course with goal
      await db.courses.update(courseId, { goal: targetLabel });
      
      // Update store
      await store.updateCourseGoal(courseId, targetLabel);
      
      regroupedCount++;
    }
  }
  
  // 3. Handle new_groups (create new goals with pending courses)
  if (Array.isArray(parsed.new_groups)) {
    for (const group of parsed.new_groups) {
      const goalLabel = group.label;
      const memberIds = group.members || [];
      
      if (!goalLabel || memberIds.length < 2) continue;
      
      console.log('[LearnAPI] Creating new goal:', goalLabel, 'with', memberIds.length, 'members');
      
      // Assign each member to this goal
      for (const courseId of memberIds) {
        const course = courses.find(c => c.id === courseId);
        if (!course) continue;
        
        await db.courses.update(courseId, { goal: goalLabel });
        await store.updateCourseGoal(courseId, goalLabel);
        
        regroupedCount++;
      }
    }
  }
  
  const pendingCount = completedCourses.length - regroupedCount;
  
  console.log('[LearnAPI] Regroup complete:', regroupedCount, 'regrouped,', pendingCount, 'pending');
  
  return { regrouped: regroupedCount, pending: pendingCount, groups: goals.length };
}

/**
 * Mark outline status (save, dismiss, already know)
 */
export async function markOutlineStatus(outlineId, status, action) {
  console.log('[LearnAPI] markOutlineStatus:', { outlineId, status, action });
  
  const store = useLearnStore.getState();
  const outline = store.outlines[outlineId];
  
  if (!outline) {
    console.warn('[LearnAPI] Outline not found:', outlineId);
    return;
  }
  
  // Handle special actions
  if (action === 'save') {
    // Create shell course in 'started' status so it appears in "Continue"
    const existingCourse = store.courses[outline.courseId];
    if (!existingCourse) {
      console.log('[LearnAPI] Creating shell course for saved outline');
      const shellCourse = {
        id: outline.courseId,
        title: outline.title,
        goal: outline.goal || '',
        questionIds: outline.questions || [],
        moduleIds: [],
        whereToGoNext: '',
        status: 'started',
        progressByModule: {},
        completedVia: null,
        createdAt: now(),
        completedAt: null
      };
      
      await store.saveCourse(shellCourse);
    }
    
    // Update outline to 'started'
    await store.updateOutlineStatus(outlineId, 'started');
    
  } else if (action === 'already_know') {
    // Create completed course with NO goal (so it goes to "Pending for Grouping")
    console.log('[LearnAPI] Creating completed course for "already know it"');
    
    const course = {
      id: outline.courseId,
      title: outline.title,
      goal: '', // No goal = pending for grouping
      questionIds: outline.questions || [],
      moduleIds: [],
      modules: outline.moduleSummary.map((m, i) => ({
        id: generateId('mod'),
        courseId: outline.courseId,
        idx: i + 1,
        title: m.title, 
        estMinutes: m.estMinutes,
        lesson: '', 
        microTask: '',
        quiz: [],
        refs: [] 
      })),
      whereToGoNext: '',
      status: 'completed',
      progressByModule: {},
      completedVia: 'self_report',
      createdAt: now(),
      completedAt: now()
    };
    
    // Set all modules as done
    for (const m of course.modules) {
      course.progressByModule[m.id] = 'done';
    }
    
    await store.saveCourse(course);
    
    // Update outline status
    await store.updateOutlineStatus(outlineId, 'completed');
    
    // Trigger auto-regroup if conditions are met
    if (shouldTriggerAutoRegroup()) {
      console.log('[LearnAPI] Auto-regroup conditions met, triggering in background');
      // Run in background, don't wait
      autoRegroupPendingCourses().catch(error => {
        console.warn('[LearnAPI] Auto-regroup failed:', error);
      });
    }
    
  } else {
    // Regular status update (dismiss, etc.)
    await store.updateOutlineStatus(outlineId, status);
    
    // If dismissing and there's a corresponding started course, also update/remove it
    if (action === 'dismiss' && outline.courseId) {
      const course = store.courses[outline.courseId];
      
      if (course && course.status === 'started') {
        console.log('[LearnAPI] Dismissing corresponding started course:', outline.courseId);
        // Delete the shell course since it was never actually started
        const db = (await import('../../../lib/db/database')).default;
        await db.courses.delete(outline.courseId);
        await store.loadLearnData();
      }
    }
  }
  
  console.log('[LearnAPI] Updated outline', outlineId, 'to status:', status, 'action:', action);
}
