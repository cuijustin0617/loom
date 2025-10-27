/**
 * Dexie Database Configuration
 * 
 * Single source of truth for all app data.
 * Uses IndexedDB for storage (50MB+ quota, async, transactional).
 */

import Dexie from 'dexie';

export const db = new Dexie('loom_v2');

// Schema definition
// ++id = auto-incrementing primary key
// & = unique index
// * = multi-entry index (for arrays)
// [a+b] = compound index

// Version 1 - Initial schema
db.version(1).stores({
  conversations: '&id, createdAt, updatedAt',
  messages: '++id, &messageId, conversationId, createdAt, role',
  courses: '&id, status, goal, createdAt, completedAt',
  modules: '&id, courseId, idx',
  goals: '&id, &label',
  outlines: '&id, courseId, status, createdAt',
  goalCourses: '[goalId+courseId], goalId, courseId',
  settings: '&key',
  syncMeta: '&key, lastSyncedAt'
});

// Version 2 - Fix messages primary key for proper upserts
db.version(2).stores({
  messages: '&messageId, conversationId, createdAt, role',
});

// ===== TYPE DEFINITIONS (for JSDoc) =====

/**
 * @typedef {Object} Conversation
 * @property {string} id - Unique conversation ID
 * @property {string} title - Conversation title
 * @property {string} summary - Auto-generated summary
 * @property {string} model - Model used (e.g., 'gemini-2.5-pro')
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 */

/**
 * @typedef {Object} Message
 * @property {string} messageId - Unique message ID (primary key)
 * @property {string} conversationId - Parent conversation ID
 * @property {'user'|'assistant'} role - Message role
 * @property {string} content - Message text
 * @property {Array<Attachment>} attachments - File attachments
 * @property {string} createdAt - ISO timestamp
 * @property {boolean} [isError] - Error message flag
 */

/**
 * @typedef {Object} Attachment
 * @property {string} name - File name
 * @property {string} mimeType - MIME type
 * @property {number} size - File size in bytes
 * @property {string} base64 - Base64-encoded data
 */

/**
 * @typedef {Object} Course
 * @property {string} id - Unique course ID (course_id from old schema)
 * @property {string} title - Course title
 * @property {string} goal - Goal label (denormalized for queries)
 * @property {string[]} questionIds - IDs of questions (denormalized)
 * @property {string[]} moduleIds - IDs of modules (in order)
 * @property {string} whereToGoNext - Suggested next steps
 * @property {'suggested'|'saved'|'started'|'completed'|'dismissed'} status
 * @property {Object.<string, 'not_started'|'in_progress'|'done'>} progressByModule
 * @property {'self_report'|'full_completion'|null} completedVia
 * @property {string} createdAt - ISO timestamp
 * @property {string} [completedAt] - ISO timestamp
 */

/**
 * @typedef {Object} Module
 * @property {string} id - Unique module ID (module_id from old schema)
 * @property {string} courseId - Parent course ID
 * @property {number} idx - Module order (1-based)
 * @property {string} title - Module title
 * @property {number} estMinutes - Estimated completion time
 * @property {string} lesson - Lesson content (markdown)
 * @property {string} microTask - Practice task
 * @property {Quiz[]} quiz - Quiz questions
 * @property {string[]} refs - Reference links
 */

/**
 * @typedef {Object} Quiz
 * @property {string} prompt - Question text
 * @property {string[]} choices - Answer choices
 * @property {number} answerIndex - Correct answer index (0-based)
 */

/**
 * @typedef {Object} Goal
 * @property {string} id - Unique goal ID
 * @property {string} label - Goal label (e.g., 'React Basics')
 * @property {string} createdAt - ISO timestamp
 */

/**
 * @typedef {Object} GoalCourse
 * @property {string} goalId - Goal ID
 * @property {string} courseId - Course ID
 * @property {'completed'|'started'|'suggested'} status
 */

/**
 * @typedef {Object} Outline
 * @property {string} id - Unique outline ID (same as courseId)
 * @property {string} courseId - Associated course ID
 * @property {string} title - Course title (denormalized)
 * @property {string} whySuggested - Reason for suggestion
 * @property {string[]} questions - Questions (denormalized)
 * @property {Array<{title: string, estMinutes: number}>} moduleSummary - Module preview
 * @property {string[]} sourceChatIds - Source conversation IDs
 * @property {'explore'|'strengthen'} suggestKind
 * @property {'suggested'|'saved'|'started'|'completed'|'dismissed'} status
 * @property {string} createdAt - ISO timestamp
 */

// ===== HELPER FUNCTIONS =====

/**
 * Get current timestamp
 * @returns {string} ISO timestamp
 */
export function now() {
  return new Date().toISOString();
}

/**
 * Generate unique ID
 * @param {string} prefix - ID prefix (e.g., 'conv', 'course', 'module')
 * @returns {string} Unique ID
 */
export function generateId(prefix = 'id') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Safely get a record by ID
 * @template T
 * @param {import('dexie').Table<T>} table - Dexie table
 * @param {string|number} id - Record ID
 * @returns {Promise<T|null>} Record or null if not found
 */
export async function safeGet(table, id) {
  try {
    const record = await table.get(id);
    return record || null;
  } catch (error) {
    console.error(`[DB] Failed to get from ${table.name}:`, error);
    return null;
  }
}

/**
 * Safely query records
 * @template T
 * @param {import('dexie').Table<T>} table - Dexie table
 * @param {Function} queryFn - Query function (e.g., table => table.where('status').equals('active'))
 * @returns {Promise<T[]>} Records or empty array on error
 */
export async function safeQuery(table, queryFn) {
  try {
    return await queryFn(table).toArray();
  } catch (error) {
    console.error(`[DB] Query failed on ${table.name}:`, error);
    return [];
  }
}

/**
 * Transaction wrapper with error handling
 * @param {string} mode - 'r' (read) or 'rw' (read-write)
 * @param {string[]} tableNames - Table names to include in transaction
 * @param {Function} fn - Transaction function
 * @returns {Promise<any>} Transaction result
 */
export async function transaction(mode, tableNames, fn) {
  try {
    return await db.transaction(mode, tableNames, fn);
  } catch (error) {
    console.error('[DB] Transaction failed:', error);
    throw new Error(`Database transaction failed: ${error.message}`);
  }
}

/**
 * Check database size and quota
 * @returns {Promise<{usage: number, quota: number, usageMB: number, quotaMB: number}>}
 */
export async function getStorageInfo() {
  if (!navigator.storage || !navigator.storage.estimate) {
    return { usage: 0, quota: 0, usageMB: 0, quotaMB: 0 };
  }
  
  try {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0,
      usageMB: ((estimate.usage || 0) / 1024 / 1024).toFixed(2),
      quotaMB: ((estimate.quota || 0) / 1024 / 1024).toFixed(2)
    };
  } catch (error) {
    console.error('[DB] Failed to get storage info:', error);
    return { usage: 0, quota: 0, usageMB: 0, quotaMB: 0 };
  }
}

export default db;

