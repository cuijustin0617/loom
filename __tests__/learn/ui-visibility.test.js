import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { fullCleanup, initializeStores, createTestCourse } from '../helpers/testUtils';

describe('Learn UI: Visibility and Persistence', () => {
  beforeEach(async () => {
    await fullCleanup();
    await initializeStores();
  });

  describe('Progress Section Visibility', () => {
    it('should always show completed courses in progress section', async () => {
      // Create and complete a course
      const { course } = await createTestCourse({ status: 'started' });
      
      await act(async () => {
        // Mark all modules as done to complete the course
        for (const moduleId of course.moduleIds) {
          await useLearnStore.getState().updateModuleProgress(course.id, moduleId, 'done');
        }
      });

      const completed = useLearnStore.getState().getCompletedCourses();
      expect(completed).toHaveLength(1);
      expect(completed[0].status).toBe('completed');
    });

    it('should never hide completed courses after page operations', async () => {
      // Create and complete a course
      const { course } = await createTestCourse({ status: 'started' });
      
      await act(async () => {
        for (const moduleId of course.moduleIds) {
          await useLearnStore.getState().updateModuleProgress(course.id, moduleId, 'done');
        }
      });

      const beforeOperations = useLearnStore.getState().getCompletedCourses().length;

      // Simulate various operations
      await act(async () => {
        await useLearnStore.getState().addGoal('Another Goal', 'Test');
      });

      const afterOperations = useLearnStore.getState().getCompletedCourses().length;
      expect(afterOperations).toBe(beforeOperations); // Should not decrease
    });

    it('should persist completed courses across reloads', async () => {
      // Create and complete a course
      const { course } = await createTestCourse({ status: 'started' });
      
      await act(async () => {
        for (const moduleId of course.moduleIds) {
          await useLearnStore.getState().updateModuleProgress(course.id, moduleId, 'done');
        }
      });

      const courseId = course.id;

      // Reload stores
      await fullCleanup();
      await initializeStores();

      const completed = useLearnStore.getState().getCompletedCourses();
      expect(completed.length).toBeGreaterThanOrEqual(1);
      expect(completed.find(c => c.id === courseId)).toBeDefined();
    });

    it('should show multiple completed courses', async () => {
      const courseIds = [];
      for (let i = 0; i < 5; i++) {
        const { course } = await createTestCourse({ status: 'started', title: `Course ${i}` });
        courseIds.push(course.id);
        await act(async () => {
          for (const moduleId of course.moduleIds) {
            await useLearnStore.getState().updateModuleProgress(course.id, moduleId, 'done');
          }
        });
      }

      const completed = useLearnStore.getState().getCompletedCourses();
      expect(completed.length).toBeGreaterThanOrEqual(5);
      // Check that all our courses are present
      courseIds.forEach(id => {
        expect(completed.find(c => c.id === id)).toBeDefined();
      });
    });
  });

  describe('Continue Section Visibility', () => {
    it('should always show started courses in continue section', async () => {
      const { course } = await createTestCourse({ status: 'started' });

      const started = useLearnStore.getState().getStartedCourses();
      expect(started).toHaveLength(1);
      expect(started[0].status).toBe('started');
      expect(started[0].id).toBe(course.id);
    });

    it('should persist started courses across operations', async () => {
      const { course } = await createTestCourse({ status: 'started' });
      const courseId = course.id;

      // Add another goal (with unique name to avoid constraint errors)
      await act(async () => {
        const uniqueGoalName = `Another Goal ${Date.now()}`;
        await useLearnStore.getState().addGoal(uniqueGoalName, 'Test');
      });

      const started = useLearnStore.getState().getStartedCourses();
      expect(started.length).toBeGreaterThanOrEqual(1);
      expect(started.find(c => c.id === courseId)).toBeDefined();
    });

    it('should show multiple started courses', async () => {
      const courseIds = [];
      for (let i = 0; i < 3; i++) {
        const { course } = await createTestCourse({ status: 'started', title: `Started ${i}` });
        courseIds.push(course.id);
      }

      const started = useLearnStore.getState().getStartedCourses();
      expect(started.length).toBeGreaterThanOrEqual(3);
      courseIds.forEach(id => {
        expect(started.find(c => c.id === id)).toBeDefined();
      });
    });
  });

  describe('Suggested Section Visibility', () => {
    it('should show suggested outlines', async () => {
      await act(async () => {
        await useLearnStore.getState().addOutline({
          id: 'outline-1',
          courseId: 'course-1',
          title: 'Suggested Course',
          goal: 'Test',
          status: 'suggested',
          summary: 'Test summary',
          questions: [],
          moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
          createdAt: new Date().toISOString()
        });
      });

      const suggested = useLearnStore.getState().getSuggestedOutlines();
      expect(suggested).toHaveLength(1);
    });

    it('should persist suggested outlines', async () => {
      await act(async () => {
        await useLearnStore.getState().addOutline({
          id: 'outline-1',
          courseId: 'course-1',
          title: 'Suggested Course',
          goal: 'Test',
          status: 'suggested',
          summary: 'Test summary',
          questions: [],
          moduleSummary: [],
          createdAt: new Date().toISOString()
        });
      });

      // Reload
      await fullCleanup();
      await initializeStores();

      const suggested = useLearnStore.getState().getSuggestedOutlines();
      expect(suggested).toHaveLength(1);
    });

    it('should show multiple suggested outlines', async () => {
      await act(async () => {
        for (let i = 0; i < 4; i++) {
          await useLearnStore.getState().addOutline({
            id: `outline-${i}`,
            courseId: `course-${i}`,
            title: `Suggested ${i}`,
            goal: 'Test',
            status: 'suggested',
            summary: 'Test',
            questions: [],
            moduleSummary: [],
            createdAt: new Date().toISOString()
          });
        }
      });

      const suggested = useLearnStore.getState().getSuggestedOutlines();
      expect(suggested).toHaveLength(4);
    });
  });

  describe('Empty State Handling', () => {
    it('should not show empty sections when data exists', async () => {
      // Create completed course
      const { course: completedCourse } = await createTestCourse({ status: 'started' });
      await act(async () => {
        for (const moduleId of completedCourse.moduleIds) {
          await useLearnStore.getState().updateModuleProgress(completedCourse.id, moduleId, 'done');
        }
      });
      
      // Create started course
      const { course: startedCourse } = await createTestCourse({ status: 'started' });
      
      // Add suggested outline
      await act(async () => {
        await useLearnStore.getState().addOutline({
          id: 'outline-1',
          courseId: 'course-suggested',
          title: 'Suggested',
          goal: 'Test',
          status: 'suggested',
          summary: 'Test',
          questions: [],
          moduleSummary: [],
          createdAt: new Date().toISOString()
        });
      });

      const completed = useLearnStore.getState().getCompletedCourses();
      const started = useLearnStore.getState().getStartedCourses();
      const suggested = useLearnStore.getState().getSuggestedOutlines();

      // All sections should have data
      expect(completed.length).toBeGreaterThanOrEqual(1);
      expect(started.length).toBeGreaterThanOrEqual(1);
      expect(suggested.length).toBeGreaterThanOrEqual(1);
      
      // Verify our specific courses exist
      expect(completed.find(c => c.id === completedCourse.id)).toBeDefined();
      expect(started.find(c => c.id === startedCourse.id)).toBeDefined();
    });

    it('should maintain all sections after reload', async () => {
      // Create completed course
      const { course: completedCourse } = await createTestCourse({ status: 'started' });
      await act(async () => {
        for (const moduleId of completedCourse.moduleIds) {
          await useLearnStore.getState().updateModuleProgress(completedCourse.id, moduleId, 'done');
        }
      });
      
      const completedId = completedCourse.id;
      
      // Create started course  
      const { course: startedCourse } = await createTestCourse({ status: 'started' });
      const startedId = startedCourse.id;

      await fullCleanup();
      await initializeStores();

      const completed = useLearnStore.getState().getCompletedCourses();
      const started = useLearnStore.getState().getStartedCourses();

      expect(completed.length).toBeGreaterThanOrEqual(1);
      expect(started.length).toBeGreaterThanOrEqual(1);
      
      // Verify our specific courses persist
      expect(completed.find(c => c.id === completedId)).toBeDefined();
      expect(started.find(c => c.id === startedId)).toBeDefined();
    });
  });

  describe('Data Load Timing', () => {
    it('should load all data on initialization', async () => {
      // Pre-populate database
      const { course } = await createTestCourse({ status: 'started' });
      await act(async () => {
        for (const moduleId of course.moduleIds) {
          await useLearnStore.getState().updateModuleProgress(course.id, moduleId, 'done');
        }
      });

      // Fresh init
      await fullCleanup();
      await initializeStores();

      // Data should be available immediately
      const store = useLearnStore.getState();
      expect(Object.keys(store.courses).length).toBeGreaterThanOrEqual(1);
      expect(Object.keys(store.goals).length).toBeGreaterThanOrEqual(1);
    });

    it('should not lose data during concurrent operations', async () => {
      const { course } = await createTestCourse({ status: 'started' });
      const courseId = course.id;
      
      await act(async () => {
        // Complete the course
        for (const moduleId of course.moduleIds) {
          await useLearnStore.getState().updateModuleProgress(course.id, moduleId, 'done');
        }

        // Concurrent operations
        await useLearnStore.getState().addGoal('Goal 2', 'Test 2');
        await useLearnStore.getState().addOutline({
          id: 'outline-1',
          courseId: 'course-2',
          title: 'Outline 1',
          goal: 'Test',
          status: 'suggested',
          summary: 'Test',
          questions: [],
          moduleSummary: [],
          createdAt: new Date().toISOString()
        });
      });

      const completed = useLearnStore.getState().getCompletedCourses();
      const goals = Object.keys(useLearnStore.getState().goals);
      const suggested = useLearnStore.getState().getSuggestedOutlines();

      expect(completed.find(c => c.id === courseId)).toBeDefined();
      expect(goals.length).toBeGreaterThanOrEqual(2);
      expect(suggested.find(o => o.id === 'outline-1')).toBeDefined();
    });
  });
});

