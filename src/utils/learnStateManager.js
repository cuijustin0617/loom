/**
 * Centralized Learn Mode State Manager
 * 
 * Provides atomic operations, validation, and auto-repair for Learn mode state.
 * Prevents the divergence issues caused by multiple localStorage keys.
 */

import {
  loadCourses, saveCourses,
  loadCourseOutlines, saveCourseOutlines,
  loadGoals, saveGoals,
  loadPendingCourses, savePendingCourses,
  loadPrefetchedCourses, savePrefetchedCourses,
  loadGenerationFlags, saveGenerationFlags,
  tinyHash,
  cleanupOldData
} from './learnStorage';

// Flag expiry time: 10 minutes
const GENERATION_FLAG_TTL = 10 * 60 * 1000;

/**
 * Validates and repairs Learn mode state on read.
 * Ensures consistency between outlines, courses, and goals.
 */
export function validateAndRepairState() {
  try {
    const outlines = loadCourseOutlines() || [];
    const courses = loadCourses() || [];
    const goals = loadGoals() || [];
    const pending = new Set(loadPendingCourses() || []);
    
    let outlinesChanged = false;
    let coursesChanged = false;
    let pendingChanged = false;
    
    const courseMap = new Map(courses.map(c => [c.course_id, c]));
    const outlineMap = new Map(outlines.map(o => [o.course_id, o]));
    
    // 1. Sync outline status with course status
    const repairedOutlines = outlines.map(outline => {
      const course = courseMap.get(outline.course_id);
      if (course && course.status !== outline.status) {
        outlinesChanged = true;
        return { ...outline, status: course.status };
      }
      return outline;
    });
    
    // 2. Find courses without outlines and create minimal outlines
    const coursesToAdd = [];
    for (const course of courses) {
      if (!outlineMap.has(course.course_id)) {
        coursesToAdd.push({
          course_id: course.course_id,
          user_id: 'local',
          goal: course.goal || '',
          title: course.title || 'Untitled',
          why_suggested: '',
          questions_you_will_answer: course.questions_you_will_answer || [],
          modules: (course.modules || []).map(m => ({
            idx: m.idx,
            title: m.title,
            est_minutes: m.est_minutes || 5
          })),
          source_chat_ids: [],
          suggest_kind: 'strengthen',
          status: course.status
        });
        outlinesChanged = true;
      }
    }
    
    // 3. Find completed courses that should be in pending but aren't grouped
    const groupedCourseIds = new Set(
      goals.flatMap(g => Array.isArray(g.completed_courses) ? g.completed_courses : [])
    );
    
    for (const course of courses) {
      if (course.status === 'completed' && !groupedCourseIds.has(course.course_id)) {
        if (!pending.has(course.course_id)) {
          pending.add(course.course_id);
          pendingChanged = true;
        }
      }
    }
    
    // 4. Remove from pending if now grouped
    for (const courseId of pending) {
      if (groupedCourseIds.has(courseId)) {
        pending.delete(courseId);
        pendingChanged = true;
      }
    }
    
    // 5. Persist changes
    if (outlinesChanged) {
      const finalOutlines = [...repairedOutlines, ...coursesToAdd];
      saveCourseOutlines(finalOutlines);
    }
    
    if (pendingChanged) {
      savePendingCourses(Array.from(pending));
    }
    
    return {
      repaired: outlinesChanged || coursesChanged || pendingChanged,
      outlinesChanged,
      coursesChanged,
      pendingChanged
    };
  } catch (error) {
    console.error('[LearnStateManager] Validation failed:', error);
    return { repaired: false, error };
  }
}

/**
 * Atomically update course status and sync outline status.
 */
export function updateCourseStatus(courseId, newStatus) {
  try {
    const courses = loadCourses() || [];
    const outlines = loadCourseOutlines() || [];
    
    // Update course
    const updatedCourses = courses.map(c =>
      c.course_id === courseId ? { ...c, status: newStatus } : c
    );
    
    // Update outline to match
    const updatedOutlines = outlines.map(o =>
      o.course_id === courseId ? { ...o, status: newStatus } : o
    );
    
    // Persist both
    saveCourses(updatedCourses);
    saveCourseOutlines(updatedOutlines);
    
    // If completing, add to pending
    if (newStatus === 'completed') {
      const pending = new Set(loadPendingCourses() || []);
      pending.add(courseId);
      savePendingCourses(Array.from(pending));
    }
    
    return { success: true };
  } catch (error) {
    console.error('[LearnStateManager] Failed to update course status:', error);
    return { success: false, error };
  }
}

