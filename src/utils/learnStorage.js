import { db, auth } from '../services/firebase';
import { collection, doc, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';

// Local persistence for Learn mode. Firebase sync is best-effort.
const LS_KEYS = {
  chat_summaries: 'learn_chat_summaries_v1',
  course_outlines: 'learn_course_outlines_v1',
  courses: 'learn_courses_v1',
  goals: 'learn_goals_v1',
  pending: 'learn_pending_v1',
  suppress: 'learn_suppress_v1',
  logs: 'learn_logs_v1',
  prefetch: 'learn_prefetch_v1',
  generating: 'learn_generating_v1',
  model: 'learn_model_v1',
};

// Generic helpers
const readJSON = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const writeJSON = (k, v) => { 
  try { 
    const json = JSON.stringify(v);
    localStorage.setItem(k, json);
    // Verify write succeeded by reading back
    const verify = localStorage.getItem(k);
    if (!verify) {
      throw new Error('localStorage write verification failed - data not persisted');
    }
  } catch (e) { 
    // If quota exceeded, try cleanup and retry once
    const isQuotaError = e.name === 'QuotaExceededError' || 
                        String(e).includes('quota') || 
                        String(e).includes('QuotaExceededError');
    
    if (isQuotaError) {
      console.warn('[learnStorage] Quota exceeded, attempting cleanup...');
      try {
        // Inline cleanup: clear prefetch cache and old logs
        localStorage.removeItem(LS_KEYS.prefetch);
        
        const logs = readJSON(LS_KEYS.logs, []);
        if (logs.length > 50) {
          writeJSON_internal(LS_KEYS.logs, logs.slice(-50));
        }
        
        console.log('[learnStorage] Cleanup complete, retrying write...');
        
        // Retry write after cleanup
        const json = JSON.stringify(v);
        localStorage.setItem(k, json);
        const verify = localStorage.getItem(k);
        if (verify) {
          console.log('[learnStorage] Write succeeded after cleanup');
          return; // Success!
        }
      } catch (retryError) {
        console.error('[learnStorage] Retry after cleanup failed:', retryError);
      }
      
      // Still failed - give helpful error
      throw new Error('Storage quota exceeded. Try: 1) Complete and remove old courses, or 2) Use "Restart" to clear data.');
    }
    
    console.error(`[learnStorage] Failed to write key ${k}:`, e);
    throw new Error(`Failed to save to localStorage: ${e.message || 'Unknown error'}`);
  } 
};

// Internal write without retry logic (to avoid infinite recursion in cleanup)
const writeJSON_internal = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {
    console.error(`[learnStorage] Internal write failed for ${k}:`, e);
  }
};

// Chat Summaries
export function loadChatSummaries() {
  return readJSON(LS_KEYS.chat_summaries, []);
}
export function saveChatSummaries(list) {
  writeJSON(LS_KEYS.chat_summaries, Array.isArray(list) ? list : []);
  syncDoc('chat_summaries', { count: Array.isArray(list) ? list.length : 0 }).catch(() => {});
}

// Course Outlines (suggested/saved/started/completed/dismissed)
export function loadCourseOutlines() {
  return readJSON(LS_KEYS.course_outlines, []);
}
export function saveCourseOutlines(list) {
  writeJSON(LS_KEYS.course_outlines, Array.isArray(list) ? list : []);
  syncDoc('course_outlines_meta', { count: Array.isArray(list) ? list.length : 0 }).catch(() => {});
}

// Full Courses
export function loadCourses() {
  return readJSON(LS_KEYS.courses, []);
}
export function saveCourses(list) {
  writeJSON(LS_KEYS.courses, Array.isArray(list) ? list : []);
}

// Goals
export function loadGoals() {
  return readJSON(LS_KEYS.goals, []);
}
export function saveGoals(list) {
  writeJSON(LS_KEYS.goals, Array.isArray(list) ? list : []);
}

// Pending completed courses that are not yet grouped under a canonical goal
export function loadPendingCourses() {
  const list = readJSON(LS_KEYS.pending, []);
  return Array.isArray(list) ? list : [];
}
export function savePendingCourses(list) {
  writeJSON(LS_KEYS.pending, Array.isArray(list) ? list : []);
}

// Suppressions (not interested)
export function loadSuppressions() {
  return readJSON(LS_KEYS.suppress, {});
}
export function saveSuppressions(map) {
  writeJSON(LS_KEYS.suppress, map || {});
}

// Logs
export function appendLearnLog(event) {
  try {
    const list = readJSON(LS_KEYS.logs, []);
    list.push({ ...event, ts: new Date().toISOString() });
    writeJSON(LS_KEYS.logs, list.slice(-1000));
  } catch {}
  syncAdd('logs', event).catch(() => {});
}

// Prefetched full courses (content generated before user starts)
export function loadPrefetchedCourses() {
  return readJSON(LS_KEYS.prefetch, {});
}
export function savePrefetchedCourses(map) {
  writeJSON(LS_KEYS.prefetch, map || {});
}

