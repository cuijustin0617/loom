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

  describe('Goal removal and redistribution', () => {
    it('should remove a goal and make its courses pending', async () => {
      const goalLabel = `Goal to Remove ${Date.now()}`;
      let goalId, course1Id, course2Id;
      
      await act(async () => {
        goalId = await useLearnStore.getState().addGoal(goalLabel, 'Description');
        
        course1Id = generateId('course');
        course2Id = generateId('course');
        
        await useLearnStore.getState().saveCourse({
          id: course1Id,
          title: 'Course 1',
          goal: goalLabel,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        
        await useLearnStore.getState().saveCourse({
          id: course2Id,
          title: 'Course 2',
          goal: goalLabel,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
      });

      const beforeStore = useLearnStore.getState();
      expect(beforeStore.courses[course1Id].goal).toBe(goalLabel);
      expect(beforeStore.courses[course2Id].goal).toBe(goalLabel);
      expect(Object.values(beforeStore.goals).find(g => g.label === goalLabel)).toBeDefined();
      
      // Remove the goal
      await act(async () => {
        const db = (await import('../../src/lib/db/database')).default;
        const store = useLearnStore.getState();
        const goals = Object.values(store.goals);
        const courses = Object.values(store.courses);
        
        const goal = goals.find(g => g.label === goalLabel);
        
        if (goal) {
          // Make all courses pending
          const goalCourses = courses.filter(c => c.goal === goalLabel);
          for (const course of goalCourses) {
            await db.courses.update(course.id, { goal: '' });
          }
          
          // Delete the goal
          await db.goals.delete(goal.id);
          
          await store.loadLearnData();
        }
      });

      const afterStore = useLearnStore.getState();
      
      // Courses should now be pending (empty goal)
      expect(afterStore.courses[course1Id].goal).toBe('');
      expect(afterStore.courses[course2Id].goal).toBe('');
      
      // Goal should be deleted
      expect(Object.values(afterStore.goals).find(g => g.label === goalLabel)).toBeUndefined();
    });

    it('should redistribute courses from removed goal to existing goal', async () => {
      const removeLabel = `Remove ${Date.now()}`;
      const targetLabel = `Target ${Date.now()}`;
      let course1Id, course2Id, course3Id;
      
      await act(async () => {
        await useLearnStore.getState().addGoal(removeLabel, 'To remove');
        await useLearnStore.getState().addGoal(targetLabel, 'Keep this');
        
        course1Id = generateId('course');
        course2Id = generateId('course');
        course3Id = generateId('course');
        
        // Two courses in goal to be removed
        await useLearnStore.getState().saveCourse({
          id: course1Id,
          title: 'Course 1',
          goal: removeLabel,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        
        await useLearnStore.getState().saveCourse({
          id: course2Id,
          title: 'Course 2',
          goal: removeLabel,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        
        // One course in target goal
        await useLearnStore.getState().saveCourse({
          id: course3Id,
          title: 'Course 3',
          goal: targetLabel,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
      });

      // Simulate remove_groups operation
      await act(async () => {
        const db = (await import('../../src/lib/db/database')).default;
        const store = useLearnStore.getState();
        const goals = Object.values(store.goals);
        const courses = Object.values(store.courses);
        
        // Step 1: Remove goal and make courses pending
        const goalToRemove = goals.find(g => g.label === removeLabel);
        if (goalToRemove) {
          const goalCourses = courses.filter(c => c.goal === removeLabel);
          for (const course of goalCourses) {
            await db.courses.update(course.id, { goal: '' });
          }
          await db.goals.delete(goalToRemove.id);
          await store.loadLearnData();
        }
      });

      // Step 2: Redistribute to target goal
      await act(async () => {
        const db = (await import('../../src/lib/db/database')).default;
        const store = useLearnStore.getState();
        
        await db.courses.update(course1Id, { goal: targetLabel });
        await db.courses.update(course2Id, { goal: targetLabel });
        
        await store.loadLearnData();
      });

      const afterStore = useLearnStore.getState();
      const targetGoalCourses = Object.values(afterStore.courses).filter(c => c.goal === targetLabel);
      
      // All three courses should now be in target goal
      expect(afterStore.courses[course1Id].goal).toBe(targetLabel);
      expect(afterStore.courses[course2Id].goal).toBe(targetLabel);
      expect(afterStore.courses[course3Id].goal).toBe(targetLabel);
      expect(targetGoalCourses.length).toBe(3);
      
      // Removed goal should not exist
      expect(Object.values(afterStore.goals).find(g => g.label === removeLabel)).toBeUndefined();
    });

    it('should handle removing multiple goals at once', async () => {
      const label1 = `Remove1 ${Date.now()}`;
      const label2 = `Remove2 ${Date.now()}`;
      let course1Id, course2Id, course3Id;
      
      await act(async () => {
        await useLearnStore.getState().addGoal(label1, 'First');
        await useLearnStore.getState().addGoal(label2, 'Second');
        
        course1Id = generateId('course');
        course2Id = generateId('course');
        course3Id = generateId('course');
        
        await useLearnStore.getState().saveCourse({
          id: course1Id,
          title: 'Course 1',
          goal: label1,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        
        await useLearnStore.getState().saveCourse({
          id: course2Id,
          title: 'Course 2',
          goal: label2,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        
        await useLearnStore.getState().saveCourse({
          id: course3Id,
          title: 'Course 3',
          goal: label2,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
      });

      // Remove both goals
      await act(async () => {
        const db = (await import('../../src/lib/db/database')).default;
        const store = useLearnStore.getState();
        
        // Simulate remove_groups for both labels
        const labelsToRemove = [label1, label2];
        
        for (const labelToRemove of labelsToRemove) {
          // Refresh state on each iteration
          const currentStore = useLearnStore.getState();
          const goals = Object.values(currentStore.goals);
          const courses = Object.values(currentStore.courses);
          const goal = goals.find(g => g.label === labelToRemove);
          
          if (goal) {
            const goalCourses = courses.filter(c => c.goal === labelToRemove);
            for (const course of goalCourses) {
              await db.courses.update(course.id, { goal: '' });
            }
            await db.goals.delete(goal.id);
          }
        }
        
        await store.loadLearnData();
      });

      const afterStore = useLearnStore.getState();
      
      // All courses should be pending
      expect(afterStore.courses[course1Id].goal).toBe('');
      expect(afterStore.courses[course2Id].goal).toBe('');
      expect(afterStore.courses[course3Id].goal).toBe('');
      
      // Both goals should be deleted
      expect(Object.values(afterStore.goals).find(g => g.label === label1)).toBeUndefined();
      expect(Object.values(afterStore.goals).find(g => g.label === label2)).toBeUndefined();
    });

    it('should handle complex scenario: remove, rename, add to existing, and create new groups', async () => {
      const removeLabel = `Remove ${Date.now()}`;
      const renameFromLabel = `OldName ${Date.now()}`;
      const renameToLabel = `NewName ${Date.now()}`;
      const existingLabel = `Existing ${Date.now()}`;
      const newGroupLabel = `NewGroup ${Date.now()}`;
      
      let removeCourse1, removeCourse2, renameCourse, existingCourse, pendingCourse1, pendingCourse2;
      
      await act(async () => {
        // Create goals
        await useLearnStore.getState().addGoal(removeLabel, 'To remove');
        await useLearnStore.getState().addGoal(renameFromLabel, 'To rename');
        await useLearnStore.getState().addGoal(existingLabel, 'Keep this');
        
        // Create courses for goal to remove
        removeCourse1 = generateId('course');
        removeCourse2 = generateId('course');
        await useLearnStore.getState().saveCourse({
          id: removeCourse1,
          title: 'Remove Course 1',
          goal: removeLabel,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        await useLearnStore.getState().saveCourse({
          id: removeCourse2,
          title: 'Remove Course 2',
          goal: removeLabel,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        
        // Course for goal to rename
        renameCourse = generateId('course');
        await useLearnStore.getState().saveCourse({
          id: renameCourse,
          title: 'Rename Course',
          goal: renameFromLabel,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        
        // Course for existing goal
        existingCourse = generateId('course');
        await useLearnStore.getState().saveCourse({
          id: existingCourse,
          title: 'Existing Course',
          goal: existingLabel,
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        
        // Pending courses (no goal)
        pendingCourse1 = generateId('course');
        pendingCourse2 = generateId('course');
        await useLearnStore.getState().saveCourse({
          id: pendingCourse1,
          title: 'Pending Course 1',
          goal: '',
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        await useLearnStore.getState().saveCourse({
          id: pendingCourse2,
          title: 'Pending Course 2',
          goal: '',
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
      });

      // Execute complex regrouping operation
      await act(async () => {
        const db = (await import('../../src/lib/db/database')).default;
        const store = useLearnStore.getState();
        
        // Step 1: Remove goal (makes courses pending)
        let currentStore = useLearnStore.getState();
        const goals = Object.values(currentStore.goals);
        const courses = Object.values(currentStore.courses);
        const goalToRemove = goals.find(g => g.label === removeLabel);
        
        if (goalToRemove) {
          const goalCourses = courses.filter(c => c.goal === removeLabel);
          for (const course of goalCourses) {
            await db.courses.update(course.id, { goal: '' });
          }
          await db.goals.delete(goalToRemove.id);
          await store.loadLearnData();
        }
        
        // Step 2: Rename goal
        currentStore = useLearnStore.getState();
        const updatedGoals = Object.values(currentStore.goals);
        const goalToRename = updatedGoals.find(g => g.label === renameFromLabel);
        
        if (goalToRename) {
          await db.goals.update(goalToRename.id, { label: renameToLabel });
          const updatedCourses = Object.values(currentStore.courses);
          const goalCourses = updatedCourses.filter(c => c.goal === renameFromLabel);
          for (const course of goalCourses) {
            await db.courses.update(course.id, { goal: renameToLabel });
          }
          await store.loadLearnData();
        }
        
        // Step 3: Add one of the removed courses to existing goal
        await db.courses.update(removeCourse1, { goal: existingLabel });
        await store.loadLearnData();
        
        // Step 4: Create new group with the other removed course + pending courses
        await db.courses.update(removeCourse2, { goal: newGroupLabel });
        await store.updateCourseGoal(removeCourse2, newGroupLabel);
        
        await db.courses.update(pendingCourse1, { goal: newGroupLabel });
        await store.updateCourseGoal(pendingCourse1, newGroupLabel);
        
        await db.courses.update(pendingCourse2, { goal: newGroupLabel });
        await store.updateCourseGoal(pendingCourse2, newGroupLabel);
        
        await store.loadLearnData();
      });

      const finalStore = useLearnStore.getState();
      
      // Verify all courses are accounted for and correctly assigned
      expect(finalStore.courses[removeCourse1].goal).toBe(existingLabel);
      expect(finalStore.courses[removeCourse2].goal).toBe(newGroupLabel);
      expect(finalStore.courses[renameCourse].goal).toBe(renameToLabel);
      expect(finalStore.courses[existingCourse].goal).toBe(existingLabel);
      expect(finalStore.courses[pendingCourse1].goal).toBe(newGroupLabel);
      expect(finalStore.courses[pendingCourse2].goal).toBe(newGroupLabel);
      
      // Verify goals
      const finalGoals = Object.values(finalStore.goals);
      expect(finalGoals.find(g => g.label === removeLabel)).toBeUndefined(); // Removed
      expect(finalGoals.find(g => g.label === renameFromLabel)).toBeUndefined(); // Renamed
      expect(finalGoals.find(g => g.label === renameToLabel)).toBeDefined(); // New name
      expect(finalGoals.find(g => g.label === existingLabel)).toBeDefined(); // Still exists
      expect(finalGoals.find(g => g.label === newGroupLabel)).toBeDefined(); // Created
      
      // Verify no courses were lost
      const allCourses = Object.values(finalStore.courses);
      const courseIds = [removeCourse1, removeCourse2, renameCourse, existingCourse, pendingCourse1, pendingCourse2];
      for (const id of courseIds) {
        expect(allCourses.find(c => c.id === id)).toBeDefined();
      }
      
      // Verify new group has correct number of members
      const newGroupCourses = allCourses.filter(c => c.goal === newGroupLabel);
      expect(newGroupCourses.length).toBe(3);
    });

    it('should ensure no courses are lost during complex redistribution', async () => {
      const label1 = `Group1 ${Date.now()}`;
      const label2 = `Group2 ${Date.now()}`;
      const label3 = `Group3 ${Date.now()}`;
      const courseIds = [];
      
      await act(async () => {
        await useLearnStore.getState().addGoal(label1, 'Group 1');
        await useLearnStore.getState().addGoal(label2, 'Group 2');
        await useLearnStore.getState().addGoal(label3, 'Group 3');
        
        // Create 3 courses in each group
        for (let i = 0; i < 3; i++) {
          const id = generateId('course');
          courseIds.push(id);
          await useLearnStore.getState().saveCourse({
            id,
            title: `Course Group1 ${i}`,
            goal: label1,
            moduleIds: [],
            status: 'completed',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          });
        }
        
        for (let i = 0; i < 3; i++) {
          const id = generateId('course');
          courseIds.push(id);
          await useLearnStore.getState().saveCourse({
            id,
            title: `Course Group2 ${i}`,
            goal: label2,
            moduleIds: [],
            status: 'completed',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          });
        }
        
        for (let i = 0; i < 3; i++) {
          const id = generateId('course');
          courseIds.push(id);
          await useLearnStore.getState().saveCourse({
            id,
            title: `Course Group3 ${i}`,
            goal: label3,
            moduleIds: [],
            status: 'completed',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          });
        }
      });

      const beforeStore = useLearnStore.getState();
      // Only count courses created in this test (the 9 courses we just created)
      const beforeCourseCount = courseIds.length;
      
      // Remove label1 and label2, redistribute all to label3
      await act(async () => {
        const db = (await import('../../src/lib/db/database')).default;
        const store = useLearnStore.getState();
        
        // Remove groups 1 and 2
        for (const labelToRemove of [label1, label2]) {
          // Refresh state on each iteration
          const currentStore = useLearnStore.getState();
          const goals = Object.values(currentStore.goals);
          const courses = Object.values(currentStore.courses);
          const goal = goals.find(g => g.label === labelToRemove);
          
          if (goal) {
            const goalCourses = courses.filter(c => c.goal === labelToRemove);
            for (const course of goalCourses) {
              await db.courses.update(course.id, { goal: '' });
            }
            await db.goals.delete(goal.id);
          }
        }
        
        await store.loadLearnData();
        
        // Redistribute all pending to label3
        const updatedStore = useLearnStore.getState();
        const updatedCourses = Object.values(updatedStore.courses);
        const pendingCourses = updatedCourses.filter(c => c.goal === '');
        for (const course of pendingCourses) {
          await db.courses.update(course.id, { goal: label3 });
        }
        
        await store.loadLearnData();
      });

      const afterStore = useLearnStore.getState();
      
      // Verify all original course IDs still exist and are accounted for
      for (const id of courseIds) {
        expect(afterStore.courses[id]).toBeDefined();
        expect(afterStore.courses[id].goal).toBe(label3);
      }
      
      // All courses from our test should be in label3
      const testCoursesInLabel3 = courseIds.filter(id => afterStore.courses[id]?.goal === label3);
      expect(testCoursesInLabel3.length).toBe(courseIds.length);
      expect(testCoursesInLabel3.length).toBe(9);
      
      // Only label3 should exist
      const finalGoals = Object.values(afterStore.goals);
      expect(finalGoals.find(g => g.label === label1)).toBeUndefined();
      expect(finalGoals.find(g => g.label === label2)).toBeUndefined();
      expect(finalGoals.find(g => g.label === label3)).toBeDefined();
    });
  });
});