/**
 * Atomically mark a course as started.
 * Creates a minimal course record if it doesn't exist.
 */
export function atomicStartCourse(outline) {
  try {
    const courses = loadCourses() || [];
    const outlines = loadCourseOutlines() || [];
    const prefetched = loadPrefetchedCourses() || {};
    
    // Check if course already exists
    const existing = courses.find(c => c.course_id === outline.course_id);
    if (existing) {
      // Just update status if needed
      if (existing.status !== 'started') {
        updateCourseStatus(outline.course_id, 'started');
      }
      return { success: true, existing: true, course: existing };
    }
    
    // Check prefetch cache
    const prefetchedCourse = prefetched[outline.course_id];
    if (prefetchedCourse) {
      // Adopt prefetched course as started
      const adoptedCourse = { ...prefetchedCourse, status: 'started' };
      saveCourses([adoptedCourse, ...courses]);
      
      // Remove from prefetch cache
      delete prefetched[outline.course_id];
      savePrefetchedCourses(prefetched);
      
      // Update outline
      const updatedOutlines = outlines.map(o =>
        o.course_id === outline.course_id ? { ...o, status: 'started' } : o
      );
      saveCourseOutlines(updatedOutlines);
      
      return { success: true, adopted: true, course: adoptedCourse };
    }
    
    // Update outline to started (will generate content later)
    const updatedOutlines = outlines.map(o =>
      o.course_id === outline.course_id ? { ...o, status: 'started' } : o
    );
    saveCourseOutlines(updatedOutlines);
    
    return { success: true, needsGeneration: true };
  } catch (error) {
    console.error('[LearnStateManager] Failed to start course:', error);
    return { success: false, error };
  }
}

/**
 * Set generation flag with timestamp for TTL.
 */
export function setGenerationFlag(courseId, value) {
  try {
    const flags = loadGenerationFlags() || {};
    if (value) {
      flags[courseId] = { active: true, timestamp: Date.now() };
    } else {
      delete flags[courseId];
    }
    saveGenerationFlags(flags);
  } catch (error) {
    console.error('[LearnStateManager] Failed to set generation flag:', error);
  }
}

/**
 * Check if course is currently generating (with TTL check).
 */
export function isGenerating(courseId) {
  try {
    const flags = loadGenerationFlags() || {};
    const flag = flags[courseId];
    if (!flag || !flag.active) return false;
    
    // Check TTL
    const age = Date.now() - (flag.timestamp || 0);
    if (age > GENERATION_FLAG_TTL) {
      // Expired, clean up
      delete flags[courseId];
      saveGenerationFlags(flags);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('[LearnStateManager] Failed to check generation flag:', error);
    return false;
  }
}

/**
 * Clean up expired generation flags.
 */
export function cleanupExpiredFlags() {
  try {
    const flags = loadGenerationFlags() || {};
    let cleaned = false;
    const now = Date.now();
    
    for (const [courseId, flag] of Object.entries(flags)) {
      if (flag && flag.timestamp) {
        const age = now - flag.timestamp;
        if (age > GENERATION_FLAG_TTL) {
          delete flags[courseId];
          cleaned = true;
        }
      }
    }
    
    if (cleaned) {
      saveGenerationFlags(flags);
    }
    
    return { cleaned };
  } catch (error) {
    console.error('[LearnStateManager] Failed to cleanup flags:', error);
    return { cleaned: false, error };
  }
}

/**
 * Run full maintenance: validation, repair, cleanup.
 */
export function runMaintenance() {
  try {
    const validation = validateAndRepairState();
    const flagCleanup = cleanupExpiredFlags();
    
    // Proactively clean up old data to prevent storage quota issues
    let storageCleanup = { skipped: true };
    try {
      storageCleanup = cleanupOldData({ keepRecentCourses: 10, keepRecentLogs: 100 });
    } catch (cleanupError) {
      console.warn('[LearnStateManager] Storage cleanup failed:', cleanupError);
    }
    
    return {
      success: true,
      validation,
      flagCleanup,
      storageCleanup
    };
  } catch (error) {
    console.error('[LearnStateManager] Maintenance failed:', error);
    return { success: false, error };
  }
}

