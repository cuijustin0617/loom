import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { fullCleanup, initializeStores, createTestCourse } from '../helpers/testUtils';
import { generateId } from '../../src/lib/db/database';

describe('Learn Mode: Data Initialization and Visibility', () => {
  beforeEach(async () => {
    await fullCleanup();
    await initializeStores();
  });

  describe('Initial Load from Database', () => {
    it('should load all courses from database on initialization', async () => {
      // Create courses in DB
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        await createTestCourse({ status: 'completed', title: 'Completed Course' });
        await createTestCourse({ status: 'started', title: 'Started Course' });
      });

      // Simulate app restart by reinitializing
      await act(async () => {
        await fullCleanup();
        await initializeStores();
      });

      // Data should be loaded from DB
      const store = useLearnStore.getState();
      const completed = store.getCompletedCourses();
      const started = store.getStartedCourses();
      
      expect(completed.length).toBeGreaterThanOrEqual(1);
      expect(started.length).toBeGreaterThanOrEqual(1);
    });

    it('should load suggested outlines from database on initialization', async () => {
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        // Add suggested outlines
        for (let i = 0; i < 3; i++) {
          const outlineId = generateId('outline');
          await useLearnStore.getState().saveOutline({
            id: outlineId,
            title: `Outline ${i}`,
            goal: uniqueGoal,
            modules: [],
            whereToGoNext: '',
            status: 'suggested',
            createdAt: new Date(Date.now() + i * 1000).toISOString()
          });
        }
      });

      // Simulate app restart
      await act(async () => {
        await fullCleanup();
        await initializeStores();
      });

      // Suggested should be loaded
      const store = useLearnStore.getState();
      const suggested = store.getSuggestedOutlines();
      
      expect(suggested.length).toBeGreaterThanOrEqual(3);
    });

    it('should maintain data consistency after operations', async () => {
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        await createTestCourse({ status: 'completed', title: 'Course 1' });
      });

      const beforeCount = useLearnStore.getState().getCompletedCourses().length;

      // Perform various operations
      await act(async () => {
        await useLearnStore.getState().addGoal('Another Goal', 'Description');
        await createTestCourse({ status: 'started', title: 'Course 2' });
      });

      const afterCount = useLearnStore.getState().getCompletedCourses().length;
      
      // Completed courses should not disappear
      expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
    });
  });

  describe('Data Persistence After Actions', () => {
    it('should not lose completed courses after dismissing an outline', async () => {
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        await createTestCourse({ status: 'completed', title: 'Completed Course' });
        
        // Add and dismiss an outline
        const outlineId = generateId('outline');
        await useLearnStore.getState().saveOutline({
          id: outlineId,
          title: 'Outline to Dismiss',
          goal: 'Test Goal',
          modules: [],
          whereToGoNext: '',
          status: 'suggested',
          createdAt: new Date().toISOString()
        });
        
        await useLearnStore.getState().updateOutlineStatus(outlineId, 'dismissed');
      });

      const store = useLearnStore.getState();
      const completed = store.getCompletedCourses();
      
      // Completed course should still be there
      expect(completed.length).toBeGreaterThanOrEqual(1);
      expect(completed.some(c => c.title === 'Completed Course')).toBe(true);
    });

    it('should not lose started courses after generating new suggestions', async () => {
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        await createTestCourse({ status: 'started', title: 'Started Course' });
        
        // Add new suggested outlines (simulating new generation)
        for (let i = 0; i < 3; i++) {
          const outlineId = generateId('outline');
          await useLearnStore.getState().saveOutline({
            id: outlineId,
            title: `New Outline ${i}`,
            goal: uniqueGoal,
            modules: [],
            whereToGoNext: '',
            status: 'suggested',
            createdAt: new Date(Date.now() + i * 1000).toISOString()
          });
        }
      });

      const store = useLearnStore.getState();
      const started = store.getStartedCourses();
      
      // Started course should still be there
      expect(started.length).toBeGreaterThanOrEqual(1);
      expect(started.some(c => c.title === 'Started Course')).toBe(true);
    });

    it('should not lose data after marking outline as already known', async () => {
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        await createTestCourse({ status: 'completed', title: 'Existing Completed' });
        await createTestCourse({ status: 'started', title: 'Existing Started' });
        
        // Add outline and mark as already known
        const outlineId = generateId('outline');
        await useLearnStore.getState().saveOutline({
          id: outlineId,
          title: 'Outline for Already Known',
          goal: 'Test Goal',
          modules: [
            {
              id: generateId('module'),
              title: 'Module 1',
              estMinutes: 5,
              lesson: 'Content',
              microTask: 'Task',
              quiz: [],
              refs: []
            }
          ],
          whereToGoNext: '',
          status: 'suggested',
          createdAt: new Date().toISOString()
        });
        
        // Mark as already known (this creates a completed course)
        await useLearnStore.getState().updateOutlineStatus(outlineId, 'completed');
      });

      const store = useLearnStore.getState();
      const completed = store.getCompletedCourses();
      const started = store.getStartedCourses();
      
      // All courses should still be present
      expect(completed.length).toBeGreaterThanOrEqual(1);
      expect(started.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Empty State Handling', () => {
    it('should handle empty state gracefully', async () => {
      const beforeState = useLearnStore.getState();
      const beforeCompleted = beforeState.getCompletedCourses().length;
      const beforeStarted = beforeState.getStartedCourses().length;
      const beforeSuggested = beforeState.getSuggestedOutlines().length;
      
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
      });

      const afterState = useLearnStore.getState();
      const afterCompleted = afterState.getCompletedCourses().length;
      const afterStarted = afterState.getStartedCourses().length;
      const afterSuggested = afterState.getSuggestedOutlines().length;
      
      // Adding just a goal shouldn't create courses
      expect(afterCompleted).toBe(beforeCompleted);
      expect(afterStarted).toBe(beforeStarted);
      expect(afterSuggested).toBe(beforeSuggested);
    });

    it('should show data immediately after adding first course', async () => {
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        await createTestCourse({ status: 'started', title: 'First Course' });
      });

      const store = useLearnStore.getState();
      const started = store.getStartedCourses();
      
      expect(started.length).toBeGreaterThanOrEqual(1);
      expect(started[0].title).toBe('First Course');
    });

    it('should transition from empty to populated state correctly', async () => {
      // Track count before
      const beforeCount = useLearnStore.getState().getCompletedCourses().length;
      
      // Add a course
      await act(async () => {
        await createTestCourse({ status: 'completed', title: 'New Course' });
      });

      const afterCount = useLearnStore.getState().getCompletedCourses().length;
      const completed = useLearnStore.getState().getCompletedCourses();
      
      // Count should increase by at least 1
      expect(afterCount).toBeGreaterThan(beforeCount);
      
      // New course should be findable
      expect(completed.some(c => c.title === 'New Course')).toBe(true);
    });
  });

  describe('Data Consistency Across Store Updates', () => {
    it('should maintain consistency when updating multiple entities', async () => {
      await act(async () => {
        await useLearnStore.getState().addGoal('Goal 1', 'Description');
        await useLearnStore.getState().addGoal('Goal 2', 'Description');
        await createTestCourse({ status: 'completed', goal: 'Goal 1', title: 'Course 1' });
        await createTestCourse({ status: 'started', goal: 'Goal 2', title: 'Course 2' });
      });

      const store = useLearnStore.getState();
      const goals = Object.values(store.goals);
      const completed = store.getCompletedCourses();
      const started = store.getStartedCourses();
      
      expect(goals.length).toBeGreaterThanOrEqual(2);
      expect(completed.length).toBeGreaterThanOrEqual(1);
      expect(started.length).toBeGreaterThanOrEqual(1);
    });

    it('should not lose course data when updating module progress', async () => {
      const { course, modules } = await createTestCourse({ status: 'started' });
      
      const beforeCourses = useLearnStore.getState().getStartedCourses().length;
      
      await act(async () => {
        await useLearnStore.getState().updateModuleProgress(course.id, modules[0].id, 'done');
      });
      
      const afterCourses = useLearnStore.getState().getStartedCourses().length;
      
      expect(afterCourses).toBe(beforeCourses); // Should not change count
    });

    it('should properly transition course from started to completed', async () => {
      const { course, modules } = await createTestCourse({ status: 'started' });
      
      await act(async () => {
        // Complete all modules
        for (const module of modules) {
          await useLearnStore.getState().updateModuleProgress(course.id, module.id, 'done');
        }
      });
      
      const store = useLearnStore.getState();
      const started = store.getStartedCourses();
      const completed = store.getCompletedCourses();
      
      // Course should move from started to completed
      expect(started.some(c => c.id === course.id)).toBe(false);
      expect(completed.some(c => c.id === course.id)).toBe(true);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple simultaneous outline additions', async () => {
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        // Add multiple outlines without awaiting
        const promises = [];
        for (let i = 0; i < 5; i++) {
          promises.push(
            useLearnStore.getState().saveOutline({
              id: generateId('outline'),
              title: `Outline ${i}`,
              goal: uniqueGoal,
              modules: [],
              whereToGoNext: '',
              status: 'suggested',
              createdAt: new Date(Date.now() + i * 100).toISOString()
            })
          );
        }
        
        await Promise.all(promises);
      });

      const store = useLearnStore.getState();
      const suggested = store.getSuggestedOutlines();
      
      expect(suggested.length).toBeGreaterThanOrEqual(5);
    });

    it('should handle concurrent course completions', async () => {
      const course1 = await createTestCourse({ status: 'started', title: 'Course 1' });
      const course2 = await createTestCourse({ status: 'started', title: 'Course 2' });
      
      await act(async () => {
        // Complete both courses' modules
        const promises = [];
        for (const module of course1.modules) {
          promises.push(useLearnStore.getState().updateModuleProgress(course1.course.id, module.id, 'done'));
        }
        for (const module of course2.modules) {
          promises.push(useLearnStore.getState().updateModuleProgress(course2.course.id, module.id, 'done'));
        }
        
        await Promise.all(promises);
      });

      const store = useLearnStore.getState();
      const completed = store.getCompletedCourses();
      
      expect(completed.length).toBeGreaterThanOrEqual(2);
    });
  });
});

