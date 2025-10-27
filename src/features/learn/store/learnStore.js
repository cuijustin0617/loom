/**
 * Learn Store
 * 
 * Manages courses, modules, goals, and outlines with fully normalized state.
 * Single source of truth for Learn mode data.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import db, { generateId, now } from '../../../lib/db/database';

/**
 * Learn Store
 */
export const useLearnStore = create(
  immer((set, get) => ({
    // Normalized entities
    courses: {},    // { [id]: Course }
    modules: {},    // { [id]: Module }
    goals: {},      // { [id]: Goal }
    outlines: {},   // { [id]: Outline }
    
    // Relationship cache (for performance)
    goalCourses: {}, // { [goalId]: { completed: [], started: [], suggested: [] } }
    
    // UI state
    activeCourseId: null,
    generatingCourseIds: {}, // { [courseId]: true }
    isAutoRefreshing: false, // Auto-refresh suggested feed in progress
    isAutoRegrouping: false, // Auto-regroup in progress
    
    // Computed selectors
    
    /**
     * Get course with its modules populated
     * @param {string} courseId - Course ID
     * @returns {Course & { modules: Module[] }}
     */
    getCourseWithModules: (courseId) => {
      const course = get().courses[courseId];
      if (!course) return null;
      
      const modules = (course.moduleIds || [])
        .map(id => get().modules[id])
        .filter(Boolean)
        .sort((a, b) => a.idx - b.idx);
      
      return { ...course, modules };
    },
    
    /**
     * Get all suggested outlines (max 9 most recent)
     * @returns {Outline[]}
     */
    getSuggestedOutlines: () => {
      return Object.values(get().outlines)
        .filter(o => o.status === 'suggested')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 9); // Only return max 9 most recent
    },
    
    /**
     * Get all started courses
     * @returns {Course[]}
     */
    getStartedCourses: () => {
      return Object.values(get().courses)
        .filter(c => c.status === 'started')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    
    /**
     * Get all completed courses
     * @returns {Course[]}
     */
    getCompletedCourses: () => {
      return Object.values(get().courses)
        .filter(c => c.status === 'completed')
        .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
    },
    
    /**
     * Get courses for a goal
     * @param {string} goalId - Goal ID
     * @returns {{ completed: Course[], started: Course[], suggested: Course[] }}
     */
    getGoalCourses: (goalId) => {
      const cache = get().goalCourses[goalId];
      if (!cache) return { completed: [], started: [], suggested: [] };
      
      return {
        completed: cache.completed.map(id => get().courses[id]).filter(Boolean),
        started: cache.started.map(id => get().courses[id]).filter(Boolean),
        suggested: cache.suggested.map(id => get().courses[id]).filter(Boolean)
      };
    },
    
    /**
     * Get all goals with their course counts
     * @returns {Array<Goal & { completedCount: number, startedCount: number }>}
     */
    getGoalsWithStats: () => {
      return Object.values(get().goals).map(goal => {
        const cache = get().goalCourses[goal.id] || { completed: [], started: [], suggested: [] };
        return {
          ...goal,
          completedCount: cache.completed.length,
          startedCount: cache.started.length
        };
      }).sort((a, b) => b.completedCount - a.completedCount);
    },
    
    // Actions
    
    /**
     * Load all Learn data from database
     */
    loadLearnData: async () => {
      try {
        const [courses, modules, goals, outlines, goalCourseRels] = await Promise.all([
          db.courses.toArray(),
          db.modules.toArray(),
          db.goals.toArray(),
          db.outlines.toArray(),
          db.goalCourses.toArray()
        ]);
        
        console.log('[LearnStore] Loaded data:', {
          courses: courses.length,
          modules: modules.length,
          goals: goals.length,
          outlines: outlines.length
        });
        
        // Build goal-course relationship cache
        const goalCoursesCache = {};
        for (const goal of goals) {
          goalCoursesCache[goal.id] = { completed: [], started: [], suggested: [] };
        }
        
        for (const rel of goalCourseRels) {
          if (!goalCoursesCache[rel.goalId]) continue;
          goalCoursesCache[rel.goalId][rel.status].push(rel.courseId);
        }
        
        set(draft => {
          draft.courses = Object.fromEntries(courses.map(c => [c.id, c]));
          draft.modules = Object.fromEntries(modules.map(m => [m.id, m]));
          draft.goals = Object.fromEntries(goals.map(g => [g.id, g]));
          draft.outlines = Object.fromEntries(outlines.map(o => [o.id, o]));
          draft.goalCourses = goalCoursesCache;
        });
      } catch (error) {
        console.error('[LearnStore] Failed to load data:', error);
      }
    },
    
    /**
     * Add outline (from suggestion generation)
     * @param {Outline} outline - Outline object
     */
    addOutline: async (outline) => {
      const id = outline.id || generateId('outline');
      const fullOutline = {
        ...outline,
        id,
        createdAt: outline.createdAt || now()
      };
      
      console.log('[LearnStore] Adding outline:', id, fullOutline);
      
      // Use put instead of add to allow upserts
      await db.outlines.put(fullOutline);
      
      set(draft => {
        draft.outlines[id] = fullOutline;
      });
      
      console.log('[LearnStore] Outline added to store, current count:', Object.keys(get().outlines).length);
      
      // Auto-cleanup old suggested outlines if we have too many
      const suggestedCount = Object.values(get().outlines).filter(o => o.status === 'suggested').length;
      if (suggestedCount > 9) {
        await get().cleanupOldSuggestedOutlines();
      }
    },
    
    /**
     * Alias for addOutline (for convenience in tests)
     */
    saveOutline: async (outline) => {
      return await get().addOutline(outline);
    },
    
    /**
     * Add multiple outlines in batch (more efficient)
     * @param {Outline[]} outlines - Array of outline objects
     */
    addOutlinesBatch: async (outlines) => {
      console.log('[LearnStore] Adding', outlines.length, 'outlines in batch');
      
      const fullOutlines = outlines.map(outline => ({
        ...outline,
        id: outline.id || generateId('outline'),
        createdAt: outline.createdAt || now()
      }));
      
      // Save to database
      await db.outlines.bulkPut(fullOutlines);
      
      // Update store in one transaction
      set(draft => {
        for (const outline of fullOutlines) {
          draft.outlines[outline.id] = outline;
        }
      });
      
      console.log('[LearnStore] Batch added, current count:', Object.keys(get().outlines).length);
      
      // Auto-cleanup old suggested outlines if we have too many
      const suggestedCount = Object.values(get().outlines).filter(o => o.status === 'suggested').length;
      if (suggestedCount > 9) {
        await get().cleanupOldSuggestedOutlines();
      }
    },
    
    /**
     * Update outline status
     * @param {string} id - Outline ID
     * @param {'suggested'|'saved'|'started'|'completed'|'dismissed'} status
     */
    updateOutlineStatus: async (id, status) => {
      await db.outlines.update(id, { status });
      
      set(draft => {
        if (draft.outlines[id]) {
          draft.outlines[id].status = status;
        }
      });
    },
    
    /**
     * Clear all suggested outlines (used when refreshing suggestions)
     */
    clearSuggestedOutlines: async () => {
      const suggestedOutlines = Object.values(get().outlines).filter(o => o.status === 'suggested');
      
      console.log('[LearnStore] Clearing', suggestedOutlines.length, 'suggested outlines');
      
      // Delete from database
      for (const outline of suggestedOutlines) {
        await db.outlines.delete(outline.id);
      }
      
      // Remove from store
      set(draft => {
        for (const outline of suggestedOutlines) {
          delete draft.outlines[outline.id];
        }
      });
      
      console.log('[LearnStore] Cleared suggested outlines, remaining:', Object.keys(get().outlines).length);
    },
    
    /**
     * Cleanup old suggested outlines, keeping only the 9 most recent
     */
    cleanupOldSuggestedOutlines: async () => {
      const MAX_SUGGESTED = 9;
      const suggestedOutlines = Object.values(get().outlines)
        .filter(o => o.status === 'suggested')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      
      if (suggestedOutlines.length <= MAX_SUGGESTED) {
        console.log('[LearnStore] No cleanup needed, only', suggestedOutlines.length, 'suggested outlines');
        return;
      }
      
      // Keep the 9 most recent, delete the rest
      const toDelete = suggestedOutlines.slice(MAX_SUGGESTED);
      
      console.log('[LearnStore] Cleaning up', toDelete.length, 'old suggested outlines (keeping', MAX_SUGGESTED, 'most recent)');
      
      // Delete from database
      for (const outline of toDelete) {
        await db.outlines.delete(outline.id);
      }
      
      // Remove from store
      set(draft => {
        for (const outline of toDelete) {
          delete draft.outlines[outline.id];
        }
      });
      
      console.log('[LearnStore] Cleanup complete, now have', Object.keys(get().outlines).filter(id => get().outlines[id].status === 'suggested').length, 'suggested outlines');
    },
    
    /**
     * Start course (atomic operation)
     * Creates course from outline if it doesn't exist.
     * @param {string} outlineId - Outline ID
     * @returns {Promise<{success: boolean, courseId?: string, error?: string}>}
     */
    startCourse: async (outlineId) => {
      const outline = get().outlines[outlineId];
      if (!outline) {
        return { success: false, error: 'Outline not found' };
      }
      
      const courseId = outline.courseId;
      
      // Check if course already exists
      const existingCourse = get().courses[courseId];
      if (existingCourse) {
        // Just update status
        if (existingCourse.status !== 'started') {
          await get().updateCourseStatus(courseId, 'started');
        }
        await get().updateOutlineStatus(outlineId, 'started');
        return { success: true, courseId };
      }
      
      // Create shell course immediately so it shows in "Continue" section
      const shellCourse = {
        id: courseId,
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
      
      // Save shell course to database
      await db.courses.add(shellCourse);
      
      // Add to store
      set(draft => {
        draft.courses[courseId] = shellCourse;
      });
      
      console.log('[LearnStore] Created shell course:', courseId, 'for outline:', outlineId);
      
      // Mark outline as started
      await get().updateOutlineStatus(outlineId, 'started');
      
      return { success: true, courseId, needsGeneration: true };
    },
    
    /**
     * Save generated course (from LLM)
     * @param {Course & { modules: Module[] }} courseData - Full course with modules
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    saveCourse: async (courseData) => {
      try {
        const courseId = courseData.id || generateId('course');
        
        // Transaction for atomicity
        await db.transaction('rw', [db.courses, db.modules, db.outlines, db.goals, db.goalCourses], async () => {
          // Save course
          const course = {
            id: courseId,
            title: courseData.title,
            goal: courseData.goal,
            questionIds: courseData.questionIds || courseData.questions_you_will_answer || [],
            moduleIds: [],
            whereToGoNext: courseData.whereToGoNext || courseData.where_to_go_next || '',
            status: courseData.status || 'started',
            progressByModule: courseData.progressByModule || {},
            completedVia: courseData.completedVia || null,
            createdAt: courseData.createdAt || now(),
            completedAt: courseData.status === 'completed' ? (courseData.completedAt || now()) : null
          };
          
          // Save modules
          const moduleIds = [];
          const modulesArray = courseData.modules || [];
          
          for (const moduleData of modulesArray) {
            const moduleId = moduleData.id || moduleData.module_id || generateId('mod');
            
            const module = {
              id: moduleId,
              courseId: courseId,
              idx: moduleData.idx || 1,
              title: moduleData.title || 'Module',
              estMinutes: moduleData.estMinutes || moduleData.est_minutes || 5,
              lesson: moduleData.lesson || '',
              microTask: moduleData.microTask || moduleData.micro_task || '',
              quiz: moduleData.quiz || [],
              refs: moduleData.refs || []
            };
            
            await db.modules.put(module);
            moduleIds.push(moduleId);
          }
          
          course.moduleIds = moduleIds;
          await db.courses.put(course);
          
          // Update outline status
          await db.outlines
            .where('courseId')
            .equals(courseId)
            .modify({ status: course.status });
          
          // Update goal relationship
          if (course.goal) {
            let goal = await db.goals.where('label').equals(course.goal).first();
            
            if (!goal) {
              // Create new goal
              const goalId = generateId('goal');
              goal = {
                id: goalId,
                label: course.goal,
                createdAt: now()
              };
              await db.goals.add(goal);
            }
            
            // Add goal-course relationship
            await db.goalCourses.put({
              goalId: goal.id,
              courseId: courseId,
              status: course.status
            });
          }
          
          // Update store
          set(draft => {
            draft.courses[courseId] = course;
            
            for (const mod of modulesArray) {
              const moduleId = mod.id || mod.module_id;
              if (moduleId && draft.modules[moduleId]) {
                draft.modules[moduleId] = {
                  ...draft.modules[moduleId],
                  ...mod
                };
              } else if (moduleId) {
                draft.modules[moduleId] = mod;
              }
            }
            
            // Update outline
            if (draft.outlines[courseId]) {
              draft.outlines[courseId].status = course.status;
            }
          });
        });
        
        // Reload goal relationships
        await get().loadLearnData();
        
        return { success: true };
      } catch (error) {
        console.error('[LearnStore] Failed to save course:', error);
        return { success: false, error: error.message };
      }
    },
    
    /**
     * Update course status
     * @param {string} courseId - Course ID
     * @param {'suggested'|'saved'|'started'|'completed'|'dismissed'} status
     */
    updateCourseStatus: async (courseId, status) => {
      const completedAt = status === 'completed' ? now() : null;
      
      try {
        await db.transaction('rw', [db.courses, db.outlines, db.goals, db.goalCourses], async () => {
          await db.courses.update(courseId, { status, completedAt });
          await db.outlines.where('courseId').equals(courseId).modify({ status });
          
          // Update goal-course relationship
          const course = await db.courses.get(courseId);
          if (course && course.goal) {
            const goal = await db.goals.where('label').equals(course.goal).first();
            if (goal) {
              await db.goalCourses
                .where('[goalId+courseId]')
                .equals([goal.id, courseId])
                .modify({ status });
            }
          }
        });
      } catch (error) {
        console.error('[LearnStore] Failed to update course status:', error);
        // Even if DB update fails, update store
      }
      
      set(draft => {
        if (draft.courses[courseId]) {
          draft.courses[courseId].status = status;
          if (completedAt) {
            draft.courses[courseId].completedAt = completedAt;
          }
        }
        
        // Update outline
        if (draft.outlines[courseId]) {
          draft.outlines[courseId].status = status;
        }
      });
    },
    
    /**
     * Update module progress
     * @param {string} courseId - Course ID
     * @param {string} moduleId - Module ID
     * @param {'not_started'|'in_progress'|'done'} progress
     */
    updateModuleProgress: async (courseId, moduleId, progress) => {
      const course = get().courses[courseId];
      if (!course) return;
      
      const newProgress = { ...course.progressByModule, [moduleId]: progress };
      
      // Check if all modules are done
      const allDone = course.moduleIds.every(id => newProgress[id] === 'done');
      const newStatus = allDone ? 'completed' : 'started';
      const completedAt = allDone ? now() : null;
      
      // Update database with transaction to update related tables
      try {
        await db.transaction('rw', [db.courses, db.outlines, db.goalCourses, db.goals], async () => {
          await db.courses.update(courseId, {
            progressByModule: newProgress,
            status: newStatus,
            completedAt
          });
          
          // Update outline if it exists
          await db.outlines.where('courseId').equals(courseId).modify({ status: newStatus });
          
          // Update goal-course relationship if it exists
          const updatedCourse = await db.courses.get(courseId);
          if (updatedCourse && updatedCourse.goal) {
            const goal = await db.goals.where('label').equals(updatedCourse.goal).first();
            if (goal) {
              await db.goalCourses
                .where('[goalId+courseId]')
                .equals([goal.id, courseId])
                .modify({ status: newStatus });
            }
          }
        });
      } catch (error) {
        console.error('[LearnStore] Failed to update module progress:', error);
        // Even if DB update fails, update store
      }
      
      set(draft => {
        if (draft.courses[courseId]) {
          draft.courses[courseId].progressByModule = newProgress;
          draft.courses[courseId].status = newStatus;
          if (allDone) {
            draft.courses[courseId].completedAt = completedAt;
          }
        }
        
        // Update outline in store if it exists
        if (draft.outlines[courseId]) {
          draft.outlines[courseId].status = newStatus;
        }
      });
    },
    
    /**
     * Mark course as generating (to prevent duplicate generation)
     * @param {string} courseId - Course ID
     * @param {boolean} generating - Generating state
     */
    setGenerating: (courseId, generating) => {
      set(draft => {
        if (generating) {
          draft.generatingCourseIds[courseId] = true;
        } else {
          delete draft.generatingCourseIds[courseId];
        }
      });
    },
    
    /**
     * Check if course is currently generating
     * @param {string} courseId - Course ID
     * @returns {boolean}
     */
    isGenerating: (courseId) => {
      return !!get().generatingCourseIds[courseId];
    },
    
    /**
     * Set auto-refresh state
     * @param {boolean} refreshing - Auto-refresh state
     */
    setAutoRefreshing: (refreshing) => {
      set(draft => {
        draft.isAutoRefreshing = refreshing;
      });
    },
    
    /**
     * Set auto-regroup state
     * @param {boolean} regrouping - Auto-regroup state
     */
    setAutoRegrouping: (regrouping) => {
      set(draft => {
        draft.isAutoRegrouping = regrouping;
      });
    },
    
    /**
     * Get count of pending courses (completed with no goal)
     * @returns {number}
     */
    getPendingCoursesCount: () => {
      return Object.values(get().courses)
        .filter(c => c.status === 'completed' && (!c.goal || c.goal.trim() === ''))
        .length;
    },
    
    /**
     * Set active course (for modal)
     * @param {string|null} courseId - Course ID or null
     */
    setActiveCourse: (courseId) => {
      set(draft => {
        draft.activeCourseId = courseId;
      });
    },
    
    /**
     * Add a new goal
     * @param {string} label - Goal label
     * @param {string} description - Goal description
     * @returns {Promise<string>} Goal ID
     */
    addGoal: async (label, description = '') => {
      const goalId = generateId('goal');
      const goal = {
        id: goalId,
        label,
        description,
        createdAt: now()
      };
      
      await db.goals.add(goal);
      
      set(draft => {
        draft.goals[goalId] = goal;
        draft.goalCourses[goalId] = { completed: [], started: [], suggested: [] };
      });
      
      return goalId;
    },
    
    /**
     * Update an existing goal
     * @param {string} goalId - Goal ID
     * @param {Partial<Goal>} updates - Goal updates
     */
    updateGoal: async (goalId, updates) => {
      await db.goals.update(goalId, updates);
      
      set(draft => {
        if (draft.goals[goalId]) {
          Object.assign(draft.goals[goalId], updates);
        }
      });
    },
    
    /**
     * Delete a goal and all related course relationships
     * @param {string} goalId - Goal ID
     */
    deleteGoal: async (goalId) => {
      await db.transaction('rw', [db.goals, db.goalCourses], async () => {
        await db.goals.delete(goalId);
        await db.goalCourses.where('goalId').equals(goalId).delete();
      });
      
      set(draft => {
        delete draft.goals[goalId];
        delete draft.goalCourses[goalId];
      });
    },
    
    /**
     * Update course goal assignment
     * @param {string} courseId - Course ID
     * @param {string} goalLabel - Goal label
     */
    updateCourseGoal: async (courseId, goalLabel) => {
      const course = get().courses[courseId];
      if (!course) return;
      
      console.log('[LearnStore] Updating course goal:', courseId, '->', goalLabel);
      
      // Find or create goal
      let goal = Object.values(get().goals).find(g => g.label === goalLabel);
      
      if (!goal) {
        const goalId = generateId('goal');
        goal = {
          id: goalId,
          label: goalLabel,
          createdAt: now()
        };
        
        await db.goals.add(goal);
        
        set(draft => {
          draft.goals[goalId] = goal;
        });
      }
      
      // Update goal-course relationship
      await db.goalCourses.put({
        goalId: goal.id,
        courseId: courseId,
        status: course.status
      });
      
      // Update store
      set(draft => {
        if (draft.courses[courseId]) {
          draft.courses[courseId].goal = goalLabel;
        }
        
        // Update goalCourses cache
        if (!draft.goalCourses[goal.id]) {
          draft.goalCourses[goal.id] = { completed: [], started: [], suggested: [] };
        }
        
        if (!draft.goalCourses[goal.id][course.status].includes(courseId)) {
          draft.goalCourses[goal.id][course.status].push(courseId);
        }
      });
      
      console.log('[LearnStore] Course goal updated');
    },
    
    /**
     * Delete course and all related data
     * @param {string} courseId - Course ID
     */
    deleteCourse: async (courseId) => {
      await db.transaction('rw', [db.courses, db.modules, db.outlines, db.goalCourses], async () => {
        const course = await db.courses.get(courseId);
        
        if (course) {
          // Delete modules
          for (const moduleId of course.moduleIds || []) {
            await db.modules.delete(moduleId);
          }
          
          // Delete course
          await db.courses.delete(courseId);
          
          // Delete outline
          await db.outlines.where('courseId').equals(courseId).delete();
          
          // Delete goal relationships
          await db.goalCourses.where('courseId').equals(courseId).delete();
        }
      });
      
      set(draft => {
        const course = draft.courses[courseId];
        if (course) {
          // Remove modules
          for (const moduleId of course.moduleIds || []) {
            delete draft.modules[moduleId];
          }
          
          // Remove course
          delete draft.courses[courseId];
          
          // Remove outline
          delete draft.outlines[courseId];
        }
      });
      
      // Reload to refresh relationships
      await get().loadLearnData();
    },
    
    /**
     * Cleanup old data (keep only recent completed courses)
     * @param {number} keepCount - Number of completed courses to keep
     */
    cleanupOldCourses: async (keepCount = 20) => {
      const completed = get().getCompletedCourses();
      const toDelete = completed.slice(keepCount);
      
      for (const course of toDelete) {
        await get().deleteCourse(course.id);
      }
    }
  }))
);

/**
 * Initialize learn store (call on app mount)
 */
export async function initializeLearn() {
  await useLearnStore.getState().loadLearnData();
}

