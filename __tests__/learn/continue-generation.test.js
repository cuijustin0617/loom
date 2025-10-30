/**
 * Test: Continue Button Course Generation
 * 
 * Tests that clicking Continue on a saved lesson properly triggers generation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { fullReset, initializeStores } from '../helpers/testUtils';
import { generateId, now } from '../../src/lib/db/database';
import { act } from '@testing-library/react';

describe('Continue Button - Course Generation', () => {
  beforeEach(async () => {
    await fullReset();
    await initializeStores();
  });

  it('should return needsGeneration=true for shell course (saved lesson)', async () => {
    await act(async () => {
    const store = useLearnStore.getState();
    
    // Create an outline (simulating a suggested lesson)
    const outlineId = generateId('outline');
    const courseId = generateId('course');
    
    const outline = {
      id: outlineId,
      courseId: courseId,
      title: 'Test Course',
      questions: ['Q1', 'Q2'],
      moduleSummary: [
        { title: 'Module 1', estMinutes: 5 },
        { title: 'Module 2', estMinutes: 5 }
      ],
      status: 'suggested',
      createdAt: now()
    };
    
    await store.addOutline(outline);
    
    // Create a shell course (simulating "Save" action)
    const shellCourse = {
      id: courseId,
      title: 'Test Course',
      goal: '',
      questionIds: ['Q1', 'Q2'],
      moduleIds: [], // Empty - needs generation
      whereToGoNext: '',
      status: 'started',
      progressByModule: {},
      completedVia: null,
      createdAt: now(),
      completedAt: null
    };
    
    await store.saveCourse(shellCourse);
    
    // Update outline status to 'started' (simulating save action)
    await store.updateOutlineStatus(outlineId, 'started');
    
    // Now simulate clicking "Continue" - call startCourse
    const result = await store.startCourse(outlineId);
    
    // Should return success with needsGeneration flag
    expect(result.success).toBe(true);
    expect(result.courseId).toBe(courseId);
    expect(result.needsGeneration).toBe(true);
    });
  });

  it('should not return needsGeneration for course with modules', async () => {
    await act(async () => {
    const store = useLearnStore.getState();
    
    // Create an outline
    const outlineId = generateId('outline');
    const courseId = generateId('course');
    
    const outline = {
      id: outlineId,
      courseId: courseId,
      title: 'Test Course',
      questions: ['Q1', 'Q2'],
      moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
      status: 'started',
      createdAt: now()
    };
    
    await store.addOutline(outline);
    
    // Create a full course with modules
    const fullCourse = {
      id: courseId,
      title: 'Test Course',
      goal: '',
      questionIds: ['Q1', 'Q2'],
      modules: [
        {
          id: generateId('mod'),
          courseId: courseId,
          idx: 1,
          title: 'Module 1',
          estMinutes: 5,
          lesson: 'Lesson content',
          microTask: '',
          quiz: [],
          refs: []
        }
      ],
      whereToGoNext: '',
      status: 'started',
      progressByModule: {},
      completedVia: null,
      createdAt: now()
    };
    
    await store.saveCourse(fullCourse);
    
    // Call startCourse
    const result = await store.startCourse(outlineId);
    
    // Should return success but NO needsGeneration flag
    expect(result.success).toBe(true);
    expect(result.courseId).toBe(courseId);
    expect(result.needsGeneration).toBe(false);
    });
  });

  it('should handle multiple saves without duplication', async () => {
    await act(async () => {
    const store = useLearnStore.getState();
    
    const outlineId = generateId('outline');
    const courseId = generateId('course');
    
    const outline = {
      id: outlineId,
      courseId: courseId,
      title: 'Test Course',
      questions: ['Q1'],
      moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
      status: 'suggested',
      createdAt: now()
    };
    
    await store.addOutline(outline);
    
    // First save (shell course)
    const shellCourse = {
      id: courseId,
      title: 'Test Course',
      goal: '',
      questionIds: ['Q1'],
      moduleIds: [],
      whereToGoNext: '',
      status: 'started',
      progressByModule: {},
      completedVia: null,
      createdAt: now(),
      completedAt: null
    };
    
    await store.saveCourse(shellCourse);
    await store.updateOutlineStatus(outlineId, 'started');
    
    // Click Continue multiple times
    const result1 = await store.startCourse(outlineId);
    const result2 = await store.startCourse(outlineId);
    
    // Both should succeed and return needsGeneration
    expect(result1.success).toBe(true);
    expect(result1.needsGeneration).toBe(true);
    expect(result2.success).toBe(true);
    expect(result2.needsGeneration).toBe(true);
    
    // Should not create duplicate courses
    // Refresh store reference to get latest state
    const latestStore = useLearnStore.getState();
    const courses = Object.values(latestStore.courses);
    const matchingCourses = courses.filter(c => c.id === courseId);
    expect(matchingCourses.length).toBe(1);
    
    // Verify the course exists
    expect(latestStore.courses[courseId]).toBeDefined();
    expect(latestStore.courses[courseId].title).toBe('Test Course');
    });
  });
});

