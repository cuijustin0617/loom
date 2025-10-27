/**
 * Learn Mode State Transition Tests
 * 
 * Tests that courses and outlines transition correctly through states:
 * - suggested → saved/started → completed
 * - Nothing disappears without user action
 * - State changes persist across reloads
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { setupTestEnvironment, createTestOutline, createTestCourse, fullCleanup, initializeStores } from '../helpers/testUtils';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { markOutlineStatus } from '../../src/features/learn/services/learnApi';

describe('Learn Mode: State Transitions', () => {
  beforeEach(async () => {
    await setupTestEnvironment();
  });

  describe('Outline → Course Lifecycle', () => {
    it('should keep suggested outline visible until user action', async () => {
      const outline = await createTestOutline();
      
      const suggested = useLearnStore.getState().getSuggestedOutlines();
      expect(suggested).toHaveLength(1);
      expect(suggested[0].id).toBe(outline.id);
      expect(suggested[0].status).toBe('suggested');
    });

    it('should persist suggested outline after reload', async () => {
      const outline = await createTestOutline();
      
      // Simulate reload
      await fullCleanup();
      await initializeStores();
      
      const suggested = useLearnStore.getState().getSuggestedOutlines();
      expect(suggested).toHaveLength(1);
      expect(suggested[0].id).toBe(outline.id);
      expect(suggested[0].status).toBe('suggested');
    });

    it('should move outline from Suggested to Continue on Save', async () => {
      const outline = await createTestOutline();
      
      // Initial state
      let suggested = useLearnStore.getState().getSuggestedOutlines();
      let started = useLearnStore.getState().getStartedCourses();
      expect(suggested).toHaveLength(1);
      expect(started).toHaveLength(0);
      
      // Save the outline
      await act(async () => {
        await markOutlineStatus(outline.id, 'saved', 'save');
      });
      
      // Should move to Continue section
      suggested = useLearnStore.getState().getSuggestedOutlines();
      started = useLearnStore.getState().getStartedCourses();
      
      expect(suggested).toHaveLength(0);
      expect(started).toHaveLength(1);
      expect(started[0].title).toBe(outline.title);
      expect(started[0].status).toBe('started');
    });

    it('should move outline from Suggested to Continue on Start', async () => {
      const outline = await createTestOutline();
      
      const store = useLearnStore.getState();
      
      // Start the course (creates shell course in 'started' status)
      await act(async () => {
        await store.startCourse(outline.id);
      });
      
      const suggested = store.getSuggestedOutlines();
      const started = store.getStartedCourses();
      
      expect(suggested).toHaveLength(0);
      expect(started).toHaveLength(1);
      expect(started[0].status).toBe('started');
    });

    it('should move outline to Pending for Grouping on "Already Know"', async () => {
      const outline = await createTestOutline();
      
      await act(async () => {
        await markOutlineStatus(outline.id, 'completed', 'already_know');
      });
      
      const suggested = useLearnStore.getState().getSuggestedOutlines();
      const completed = useLearnStore.getState().getCompletedCourses();
      
      // Should no longer be in suggested
      expect(suggested).toHaveLength(0);
      
      // Should be in completed
      expect(completed).toHaveLength(1);
      expect(completed[0].status).toBe('completed');
      expect(completed[0].completedVia).toBe('self_report');
      
      // Should have no goal (pending for grouping)
      expect(completed[0].goal).toBe('');
    });

    it('should remove outline from view on Dismiss', async () => {
      const outline = await createTestOutline();
      
      await act(async () => {
        await markOutlineStatus(outline.id, 'dismissed', 'dismiss');
      });
      
      const suggested = useLearnStore.getState().getSuggestedOutlines();
      const started = useLearnStore.getState().getStartedCourses();
      const completed = useLearnStore.getState().getCompletedCourses();
      
      // Should not appear in any section
      expect(suggested).toHaveLength(0);
      expect(started).toHaveLength(0);
      expect(completed).toHaveLength(0);
      
      // But should still exist in database with dismissed status
      const allOutlines = Object.values(useLearnStore.getState().outlines);
      const dismissedOutline = allOutlines.find(o => o.id === outline.id);
      expect(dismissedOutline).toBeDefined();
      expect(dismissedOutline.status).toBe('dismissed');
    });

    it('should not affect other outlines when dismissing one', async () => {
      const outline1 = await createTestOutline({ title: 'Course 1' });
      const outline2 = await createTestOutline({ title: 'Course 2' });
      
      let suggested = useLearnStore.getState().getSuggestedOutlines();
      expect(suggested).toHaveLength(2);
      
      // Dismiss first outline
      await act(async () => {
        await markOutlineStatus(outline1.id, 'dismissed', 'dismiss');
      });
      
      // Second outline should still be visible
      suggested = useLearnStore.getState().getSuggestedOutlines();
      expect(suggested).toHaveLength(1);
      expect(suggested[0].id).toBe(outline2.id);
    });
  });

  describe('Course Progression', () => {
    it('should keep started course in Continue section', async () => {
      const outline = await createTestOutline();
      
      await act(async () => {
        await useLearnStore.getState().startCourse(outline.id);
      });
      
      const started = useLearnStore.getState().getStartedCourses();
      expect(started).toHaveLength(1);
      expect(started[0].status).toBe('started');
    });

    it('should persist started course after reload', async () => {
      const outline = await createTestOutline();
      const courseId = outline.courseId;
      
      await act(async () => {
        await useLearnStore.getState().startCourse(outline.id);
      });
      
      // Simulate reload
      await fullCleanup();
      await initializeStores();
      
      const started = useLearnStore.getState().getStartedCourses();
      expect(started).toHaveLength(1);
      expect(started[0].id).toBe(courseId);
      expect(started[0].status).toBe('started');
    });

    it('should stay in started status while modules are incomplete', async () => {
      const outline = await createTestOutline();
      
      await act(async () => {
        await useLearnStore.getState().startCourse(outline.id);
      });
      
      const course = useLearnStore.getState().getStartedCourses()[0];
      expect(course.status).toBe('started');
      
      // Even after reload, should remain started
      await fullCleanup();
      await initializeStores();
      
      const reloadedCourses = useLearnStore.getState().getStartedCourses();
      expect(reloadedCourses).toHaveLength(1);
      expect(reloadedCourses[0].status).toBe('started');
    });

    it('should move to completed when all modules done', async () => {
      const { course, modules } = await createTestCourse();
      
      // Mark all modules as done
      for (const module of modules) {
        await act(async () => {
          await useLearnStore.getState().updateModuleProgress(course.id, module.id, 'done');
        });
      }
      
      // Should now be completed
      const started = useLearnStore.getState().getStartedCourses();
      const completed = useLearnStore.getState().getCompletedCourses();
      
      expect(started).toHaveLength(0);
      expect(completed).toHaveLength(1);
      expect(completed[0].status).toBe('completed');
      expect(completed[0].completedAt).toBeTruthy();
    });

    it('should NEVER lose completed courses', async () => {
      const outline = await createTestOutline();
      
      // Complete a course
      await act(async () => {
        await markOutlineStatus(outline.id, 'completed', 'already_know');
      });
      
      let completed = useLearnStore.getState().getCompletedCourses();
      expect(completed).toHaveLength(1);
      const completedCourseId = completed[0].id;
      
      // Reload multiple times
      for (let i = 0; i < 3; i++) {
        await fullCleanup();
        await initializeStores();
        
        completed = useLearnStore.getState().getCompletedCourses();
        expect(completed).toHaveLength(1);
        expect(completed[0].id).toBe(completedCourseId);
        expect(completed[0].status).toBe('completed');
      }
    });

    it('should allow multiple courses in progress simultaneously', async () => {
      const outline1 = await createTestOutline({ title: 'Course 1' });
      const outline2 = await createTestOutline({ title: 'Course 2' });
      const outline3 = await createTestOutline({ title: 'Course 3' });
      
      // Start all three
      await act(async () => {
        await useLearnStore.getState().startCourse(outline1.id);
        await useLearnStore.getState().startCourse(outline2.id);
        await useLearnStore.getState().startCourse(outline3.id);
      });
      
      const started = useLearnStore.getState().getStartedCourses();
      expect(started).toHaveLength(3);
      
      // All should persist after reload
      await fullCleanup();
      await initializeStores();
      
      const reloadedStarted = useLearnStore.getState().getStartedCourses();
      expect(reloadedStarted).toHaveLength(3);
    });
  });

  describe('Data Integrity', () => {
    it('should preserve course data through state transitions', async () => {
      const outline = await createTestOutline({
        title: 'Important Course',
        goal: 'Master Testing',
        summary: 'Learn comprehensive testing'
      });
      
      // Save (suggested → started)
      await act(async () => {
        await markOutlineStatus(outline.id, 'saved', 'save');
      });
      
      let course = useLearnStore.getState().getStartedCourses()[0];
      expect(course.title).toBe('Important Course');
      expect(course.goal).toBe('Master Testing');
      
      // Complete (started → completed)
      await act(async () => {
        await useLearnStore.getState().updateCourseStatus(course.id, 'completed');
      });
      
      course = useLearnStore.getState().getCompletedCourses()[0];
      expect(course.title).toBe('Important Course');
      expect(course.goal).toBe('Master Testing');
      expect(course.status).toBe('completed');
    });

    it('should maintain relationship between outline and course', async () => {
      const outline = await createTestOutline();
      
      await act(async () => {
        await useLearnStore.getState().startCourse(outline.id);
      });
      
      const course = useLearnStore.getState().getStartedCourses()[0];
      
      // Course ID should match outline's courseId
      expect(course.id).toBe(outline.courseId);
      
      // Outline should reflect the started status
      const updatedOutline = useLearnStore.getState().outlines[outline.id];
      expect(updatedOutline.status).toBe('started');
      expect(updatedOutline.courseId).toBe(course.id);
    });

    it('should not create duplicate courses from same outline', async () => {
      const outline = await createTestOutline();
      
      // Try to start the same outline twice
      await act(async () => {
        await useLearnStore.getState().startCourse(outline.id);
      });
      
      // Should only have one started course
      let started = useLearnStore.getState().getStartedCourses();
      expect(started).toHaveLength(1);
      
      // Try starting again (should be idempotent)
      await act(async () => {
        await useLearnStore.getState().startCourse(outline.id);
      });
      
      started = useLearnStore.getState().getStartedCourses();
      expect(started).toHaveLength(1);
    });
  });
});

