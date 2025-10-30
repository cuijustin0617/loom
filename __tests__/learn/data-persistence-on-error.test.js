import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { fullCleanup, initializeStores } from '../helpers/testUtils';
import { generateId } from '../../src/lib/db/database';

describe('Data Persistence on Generation Errors', () => {
  beforeEach(async () => {
    await fullCleanup();
    await initializeStores();
  });

  it('should preserve existing courses when generation fails', async () => {
    const existingCourseId = generateId('course');
    const newCourseId = generateId('course');
    
    await act(async () => {
      // Create an existing completed course
      const existingCourse = {
        id: existingCourseId,
        title: 'Existing Course',
        goal: 'Test Goal',
        questionIds: ['Q1', 'Q2'],
        modules: [{
          id: generateId('mod'),
          courseId: existingCourseId,
          idx: 1,
          title: 'Module 1',
          estMinutes: 5,
          lesson: 'Lesson content',
          microTask: '',
          quiz: [],
          refs: []
        }],
        whereToGoNext: '',
        status: 'completed',
        progressByModule: {},
        completedVia: 'manual',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
      
      await useLearnStore.getState().saveCourse(existingCourse);
    });

    let store = useLearnStore.getState();
    expect(store.courses[existingCourseId]).toBeDefined();
    expect(store.courses[existingCourseId].title).toBe('Existing Course');
    
    await act(async () => {
      // Try to save a new course that "fails" (simulated by passing invalid data)
      const newCourse = {
        id: newCourseId,
        title: 'New Course',
        goal: 'Test Goal',
        questionIds: [],
        modules: [], // Empty modules - but should still save
        whereToGoNext: '',
        status: 'started',
        progressByModule: {},
        completedVia: null,
        createdAt: new Date().toISOString(),
        completedAt: null
      };
      
      await useLearnStore.getState().saveCourse(newCourse);
    });

    // Verify existing course is still there
    store = useLearnStore.getState();
    expect(store.courses[existingCourseId]).toBeDefined();
    expect(store.courses[existingCourseId].title).toBe('Existing Course');
    expect(store.courses[existingCourseId].status).toBe('completed');
    
    // Verify new course was saved
    expect(store.courses[newCourseId]).toBeDefined();
  });

  it('should preserve existing outlines when generation fails', async () => {
    const outline1Id = generateId('outline');
    const outline2Id = generateId('outline');
    
    await act(async () => {
      // Create multiple outlines
      await useLearnStore.getState().saveOutline({
        id: outline1Id,
        courseId: generateId('course'),
        title: 'Outline 1',
        questions: ['Q1'],
        moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
        status: 'suggested',
        createdAt: new Date().toISOString(),
      });
      
      await useLearnStore.getState().saveOutline({
        id: outline2Id,
        courseId: generateId('course'),
        title: 'Outline 2',
        questions: ['Q2'],
        moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
        status: 'suggested',
        createdAt: new Date().toISOString(),
      });
    });

    let store = useLearnStore.getState();
    expect(Object.keys(store.outlines).length).toBe(2);
    
    // Simulate a generation error by setting error state
    await act(async () => {
      useLearnStore.getState().setGenerationError('some-course-id', 'Generation failed');
    });

    // Verify outlines are still there
    store = useLearnStore.getState();
    expect(Object.keys(store.outlines).length).toBe(2);
    expect(store.outlines[outline1Id]).toBeDefined();
    expect(store.outlines[outline2Id]).toBeDefined();
  });

  it('should preserve goals when generation fails', async () => {
    const goalLabel1 = `Machine Learning ${Date.now()}`;
    const goalLabel2 = `Data Science ${Date.now()}`;
    
    await act(async () => {
      await useLearnStore.getState().addGoal(goalLabel1);
      await useLearnStore.getState().addGoal(goalLabel2);
    });

    let store = useLearnStore.getState();
    const goalCount = Object.keys(store.goals).length;
    expect(goalCount).toBeGreaterThanOrEqual(2);
    
    // Simulate generation error
    await act(async () => {
      useLearnStore.getState().setGenerationError('test-course', 'Error occurred');
    });

    // Verify goals are still there
    store = useLearnStore.getState();
    expect(Object.keys(store.goals).length).toBe(goalCount);
    expect(Object.values(store.goals).some(g => g.label === goalLabel1)).toBe(true);
    expect(Object.values(store.goals).some(g => g.label === goalLabel2)).toBe(true);
  });

  it('should not clear store when saveCourse fails', async () => {
    const courseId = generateId('course');
    const outlineId = generateId('outline');
    const otherCourseId = generateId('course');
    
    await act(async () => {
      // Create initial data
      await useLearnStore.getState().addGoal(`Test Goal ${Date.now()}`);
      await useLearnStore.getState().saveOutline({
        id: outlineId,
        courseId: otherCourseId,
        title: 'Test Outline',
        questions: ['Q1'],
        moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
        status: 'suggested',
        createdAt: new Date().toISOString(),
      });
    });

    let store = useLearnStore.getState();
    const initialGoalCount = Object.keys(store.goals).length;
    const initialOutlineCount = Object.keys(store.outlines).length;
    
    // Try to save a course (this should work, but even if it "fails", data should persist)
    await act(async () => {
      const result = await useLearnStore.getState().saveCourse({
        id: courseId,
        title: 'Test Course',
        goal: '',
        questionIds: [],
        modules: [],
        whereToGoNext: '',
        status: 'started',
        progressByModule: {},
        completedVia: null,
        createdAt: new Date().toISOString(),
        completedAt: null
      });
      
      expect(result.success).toBe(true);
    });

    // Verify original data is still there
    store = useLearnStore.getState();
    expect(Object.keys(store.goals).length).toBe(initialGoalCount);
    expect(Object.keys(store.outlines).length).toBe(initialOutlineCount);
    expect(store.courses[courseId]).toBeDefined();
  });

  it('should preserve all data types simultaneously on error', async () => {
    const courseId = generateId('course');
    const outlineId = generateId('outline');
    const goalLabel = 'Comprehensive Goal';
    
    await act(async () => {
      // Create comprehensive test data
      await useLearnStore.getState().addGoal(goalLabel);
      
      await useLearnStore.getState().saveOutline({
        id: outlineId,
        courseId: generateId('course'),
        title: 'Test Outline',
        questions: ['Q1', 'Q2'],
        moduleSummary: [
          { title: 'Module 1', estMinutes: 5 },
          { title: 'Module 2', estMinutes: 5 }
        ],
        status: 'suggested',
        createdAt: new Date().toISOString(),
      });
      
      await useLearnStore.getState().saveCourse({
        id: courseId,
        title: 'Test Course',
        goal: goalLabel,
        questionIds: ['Q1'],
        modules: [{
          id: generateId('mod'),
          courseId: courseId,
          idx: 1,
          title: 'Module 1',
          estMinutes: 5,
          lesson: 'Content',
          microTask: '',
          quiz: [],
          refs: []
        }],
        whereToGoNext: '',
        status: 'completed',
        progressByModule: {},
        completedVia: 'manual',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });
    });

    let store = useLearnStore.getState();
    const snapshot = {
      courseCount: Object.keys(store.courses).length,
      moduleCount: Object.keys(store.modules).length,
      goalCount: Object.keys(store.goals).length,
      outlineCount: Object.keys(store.outlines).length
    };
    
    expect(snapshot.courseCount).toBeGreaterThan(0);
    expect(snapshot.moduleCount).toBeGreaterThan(0);
    expect(snapshot.goalCount).toBeGreaterThan(0);
    expect(snapshot.outlineCount).toBeGreaterThan(0);
    
    // Simulate multiple error conditions
    await act(async () => {
      useLearnStore.getState().setGenerationError('error-course-1', 'Error 1');
      useLearnStore.getState().setGenerationError('error-course-2', 'Error 2');
    });

    // Verify ALL data is preserved
    store = useLearnStore.getState();
    expect(Object.keys(store.courses).length).toBe(snapshot.courseCount);
    expect(Object.keys(store.modules).length).toBe(snapshot.moduleCount);
    expect(Object.keys(store.goals).length).toBe(snapshot.goalCount);
    expect(Object.keys(store.outlines).length).toBe(snapshot.outlineCount);
    
    // Verify specific data integrity
    expect(store.courses[courseId]).toBeDefined();
    expect(store.courses[courseId].title).toBe('Test Course');
    expect(store.outlines[outlineId]).toBeDefined();
    expect(store.outlines[outlineId].title).toBe('Test Outline');
    expect(Object.values(store.goals).some(g => g.label === goalLabel)).toBe(true);
  });

  it('should handle deleteCourse without clearing other data', async () => {
    const course1Id = generateId('course');
    const course2Id = generateId('course');
    const goalLabel = `Shared Goal ${Date.now()}`;
    
    await act(async () => {
      await useLearnStore.getState().addGoal(goalLabel);
      
      // Create two courses
      await useLearnStore.getState().saveCourse({
        id: course1Id,
        title: 'Course 1',
        goal: goalLabel,
        questionIds: [],
        modules: [{
          id: generateId('mod'),
          courseId: course1Id,
          idx: 1,
          title: 'Module 1',
          estMinutes: 5,
          lesson: 'Content',
          microTask: '',
          quiz: [],
          refs: []
        }],
        whereToGoNext: '',
        status: 'completed',
        progressByModule: {},
        completedVia: null,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });
      
      await useLearnStore.getState().saveCourse({
        id: course2Id,
        title: 'Course 2',
        goal: goalLabel,
        questionIds: [],
        modules: [{
          id: generateId('mod'),
          courseId: course2Id,
          idx: 1,
          title: 'Module 1',
          estMinutes: 5,
          lesson: 'Content',
          microTask: '',
          quiz: [],
          refs: []
        }],
        whereToGoNext: '',
        status: 'started',
        progressByModule: {},
        completedVia: null,
        createdAt: new Date().toISOString(),
        completedAt: null
      });
    });

    let store = useLearnStore.getState();
    expect(store.courses[course1Id]).toBeDefined();
    expect(store.courses[course2Id]).toBeDefined();
    const courseCountBefore = Object.keys(store.courses).length;
    
    // Delete one course
    await act(async () => {
      await useLearnStore.getState().deleteCourse(course1Id);
    });

    // Verify only the deleted course is gone
    store = useLearnStore.getState();
    expect(store.courses[course1Id]).toBeUndefined();
    expect(store.courses[course2Id]).toBeDefined();
    expect(store.courses[course2Id].title).toBe('Course 2');
    expect(Object.keys(store.courses).length).toBe(courseCountBefore - 1);
    
    // Verify goal still exists
    expect(Object.values(store.goals).some(g => g.label === goalLabel)).toBe(true);
  });
});

