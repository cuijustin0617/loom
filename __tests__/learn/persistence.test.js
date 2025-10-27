/**
 * Learn Mode Persistence Tests
 * 
 * Tests that all Learn mode data persists correctly across:
 * - Page reloads
 * - Database operations
 * - Store reinitialization
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { setupTestEnvironment, createTestOutline, createTestCourse, fullCleanup, initializeStores } from '../helpers/testUtils';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import db from '../../src/lib/db/database';

describe('Learn Mode: Persistence', () => {
  beforeEach(async () => {
    await setupTestEnvironment();
  });

  describe('Outlines Persistence', () => {
    it('should persist suggested outlines in IndexedDB', async () => {
      const outline = await createTestOutline();
      
      // Check IndexedDB directly
      const dbOutlines = await db.outlines.toArray();
      expect(dbOutlines).toHaveLength(1);
      expect(dbOutlines[0].id).toBe(outline.id);
      expect(dbOutlines[0].status).toBe('suggested');
    });

    it('should load outlines from IndexedDB on init', async () => {
      const outline1 = await createTestOutline({ title: 'Course 1' });
      const outline2 = await createTestOutline({ title: 'Course 2' });
      
      // Clear store but keep database
      useLearnStore.setState({
        outlines: {},
        courses: {},
        modules: {},
        goals: {},
        goalCourses: {}
      });
      
      // Reinitialize
      await act(async () => {
        await useLearnStore.getState().loadLearnData();
      });
      
      const outlines = Object.values(useLearnStore.getState().outlines);
      expect(outlines).toHaveLength(2);
      expect(outlines.map(o => o.title).sort()).toEqual(['Course 1', 'Course 2']);
    });

    it('should survive multiple reload cycles', async () => {
      const outline = await createTestOutline({ title: 'Persistent Course' });
      
      for (let i = 0; i < 5; i++) {
        await fullCleanup();
        await initializeStores();
        
        const outlines = useLearnStore.getState().getSuggestedOutlines();
        expect(outlines).toHaveLength(1);
        expect(outlines[0].title).toBe('Persistent Course');
      }
    });
  });

  describe('Courses Persistence', () => {
    it('should persist started courses in IndexedDB', async () => {
      const { course } = await createTestCourse({ status: 'started' });
      
      // Check IndexedDB
      const dbCourses = await db.courses.toArray();
      expect(dbCourses).toHaveLength(1);
      expect(dbCourses[0].id).toBe(course.id);
      expect(dbCourses[0].status).toBe('started');
    });

    it('should persist completed courses in IndexedDB', async () => {
      const { course } = await createTestCourse({ 
        status: 'completed',
        completedAt: new Date().toISOString()
      });
      
      const dbCourses = await db.courses.toArray();
      expect(dbCourses).toHaveLength(1);
      expect(dbCourses[0].status).toBe('completed');
      expect(dbCourses[0].completedAt).toBeTruthy();
    });

    it('should load courses from IndexedDB on init', async () => {
      await createTestCourse({ title: 'Course A', status: 'started' });
      await createTestCourse({ title: 'Course B', status: 'completed' });
      
      // Clear and reload
      await fullCleanup();
      await initializeStores();
      
      const started = useLearnStore.getState().getStartedCourses();
      const completed = useLearnStore.getState().getCompletedCourses();
      
      expect(started).toHaveLength(1);
      expect(started[0].title).toBe('Course A');
      
      expect(completed).toHaveLength(1);
      expect(completed[0].title).toBe('Course B');
    });

    it('should persist course metadata correctly', async () => {
      const { course } = await createTestCourse({
        title: 'Advanced Testing',
        goal: 'Master Tests',
        questionIds: ['Q1', 'Q2', 'Q3'],
        whereToGoNext: 'Study more patterns'
      });
      
      await fullCleanup();
      await initializeStores();
      
      const reloaded = Object.values(useLearnStore.getState().courses)[0];
      expect(reloaded.title).toBe('Advanced Testing');
      expect(reloaded.goal).toBe('Master Tests');
      expect(reloaded.questionIds).toEqual(['Q1', 'Q2', 'Q3']);
      expect(reloaded.whereToGoNext).toBe('Study more patterns');
    });
  });

  describe('Modules Persistence', () => {
    it('should persist modules in IndexedDB', async () => {
      const { modules } = await createTestCourse();
      
      const dbModules = await db.modules.toArray();
      expect(dbModules).toHaveLength(2);
      expect(dbModules.map(m => m.title).sort()).toEqual(['Module 1', 'Module 2']);
    });

    it('should load modules with courses', async () => {
      const { course, modules } = await createTestCourse();
      
      await fullCleanup();
      await initializeStores();
      
      const reloaded = useLearnStore.getState().getCourseWithModules(course.id);
      expect(reloaded).toBeTruthy();
      expect(reloaded.modules).toHaveLength(2);
      expect(reloaded.modules[0].id).toBe(modules[0].id);
      expect(reloaded.modules[1].id).toBe(modules[1].id);
    });

    it('should persist module content', async () => {
      const { course, modules } = await createTestCourse();
      
      await fullCleanup();
      await initializeStores();
      
      const reloaded = useLearnStore.getState().getCourseWithModules(course.id);
      const module1 = reloaded.modules[0];
      
      expect(module1.lesson).toBe('# Module 1 Content');
      expect(module1.microTask).toBe('Complete task 1');
      expect(module1.quiz).toHaveLength(1);
      expect(module1.quiz[0].question).toBe('Test question 1?');
    });

    it('should persist module progress', async () => {
      const { course, modules } = await createTestCourse();
      
      // Mark first module as done
      await act(async () => {
        await useLearnStore.getState().updateModuleProgress(course.id, modules[0].id, 'done');
      });
      
      await fullCleanup();
      await initializeStores();
      
      const reloaded = useLearnStore.getState().getCourseWithModules(course.id);
      expect(reloaded.progressByModule[modules[0].id]).toBe('done');
      expect(reloaded.progressByModule[modules[1].id]).toBeUndefined();
    });
  });

  describe('Goals and Relationships', () => {
    it('should persist goals in IndexedDB', async () => {
      const store = useLearnStore.getState();
      
      await act(async () => {
        await store.addGoal('JavaScript', 'Learn JavaScript deeply');
        await store.addGoal('React', 'Master React framework');
      });
      
      const dbGoals = await db.goals.toArray();
      expect(dbGoals).toHaveLength(2);
      expect(dbGoals.map(g => g.label).sort()).toEqual(['JavaScript', 'React']);
    });

    it('should persist goal-course relationships', async () => {
      // Create goal
      await act(async () => {
        await useLearnStore.getState().addGoal('Testing', 'Learn testing');
      });
      
      // Create course with goal
      const { course } = await createTestCourse({ 
        goal: 'Testing',
        status: 'completed'
      });
      
      // Check relationship in IndexedDB
      const dbRelations = await db.goalCourses.toArray();
      expect(dbRelations.length).toBeGreaterThan(0);
      
      await fullCleanup();
      await initializeStores();
      
      // Should restore relationship
      const goals = useLearnStore.getState().getGoalsWithStats();
      const testingGoal = goals.find(g => g.label === 'Testing');
      expect(testingGoal).toBeTruthy();
      expect(testingGoal.completedCount).toBe(1);
    });

    it('should load goal stats correctly after reload', async () => {
      await act(async () => {
        await useLearnStore.getState().addGoal('Programming', 'Learn to code');
      });
      
      // Create multiple courses for the goal
      await createTestCourse({ goal: 'Programming', status: 'completed' });
      await createTestCourse({ goal: 'Programming', status: 'started' });
      await createTestCourse({ goal: 'Programming', status: 'completed' });
      
      await fullCleanup();
      await initializeStores();
      
      const goals = useLearnStore.getState().getGoalsWithStats();
      const programmingGoal = goals.find(g => g.label === 'Programming');
      
      expect(programmingGoal.completedCount).toBe(2);
      expect(programmingGoal.startedCount).toBe(1);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple concurrent saves', async () => {
      const promises = [];
      
      for (let i = 0; i < 5; i++) {
        promises.push(createTestOutline({ title: `Course ${i}` }));
      }
      
      await Promise.all(promises);
      
      const outlines = useLearnStore.getState().getSuggestedOutlines();
      expect(outlines).toHaveLength(5);
      
      // All should persist
      await fullCleanup();
      await initializeStores();
      
      const reloadedOutlines = useLearnStore.getState().getSuggestedOutlines();
      expect(reloadedOutlines).toHaveLength(5);
    });

    it('should maintain consistency during rapid state changes', async () => {
      const { course, modules } = await createTestCourse();
      
      // Rapid state changes
      await act(async () => {
        for (const module of modules) {
          await useLearnStore.getState().updateModuleProgress(course.id, module.id, 'done');
        }
      });
      
      // Should be in completed state
      await fullCleanup();
      await initializeStores();
      
      const completed = useLearnStore.getState().getCompletedCourses();
      expect(completed).toHaveLength(1);
      expect(completed[0].status).toBe('completed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty state gracefully', async () => {
      await fullCleanup();
      await initializeStores();
      
      const suggested = useLearnStore.getState().getSuggestedOutlines();
      const started = useLearnStore.getState().getStartedCourses();
      const completed = useLearnStore.getState().getCompletedCourses();
      
      expect(suggested).toEqual([]);
      expect(started).toEqual([]);
      expect(completed).toEqual([]);
    });

    it('should handle corrupted data gracefully', async () => {
      // Create valid course
      const { course } = await createTestCourse();
      
      // Corrupt the data by removing required field
      await db.courses.update(course.id, { moduleIds: null });
      
      await fullCleanup();
      await initializeStores();
      
      // Should not crash, might skip corrupted course
      const courses = Object.values(useLearnStore.getState().courses);
      expect(courses).toBeDefined();
    });

    it('should handle large dataset persistence', async () => {
      // Create 50 courses
      const createPromises = [];
      for (let i = 0; i < 50; i++) {
        createPromises.push(
          createTestCourse({ 
            title: `Course ${i}`,
            status: i % 3 === 0 ? 'completed' : 'started'
          })
        );
      }
      
      await Promise.all(createPromises);
      
      await fullCleanup();
      await initializeStores();
      
      const allCourses = Object.values(useLearnStore.getState().courses);
      expect(allCourses).toHaveLength(50);
    });
  });
});

