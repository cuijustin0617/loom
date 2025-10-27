/**
 * Migration Script: localStorage → IndexedDB
 * 
 * Automatically runs on first load to migrate existing user data.
 * Safe to run multiple times (idempotent).
 */

import db, { generateId, now } from './database';

const MIGRATION_KEY = 'loom_migration_v2_complete';
const OLD_KEYS = {
  conversations: 'conversations',
  currentConversationId: 'currentConversationId',
  settings: 'settings',
  
  // Learn mode keys
  chatSummaries: 'learn_chat_summaries_v1',
  courseOutlines: 'learn_course_outlines_v1',
  courses: 'learn_courses_v1',
  goals: 'learn_goals_v1',
  pending: 'learn_pending_v1',
  suppress: 'learn_suppress_v1',
  learnModel: 'learn_model_v1'
};

/**
 * Check if migration has already been completed
 * @returns {boolean}
 */
export function isMigrationComplete() {
  return localStorage.getItem(MIGRATION_KEY) === 'true';
}

/**
 * Mark migration as complete
 */
function markMigrationComplete() {
  localStorage.setItem(MIGRATION_KEY, 'true');
}

/**
 * Safe JSON parse
 * @param {string} key - localStorage key
 * @param {any} fallback - Fallback value
 * @returns {any}
 */
function safeGetJSON(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.warn(`[Migration] Failed to parse ${key}:`, error);
    return fallback;
  }
}

/**
 * Migrate chat data (conversations + messages)
 * @returns {Promise<{conversationsCount: number, messagesCount: number}>}
 */
async function migrateChat() {
  const oldConversations = safeGetJSON(OLD_KEYS.conversations, []);
  const currentId = localStorage.getItem(OLD_KEYS.currentConversationId);
  
  let conversationsCount = 0;
  let messagesCount = 0;
  
  for (const conv of oldConversations) {
    // Skip empty conversations
    if (!Array.isArray(conv.messages) || conv.messages.length === 0) {
      continue;
    }
    
    // Migrate conversation
    const conversation = {
      id: conv.id || generateId('conv'),
      title: conv.title || 'New Chat',
      summary: conv.summary || '',
      model: conv.model || 'gemini-2.5-pro+search',
      createdAt: conv.createdAt || now(),
      updatedAt: now()
    };
    
    await db.conversations.put(conversation);
    conversationsCount++;
    
    // Migrate messages
    for (const msg of conv.messages) {
      const message = {
        messageId: msg.id || generateId('msg'),
        conversationId: conversation.id,
        role: msg.role || 'user',
        content: msg.content || '',
        attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
        createdAt: msg.timestamp || now(),
        isError: msg.isError || false
      };
      
      await db.messages.put(message);
      messagesCount++;
    }
  }
  
  // Migrate current conversation ID to settings
  if (currentId) {
    await db.settings.put({ key: 'currentConversationId', value: currentId });
  }
  
  return { conversationsCount, messagesCount };
}

/**
 * Migrate learn mode data (courses, modules, goals, outlines)
 * @returns {Promise<{coursesCount: number, modulesCount: number, goalsCount: number}>}
 */
