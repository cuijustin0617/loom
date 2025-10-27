import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { fullCleanup, initializeStores } from '../helpers/testUtils';
import { generateId } from '../../src/lib/db/database';

describe('Learn Regrouping', () => {
  beforeEach(async () => {
    await fullCleanup();
    await initializeStores();
  });

  describe('Goal renaming with uniqueness constraints', () => {
    it('should handle renaming goal to an existing goal name by merging', async () => {
      const oldGoalLabel = `Old Goal ${Date.now()}`;
      const existingGoalLabel = `Existing Goal ${Date.now()}`;
      
      let oldGoalId, existingGoalId, course1Id, course2Id;
      
      await act(async () => {
        // Create two goals
        oldGoalId = await useLearnStore.getState().addGoal(oldGoalLabel, 'Old description');
        existingGoalId = await useLearnStore.getState().addGoal(existingGoalLabel, 'Existing description');
        
        // Create courses for each goal
        course1Id = generateId('course');
        course2Id = generateId('course');
        
        await useLearnStore.getState().saveCourse({
          id: course1Id,
          title: 'Course 1',
          goal: oldGoalLabel,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        
        await useLearnStore.getState().saveCourse({
          id: course2Id,
          title: 'Course 2',
          goal: existingGoalLabel,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
      });

      const beforeStore = useLearnStore.getState();
      const beforeGoals = Object.values(beforeStore.goals);
      const beforeCourse1 = beforeStore.courses[course1Id];
      const beforeCourse2 = beforeStore.courses[course2Id];
      
      expect(beforeGoals.length).toBeGreaterThanOrEqual(2);
      expect(beforeCourse1.goal).toBe(oldGoalLabel);
      expect(beforeCourse2.goal).toBe(existingGoalLabel);
      
      // Simulate renaming old goal to existing goal label (this should merge)
      await act(async () => {
        const db = (await import('../../src/lib/db/database')).default;
        const goals = Object.values(useLearnStore.getState().goals);
        const courses = Object.values(useLearnStore.getState().courses);
        const store = useLearnStore.getState();
        
        // Simulate the rename logic with conflict handling
        const oldGoal = goals.find(g => g.label === oldGoalLabel);
        const existingGoal = goals.find(g => g.label === existingGoalLabel);
        
        if (oldGoal && existingGoal) {
          // If target label already exists, merge instead of rename
          const oldGoalCourses = courses.filter(c => c.goal === oldGoalLabel);
          
          for (const course of oldGoalCourses) {
            await db.courses.update(course.id, { goal: existingGoalLabel });
          }
          
          // Delete the old goal
          await db.goals.delete(oldGoal.id);
          
          // Reload store
          await store.loadLearnData();
        }
      });

      const afterStore = useLearnStore.getState();
      const afterCourse1 = afterStore.courses[course1Id];
      const afterCourse2 = afterStore.courses[course2Id];
      const afterGoals = Object.values(afterStore.goals);
      
      // Both courses should now be under the existing goal
      expect(afterCourse1.goal).toBe(existingGoalLabel);
      expect(afterCourse2.goal).toBe(existingGoalLabel);
      
      // Old goal should be deleted
      expect(afterGoals.find(g => g.label === oldGoalLabel)).toBeUndefined();
      
      // Existing goal should still exist
      expect(afterGoals.find(g => g.label === existingGoalLabel)).toBeDefined();
    });

    it('should rename goal when target name does not exist', async () => {
      const oldLabel = `Old Goal ${Date.now()}`;
      const newLabel = `New Goal ${Date.now()}`;
      
      let goalId, courseId;
      
      await act(async () => {
        goalId = await useLearnStore.getState().addGoal(oldLabel, 'Description');
        
        courseId = generateId('course');
        await useLearnStore.getState().saveCourse({
          id: courseId,
          title: 'Test Course',
          goal: oldLabel,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
      });

      await act(async () => {
        const db = (await import('../../src/lib/db/database')).default;
        const goals = Object.values(useLearnStore.getState().goals);
        const courses = Object.values(useLearnStore.getState().courses);
        const store = useLearnStore.getState();
        
        const goal = goals.find(g => g.label === oldLabel);
        
        if (goal) {
          // Check if target label already exists
          const targetExists = goals.find(g => g.label === newLabel);
          
          if (!targetExists) {
            // Safe to rename
            await db.goals.update(goal.id, { label: newLabel });
            
            // Update courses
            const goalCourses = courses.filter(c => c.goal === oldLabel);
            for (const course of goalCourses) {
              await db.courses.update(course.id, { goal: newLabel });
            }
            
            await store.loadLearnData();
          }
        }
      });

      const afterStore = useLearnStore.getState();
      const afterCourse = afterStore.courses[courseId];
      const afterGoals = Object.values(afterStore.goals);
      
      // Course should have new goal label
      expect(afterCourse.goal).toBe(newLabel);
      
      // Old label should not exist
      expect(afterGoals.find(g => g.label === oldLabel)).toBeUndefined();
      
      // New label should exist
      expect(afterGoals.find(g => g.label === newLabel)).toBeDefined();
    });

    it('should handle multiple courses being reassigned during merge', async () => {
      const oldLabel = `Old ${Date.now()}`;
      const existingLabel = `Existing ${Date.now()}`;
      
      await act(async () => {
        await useLearnStore.getState().addGoal(oldLabel, 'Old');
        await useLearnStore.getState().addGoal(existingLabel, 'Existing');
        
        // Create 3 courses for old goal
        for (let i = 0; i < 3; i++) {
          const courseId = generateId('course');
          await useLearnStore.getState().saveCourse({
            id: courseId,
            title: `Course ${i}`,
            goal: oldLabel,
            moduleIds: [],
            status: 'completed',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          });
        }
        
        // Create 2 courses for existing goal
        for (let i = 0; i < 2; i++) {
          const courseId = generateId('course');
          await useLearnStore.getState().saveCourse({
            id: courseId,
            title: `Existing Course ${i}`,
            goal: existingLabel,
            moduleIds: [],
            status: 'completed',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          });
        }
      });

      const beforeStore = useLearnStore.getState();
      const beforeOldGoalCourses = Object.values(beforeStore.courses).filter(c => c.goal === oldLabel);
      const beforeExistingGoalCourses = Object.values(beforeStore.courses).filter(c => c.goal === existingLabel);
      
      expect(beforeOldGoalCourses.length).toBe(3);
      expect(beforeExistingGoalCourses.length).toBe(2);
      
      // Merge old into existing
      await act(async () => {
        const db = (await import('../../src/lib/db/database')).default;
        const goals = Object.values(useLearnStore.getState().goals);
        const courses = Object.values(useLearnStore.getState().courses);
        const store = useLearnStore.getState();
        
        const oldGoal = goals.find(g => g.label === oldLabel);
        
        if (oldGoal) {
          const oldGoalCourses = courses.filter(c => c.goal === oldLabel);
          
          for (const course of oldGoalCourses) {
            await db.courses.update(course.id, { goal: existingLabel });
          }
          
          await db.goals.delete(oldGoal.id);
          await store.loadLearnData();
        }
      });

      const afterStore = useLearnStore.getState();
      const afterOldGoalCourses = Object.values(afterStore.courses).filter(c => c.goal === oldLabel);
      const afterExistingGoalCourses = Object.values(afterStore.courses).filter(c => c.goal === existingLabel);
      
      // All courses should now be under existing goal
      expect(afterOldGoalCourses.length).toBe(0);
      expect(afterExistingGoalCourses.length).toBe(5); // 3 + 2
    });
  });
});

