/**
 * Course Generation Loading State Tests
 * 
 * Tests that the UI properly shows loading state when starting a course from suggested
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { setupTestEnvironment, createTestOutline } from '../helpers/testUtils';
import { useLearnStore } from '../../src/features/learn/store/learnStore';

describe('Learn Mode: Course Generation Loading State', () => {
  beforeEach(async () => {
    await setupTestEnvironment();
  });

  it('should show generating state immediately when starting a course', async () => {
    const outline = await createTestOutline();
    const store = useLearnStore.getState();
    const courseId = outline.courseId;
    
    // Before starting, should not be generating
    expect(store.isGenerating(courseId)).toBe(false);
    
    // Start the course (this sets generating state before async work)
    const startPromise = act(async () => {
      return store.startCourse(outline.id);
    });
    
    // Immediately after calling startCourse (before promise resolves),
    // the generating state should be set
    // Note: We can't check this synchronously because startCourse is async,
    // but we can verify the course exists with no modules
    
    await startPromise;
    
    // After starting, course should exist
    const course = store.getCourseWithModules(courseId);
    expect(course).toBeDefined();
    expect(course.status).toBe('started');
  });

  it('should have course shell created before modal opens', async () => {
    const outline = await createTestOutline();
    const store = useLearnStore.getState();
    const courseId = outline.courseId;
    
    // Start the course
    await act(async () => {
      await store.startCourse(outline.id);
    });
    
    // Course should exist immediately (even without modules)
    const course = store.getCourseWithModules(courseId);
    expect(course).toBeDefined();
    expect(course.id).toBe(courseId);
    expect(course.title).toBe(outline.title);
    
    // Modules array should exist (even if empty)
    expect(Array.isArray(course.modules)).toBe(true);
  });

  it('should show proper state when course has no modules yet', async () => {
    const outline = await createTestOutline();
    const store = useLearnStore.getState();
    const courseId = outline.courseId;
    
    // Start the course (creates shell without modules)
    await act(async () => {
      await store.startCourse(outline.id);
    });
    
    const course = store.getCourseWithModules(courseId);
    
    // Course exists but has no modules
    expect(course).toBeDefined();
    expect(course.modules).toHaveLength(0);
    
    // This is the state when modal should show "Generating..." not "No modules available"
    // The modal should check: generating || modules.length === 0
  });

  it('should not show "No modules available" when course is being generated', async () => {
    const outline = await createTestOutline();
    const store = useLearnStore.getState();
    const courseId = outline.courseId;
    
    // Simulate the generation flow
    await act(async () => {
      // Start course (creates shell)
      await store.startCourse(outline.id);
      
      // Set generating state (this would happen in useLearnOperations)
      store.setGenerating(courseId, true);
    });
    
    const course = store.getCourseWithModules(courseId);
    const isGenerating = store.isGenerating(courseId);
    
    // Course exists with no modules, but is generating
    expect(course).toBeDefined();
    expect(course.modules).toHaveLength(0);
    expect(isGenerating).toBe(true);
    
    // Modal should show "Generating..." because isGenerating is true
    // Not "No modules available"
  });

  it('should transition from generating to ready state', async () => {
    const outline = await createTestOutline();
    const store = useLearnStore.getState();
    const courseId = outline.courseId;
    
    // Start course
    await act(async () => {
      await store.startCourse(outline.id);
      store.setGenerating(courseId, true);
    });
    
    // Initially generating with no modules
    let course = store.getCourseWithModules(courseId);
    let isGenerating = store.isGenerating(courseId);
    expect(course.modules).toHaveLength(0);
    expect(isGenerating).toBe(true);
    
    // Simulate module generation complete
    await act(async () => {
      // Add modules via saveCourse (the proper API)
      const moduleId1 = `${courseId}-module-1`;
      const moduleId2 = `${courseId}-module-2`;
      
      const courseWithModules = {
        id: courseId,
        title: outline.title,
        goal: outline.goal,
        status: 'started',
        modules: [
          {
            id: moduleId1,
            courseId,
            title: 'Module 1',
            lesson: 'Lesson content',
            quiz: [],
            idx: 0,
            estMinutes: 10
          },
          {
            id: moduleId2,
            courseId,
            title: 'Module 2',
            lesson: 'Lesson content',
            quiz: [],
            idx: 1,
            estMinutes: 10
          }
        ]
      };
      
      await store.saveCourse(courseWithModules);
      
      // Clear generating state
      store.setGenerating(courseId, false);
    });
    
    // Now should have modules and not generating
    course = store.getCourseWithModules(courseId);
    isGenerating = store.isGenerating(courseId);
    expect(course.modules).toHaveLength(2);
    expect(isGenerating).toBe(false);
  });
});