async function migrateLearn() {
  const oldCourses = safeGetJSON(OLD_KEYS.courses, []);
  const oldGoals = safeGetJSON(OLD_KEYS.goals, []);
  const oldOutlines = safeGetJSON(OLD_KEYS.courseOutlines, []);
  
  let coursesCount = 0;
  let modulesCount = 0;
  let goalsCount = 0;
  
  // Migrate courses and modules (normalized)
  for (const oldCourse of oldCourses) {
    const courseId = oldCourse.course_id || generateId('course');
    
    // Migrate course (normalized)
    const course = {
      id: courseId,
      title: oldCourse.title || 'Untitled',
      goal: oldCourse.goal || '',
      questionIds: Array.isArray(oldCourse.questions_you_will_answer) 
        ? oldCourse.questions_you_will_answer 
        : [],
      moduleIds: [],
      whereToGoNext: oldCourse.where_to_go_next || '',
      status: oldCourse.status || 'suggested',
      progressByModule: oldCourse.progress_by_module || {},
      completedVia: oldCourse.completed_via || null,
      createdAt: oldCourse.createdAt || now(),
      completedAt: oldCourse.status === 'completed' ? (oldCourse.completedAt || now()) : null
    };
    
    // Migrate modules
    const moduleIds = [];
    if (Array.isArray(oldCourse.modules)) {
      for (const oldModule of oldCourse.modules) {
        const moduleId = oldModule.module_id || generateId('mod');
        
        const module = {
          id: moduleId,
          courseId: courseId,
          idx: oldModule.idx || 1,
          title: oldModule.title || 'Module',
          estMinutes: oldModule.est_minutes || 5,
          lesson: oldModule.lesson || '',
          microTask: oldModule.micro_task || '',
          quiz: Array.isArray(oldModule.quiz) ? oldModule.quiz : [],
          refs: Array.isArray(oldModule.refs) ? oldModule.refs : []
        };
        
        await db.modules.put(module);
        moduleIds.push(moduleId);
        modulesCount++;
      }
    }
    
    course.moduleIds = moduleIds;
    await db.courses.put(course);
    coursesCount++;
  }
  
  // Migrate goals (normalized)
  for (const oldGoal of oldGoals) {
    const goalId = oldGoal.goal_id || generateId('goal');
    
    const goal = {
      id: goalId,
      label: oldGoal.label || 'Untitled Goal',
      createdAt: now()
    };
    
    await db.goals.put(goal);
    goalsCount++;
    
    // Migrate goal-course relationships
    const completedCourses = Array.isArray(oldGoal.completed_courses) ? oldGoal.completed_courses : [];
    const startedCourses = Array.isArray(oldGoal.started_courses) ? oldGoal.started_courses : [];
    
    for (const courseId of completedCourses) {
      await db.goalCourses.put({
        goalId,
        courseId,
        status: 'completed'
      });
    }
    
    for (const courseId of startedCourses) {
      await db.goalCourses.put({
        goalId,
        courseId,
        status: 'started'
      });
    }
  }
  
  // Migrate outlines
  for (const oldOutline of oldOutlines) {
    const outlineId = oldOutline.course_id || generateId('outline');
    
    const outline = {
      id: outlineId,
      courseId: outlineId,
      title: oldOutline.title || 'Untitled',
      whySuggested: oldOutline.why_suggested || '',
      questions: Array.isArray(oldOutline.questions_you_will_answer) 
        ? oldOutline.questions_you_will_answer 
        : [],
      moduleSummary: Array.isArray(oldOutline.modules)
        ? oldOutline.modules.map(m => ({
            title: m.title || '',
            estMinutes: m.est_minutes || 5
          }))
        : [],
      sourceChatIds: Array.isArray(oldOutline.source_chat_ids) 
        ? oldOutline.source_chat_ids 
        : [],
      suggestKind: oldOutline.suggest_kind || 'explore',
      status: oldOutline.status || 'suggested',
      createdAt: now()
    };
    
    await db.outlines.put(outline);
  }
  
  return { coursesCount, modulesCount, goalsCount };
}

/**
 * Migrate settings
 * @returns {Promise<void>}
 */
async function migrateSettings() {
  const oldSettings = safeGetJSON(OLD_KEYS.settings, {});
  
  // Migrate each setting
  const settingsToMigrate = {
    selectedModel: oldSettings.selectedModel,
    apiKey: oldSettings.apiKey,
    openaiKey: oldSettings.openaiKey,
    e2eePassphrase: oldSettings.e2eePassphrase,
    learnModel: safeGetJSON(OLD_KEYS.learnModel, 'gemini-2.5-flash')
  };
  
  for (const [key, value] of Object.entries(settingsToMigrate)) {
    if (value !== undefined && value !== null) {
      await db.settings.put({ key, value });
    }
  }
}

/**
 * Main migration function
 * @returns {Promise<{success: boolean, stats: object, error?: string}>}
 */
export async function runMigration() {
  // Skip if already migrated
  if (isMigrationComplete()) {
    console.log('[Migration] Already completed, skipping');
    return { success: true, stats: { skipped: true } };
  }
  
  console.log('[Migration] Starting localStorage → IndexedDB migration...');
  const startTime = Date.now();
  
  try {
    // Run migrations
    const chatStats = await migrateChat();
    const learnStats = await migrateLearn();
    await migrateSettings();
    
    // Mark as complete
    markMigrationComplete();
    
    const duration = Date.now() - startTime;
    const stats = {
      ...chatStats,
      ...learnStats,
      duration: `${duration}ms`
    };
    
    console.log('[Migration] Completed successfully:', stats);
    
    return { success: true, stats };
  } catch (error) {
    console.error('[Migration] Failed:', error);
    return { 
      success: false, 
      stats: {}, 
      error: error.message || String(error) 
    };
  }
}

/**
 * Reset migration flag (for testing)
 */
export function resetMigration() {
  localStorage.removeItem(MIGRATION_KEY);
  console.log('[Migration] Flag reset, will run on next load');
}

/**
 * Get migration status
 * @returns {{complete: boolean, hasOldData: boolean}}
 */
export function getMigrationStatus() {
  const complete = isMigrationComplete();
  
  // Check if old data exists
  const hasConversations = !!localStorage.getItem(OLD_KEYS.conversations);
  const hasCourses = !!localStorage.getItem(OLD_KEYS.courses);
  const hasOldData = hasConversations || hasCourses;
  
  return { complete, hasOldData };
}

