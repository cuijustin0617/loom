import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { fullCleanup, initializeStores } from '../helpers/testUtils';
import { generateId } from '../../src/lib/db/database';
import { markOutlineStatus } from '../../src/features/learn/services/learnApi';

describe('Dismiss Action', () => {
  beforeEach(async () => {
    await fullCleanup();
    await initializeStores();
  });

  it('should remove started course from continue page when dismissed', async () => {
    const goalLabel = `Test Goal ${Date.now()}`;
    let outlineId, courseId;
    
    await act(async () => {
      await useLearnStore.getState().addGoal(goalLabel, 'Description');
      
      outlineId = generateId('outline');
      courseId = generateId('course');
      
      // Create outline in 'suggested' status
      await useLearnStore.getState().saveOutline({
        id: outlineId,
        courseId: courseId,
        title: 'Test Outline',
        goal: goalLabel,
        questions: [],
        modules: [],
        moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
        whereToGoNext: '',
        status: 'suggested',
        createdAt: new Date().toISOString(),
      });
      
      // Simulate saving the outline (which creates a started course)
      await markOutlineStatus(outlineId, 'started', 'save');
    });

    // Verify course is in started state
    let store = useLearnStore.getState();
    let course = store.courses[courseId];
    
    expect(course).toBeDefined();
    expect(course.status).toBe('started');
    
    // Get started courses
    let startedCourses = store.getStartedCourses();
    expect(startedCourses.some(c => c.id === courseId)).toBe(true);
    
    // Now dismiss the outline
    await act(async () => {
      await markOutlineStatus(outlineId, 'dismissed', 'dismiss');
    });

    // Verify course is no longer in started state
    store = useLearnStore.getState();
    course = store.courses[courseId];
    
    // Course should either be dismissed or deleted
    if (course) {
      expect(course.status).not.toBe('started');
    }
    
    // Verify it's not in started courses
    startedCourses = store.getStartedCourses();
    expect(startedCourses.some(c => c.id === courseId)).toBe(false);
  });

  it('should remove outline from suggested when dismissed', async () => {
    const goalLabel = `Test Goal ${Date.now()}`;
    let outlineId;
    
    await act(async () => {
      await useLearnStore.getState().addGoal(goalLabel, 'Description');
      
      outlineId = generateId('outline');
      
      await useLearnStore.getState().saveOutline({
        id: outlineId,
        courseId: generateId('course'),
        title: 'Test Outline',
        goal: goalLabel,
        questions: [],
        modules: [],
        moduleSummary: [],
        whereToGoNext: '',
        status: 'suggested',
        createdAt: new Date().toISOString(),
      });
    });

    // Verify outline is in suggested
    let store = useLearnStore.getState();
    let suggestedOutlines = store.getSuggestedOutlines();
    expect(suggestedOutlines.some(o => o.id === outlineId)).toBe(true);
    
    // Dismiss the outline
    await act(async () => {
      await markOutlineStatus(outlineId, 'dismissed', 'dismiss');
    });

    // Verify outline is no longer in suggested
    store = useLearnStore.getState();
    suggestedOutlines = store.getSuggestedOutlines();
    expect(suggestedOutlines.some(o => o.id === outlineId)).toBe(false);
    
    // Verify outline status is dismissed
    const outline = store.outlines[outlineId];
    expect(outline.status).toBe('dismissed');
  });

  it('should handle dismissing outline with no corresponding course', async () => {
    const goalLabel = `Test Goal ${Date.now()}`;
    let outlineId;
    
    await act(async () => {
      await useLearnStore.getState().addGoal(goalLabel, 'Description');
      
      outlineId = generateId('outline');
      
      // Just create outline, no course
      await useLearnStore.getState().saveOutline({
        id: outlineId,
        courseId: generateId('course'), // Course doesn't exist
        title: 'Test Outline',
        goal: goalLabel,
        questions: [],
        modules: [],
        moduleSummary: [],
        whereToGoNext: '',
        status: 'suggested',
        createdAt: new Date().toISOString(),
      });
    });

    // Dismiss should work without error
    await act(async () => {
      await expect(markOutlineStatus(outlineId, 'dismissed', 'dismiss')).resolves.not.toThrow();
    });

    // Verify outline is dismissed
    const store = useLearnStore.getState();
    const outline = store.outlines[outlineId];
    expect(outline.status).toBe('dismissed');
  });

  it('should handle dismissing multiple courses', async () => {
    const goalLabel = `Test Goal ${Date.now()}`;
    const outlineIds = [];
    const courseIds = [];
    
    await act(async () => {
      await useLearnStore.getState().addGoal(goalLabel, 'Description');
      
      // Create 3 started courses
      for (let i = 0; i < 3; i++) {
        const outlineId = generateId('outline');
        const courseId = generateId('course');
        
        outlineIds.push(outlineId);
        courseIds.push(courseId);
        
        await useLearnStore.getState().saveOutline({
          id: outlineId,
          courseId: courseId,
          title: `Test Outline ${i}`,
          goal: goalLabel,
          questions: [],
          modules: [],
          moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
          whereToGoNext: '',
          status: 'suggested',
          createdAt: new Date().toISOString(),
        });
        
        await markOutlineStatus(outlineId, 'started', 'save');
      }
    });

    // Verify all 3 are in started
    let store = useLearnStore.getState();
    let startedCourses = store.getStartedCourses();
    expect(startedCourses.filter(c => courseIds.includes(c.id)).length).toBe(3);
    
    // Dismiss first 2
    await act(async () => {
      await markOutlineStatus(outlineIds[0], 'dismissed', 'dismiss');
      await markOutlineStatus(outlineIds[1], 'dismissed', 'dismiss');
    });

    // Verify only 1 remains in started
    store = useLearnStore.getState();
    startedCourses = store.getStartedCourses();
    expect(startedCourses.filter(c => courseIds.includes(c.id)).length).toBe(1);
    expect(startedCourses.some(c => c.id === courseIds[2])).toBe(true);
  });
});