// Generation flags to coordinate background generation
export function loadGenerationFlags() {
  return readJSON(LS_KEYS.generating, {});
}
export function saveGenerationFlags(map) {
  writeJSON(LS_KEYS.generating, map || {});
}
export function isGeneratingCourse(courseId) {
  const f = loadGenerationFlags();
  return Boolean(f && f[courseId]);
}
export function setGeneratingCourse(courseId, value) {
  const f = loadGenerationFlags();
  f[courseId] = Boolean(value);
  saveGenerationFlags(f);
}

// Global regrouping flag so UI can reflect background regroup runs
export function isRegrouping() {
  try { return Boolean(loadGenerationFlags().regrouping); } catch { return false; }
}
export function setRegrouping(value) {
  try {
    const f = loadGenerationFlags();
    f.regrouping = Boolean(value);
    saveGenerationFlags(f);
  } catch {}
}

// Model Selection for Learn Mode
export function loadLearnModel() {
  try {
    const val = localStorage.getItem(LS_KEYS.model);
    return val ? String(val) : 'gemini-2.5-flash';
  } catch {
    return 'gemini-2.5-flash';
  }
}
export function saveLearnModel(model) {
  try {
    localStorage.setItem(LS_KEYS.model, String(model));
  } catch {}
}

// Utility: compute a tiny dedup hash from text
export function tinyHash(text) {
  const s = String(text || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// Storage size utilities
export function getStorageSize() {
  try {
    let total = 0;
    const sizes = {};
    for (const [key, lsKey] of Object.entries(LS_KEYS)) {
      const value = localStorage.getItem(lsKey);
      const size = value ? new Blob([value]).size : 0;
      sizes[key] = size;
      total += size;
    }
    return { total, sizes, totalMB: (total / 1024 / 1024).toFixed(2) };
  } catch {
    return { total: 0, sizes: {}, totalMB: '0' };
  }
}

// Clean up old data to free space
export function cleanupOldData(options = {}) {
  const { keepRecentCourses = 10, keepRecentLogs = 100 } = options;
  let freedBytes = 0;
  
  try {
    // 1. Clean up old dismissed/completed courses (keep only recent)
    const courses = loadCourses() || [];
    const completed = courses.filter(c => c.status === 'completed');
    const dismissed = courses.filter(c => c.status === 'dismissed');
    const active = courses.filter(c => c.status === 'started' || c.status === 'saved' || c.status === 'suggested');
    
    // Keep only the most recent completed courses
    const recentCompleted = completed.slice(0, keepRecentCourses);
    const keptCourses = [...active, ...recentCompleted];
    
    if (keptCourses.length < courses.length) {
      const before = JSON.stringify(courses).length;
      saveCourses(keptCourses);
      const after = JSON.stringify(keptCourses).length;
      freedBytes += (before - after);
    }
    
    // 2. Clean up prefetch cache
    savePrefetchedCourses({});
    
    // 3. Trim logs to recent entries
    const logs = readJSON(LS_KEYS.logs, []);
    if (logs.length > keepRecentLogs) {
      const before = JSON.stringify(logs).length;
      const trimmed = logs.slice(-keepRecentLogs);
      writeJSON(LS_KEYS.logs, trimmed);
      const after = JSON.stringify(trimmed).length;
      freedBytes += (before - after);
    }
    
    // 4. Remove dismissed outlines
    const outlines = loadCourseOutlines() || [];
    const keptCourseIds = new Set(keptCourses.map(c => c.course_id));
    const keptOutlines = outlines.filter(o => o.status !== 'dismissed' || keptCourseIds.has(o.course_id));
    
    if (keptOutlines.length < outlines.length) {
      const before = JSON.stringify(outlines).length;
      saveCourseOutlines(keptOutlines);
      const after = JSON.stringify(keptOutlines).length;
      freedBytes += (before - after);
    }
    
    return { success: true, freedBytes, freedMB: (freedBytes / 1024 / 1024).toFixed(2) };
  } catch (error) {
    console.error('[learnStorage] Cleanup failed:', error);
    return { success: false, error, freedBytes };
  }
}

// Reset all Learn mode state (for testing)
export function clearAllLearnState(options = {}) {
  const { keepSummaries = false } = options;
  try {
    if (!keepSummaries) {
      localStorage.removeItem(LS_KEYS.chat_summaries);
    }
    localStorage.removeItem(LS_KEYS.course_outlines);
    localStorage.removeItem(LS_KEYS.courses);
    localStorage.removeItem(LS_KEYS.goals);
    localStorage.removeItem(LS_KEYS.pending);
    localStorage.removeItem(LS_KEYS.suppress);
    localStorage.removeItem(LS_KEYS.logs);
    localStorage.removeItem(LS_KEYS.prefetch);
    localStorage.removeItem(LS_KEYS.generating);
  } catch {}
}

// Firebase best-effort sync
async function syncDoc(kind, data) {
  if (!db || !auth || !auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const ref = doc(db, 'users', uid, 'learn', kind);
  await setDoc(ref, { data, updatedAt: serverTimestamp() }, { merge: true });
}
async function syncAdd(kind, data) {
  if (!db || !auth || !auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const col = collection(db, 'users', uid, 'learn', kind, 'items');
  await addDoc(col, { ...data, createdAt: serverTimestamp() });
}
