import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { fullCleanup, initializeStores } from '../helpers/testUtils';
import { generateId } from '../../src/lib/db/database';
import { generateFullCourse } from '../../src/features/learn/services/learnApi';

// Mock the generateFullCourse function
vi.mock('../../src/features/learn/services/learnApi', async () => {
  const actual = await vi.importActual('../../src/features/learn/services/learnApi');
  return {
    ...actual,
    generateFullCourse: vi.fn()
  };
});

describe('Course Generation Error Handling', () => {
  beforeEach(async () => {
    await fullCleanup();
    await initializeStores();
    vi.clearAllMocks();
  });

  it('should track generation error when course generation fails', async () => {
    const courseId = generateId('course');
    const errorMessage = 'Course generation returned invalid JSON';
    
    await act(async () => {
      const store = useLearnStore.getState();
      
      // Set generation error
      store.setGenerationError(courseId, errorMessage);
    });

    // Verify error is tracked
    const store = useLearnStore.getState();
    const error = store.getGenerationError(courseId);
    
    expect(error).toBe(errorMessage);
    expect(store.generationErrors[courseId]).toBeDefined();
    expect(store.generationErrors[courseId].error).toBe(errorMessage);
    expect(store.generationErrors[courseId].timestamp).toBeDefined();
  });

  it('should clear generation error when set to null', async () => {
    const courseId = generateId('course');
    
    await act(async () => {
      const store = useLearnStore.getState();
      
      // Set error
      store.setGenerationError(courseId, 'Some error');
      
      // Clear error
      store.setGenerationError(courseId, null);
    });

    // Verify error is cleared
    const store = useLearnStore.getState();
    const error = store.getGenerationError(courseId);
    
    expect(error).toBeNull();
    expect(store.generationErrors[courseId]).toBeUndefined();
  });

  it('should return null for non-existent error', async () => {
    const store = useLearnStore.getState();
    const error = store.getGenerationError('nonexistent-id');
    
    expect(error).toBeNull();
  });

  it('should keep course in started state after generation error', async () => {
    const outlineId = generateId('outline');
    const courseId = generateId('course');
    
    await act(async () => {
      // Create outline
      await useLearnStore.getState().saveOutline({
        id: outlineId,
        courseId: courseId,
        title: 'Test Course',
        questions: ['Q1', 'Q2'],
        moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
        status: 'suggested',
        createdAt: new Date().toISOString(),
      });
      
      // Start course (creates shell)
      const result = await useLearnStore.getState().startCourse(outlineId);
      expect(result.success).toBe(true);
      
      // Simulate generation error
      useLearnStore.getState().setGenerationError(courseId, 'Generation failed');
    });

    // Verify course is still in started state
    const store = useLearnStore.getState();
    const course = store.courses[courseId];
    
    expect(course).toBeDefined();
    expect(course.status).toBe('started');
    expect(course.moduleIds.length).toBe(0); // No modules generated
    
    // Verify error is tracked
    const error = store.getGenerationError(courseId);
    expect(error).toBe('Generation failed');
  });

  it('should allow retry after generation error', async () => {
    const outlineId = generateId('outline');
    const courseId = generateId('course');
    
    await act(async () => {
      // Create outline
      await useLearnStore.getState().saveOutline({
        id: outlineId,
        courseId: courseId,
        title: 'Test Course',
        questions: ['Q1', 'Q2'],
        moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
        status: 'suggested',
        createdAt: new Date().toISOString(),
      });
      
      // Start course
      await useLearnStore.getState().startCourse(outlineId);
      
      // First attempt fails
      useLearnStore.getState().setGenerationError(courseId, 'First attempt failed');
    });

    let store = useLearnStore.getState();
    let error = store.getGenerationError(courseId);
    expect(error).toBe('First attempt failed');
    
    await act(async () => {
      // Clear error for retry
      useLearnStore.getState().setGenerationError(courseId, null);
      
      // Retry would happen here (in real code)
      // For test, just verify error is cleared
    });

    store = useLearnStore.getState();
    error = store.getGenerationError(courseId);
    expect(error).toBeNull();
  });

  it('should handle multiple concurrent generation errors', async () => {
    const courseId1 = generateId('course');
    const courseId2 = generateId('course');
    const courseId3 = generateId('course');
    
    await act(async () => {
      const store = useLearnStore.getState();
      
      // Set errors for multiple courses
      store.setGenerationError(courseId1, 'Error 1');
      store.setGenerationError(courseId2, 'Error 2');
      store.setGenerationError(courseId3, 'Error 3');
    });

    // Verify all errors are tracked independently
    const store = useLearnStore.getState();
    
    expect(store.getGenerationError(courseId1)).toBe('Error 1');
    expect(store.getGenerationError(courseId2)).toBe('Error 2');
    expect(store.getGenerationError(courseId3)).toBe('Error 3');
    
    await act(async () => {
      // Clear one error
      store.setGenerationError(courseId2, null);
    });
    
    // Verify only the cleared error is gone
    expect(store.getGenerationError(courseId1)).toBe('Error 1');
    expect(store.getGenerationError(courseId2)).toBeNull();
    expect(store.getGenerationError(courseId3)).toBe('Error 3');
  });

  it('should handle different error message types', async () => {
    const courseId = generateId('course');
    
    const errorTypes = [
      'Course generation returned invalid JSON',
      'API Error: Rate limit exceeded',
      'Network error',
      'Timeout error',
      'Failed to parse course data'
    ];
    
    for (const errorMsg of errorTypes) {
      await act(async () => {
        useLearnStore.getState().setGenerationError(courseId, errorMsg);
      });
      
      const store = useLearnStore.getState();
      const error = store.getGenerationError(courseId);
      
      expect(error).toBe(errorMsg);
    }
  });

  it('should persist generation state correctly during error', async () => {
    const outlineId = generateId('outline');
    const courseId = generateId('course');
    
    await act(async () => {
      // Create outline
      await useLearnStore.getState().saveOutline({
        id: outlineId,
        courseId: courseId,
        title: 'Test Course',
        questions: ['Q1'],
        moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
        status: 'suggested',
        createdAt: new Date().toISOString(),
      });
      
      // Start course
      await useLearnStore.getState().startCourse(outlineId);
      
      // Mark as generating
      useLearnStore.getState().setGenerating(courseId, true);
    });

    let store = useLearnStore.getState();
    expect(store.isGenerating(courseId)).toBe(true);
    
    await act(async () => {
      // Generation fails
      useLearnStore.getState().setGenerationError(courseId, 'Generation failed');
      
      // Stop generating
      useLearnStore.getState().setGenerating(courseId, false);
    });

    store = useLearnStore.getState();
    
    // Verify generating is stopped
    expect(store.isGenerating(courseId)).toBe(false);
    
    // Verify error is tracked
    expect(store.getGenerationError(courseId)).toBe('Generation failed');
    
    // Verify course still exists
    expect(store.courses[courseId]).toBeDefined();
  });

  it('should handle error when outline is missing during retry', async () => {
    const courseId = generateId('course');
    
    await act(async () => {
      // Create course without outline
      const shellCourse = {
        id: courseId,
        title: 'Test Course',
        goal: '',
        questionIds: [],
        moduleIds: [],
        whereToGoNext: '',
        status: 'started',
        progressByModule: {},
        completedVia: null,
        createdAt: new Date().toISOString(),
        completedAt: null
      };
      
      await useLearnStore.getState().saveCourse(shellCourse);
      
      // Set error
      useLearnStore.getState().setGenerationError(courseId, 'Generation failed');
    });

    const store = useLearnStore.getState();
    
    // Course exists with error
    expect(store.courses[courseId]).toBeDefined();
    expect(store.getGenerationError(courseId)).toBe('Generation failed');
    
    // No outline exists - retry would need to handle this
    const outlines = Object.values(store.outlines);
    const outline = outlines.find(o => o.courseId === courseId);
    expect(outline).toBeUndefined();
  });

  it('should clear error when successfully regenerating course', async () => {
    const outlineId = generateId('outline');
    const courseId = generateId('course');
    
    await act(async () => {
      // Create outline
      await useLearnStore.getState().saveOutline({
        id: outlineId,
        courseId: courseId,
        title: 'Test Course',
        questions: ['Q1', 'Q2'],
        moduleSummary: [
          { title: 'Module 1', estMinutes: 5 },
          { title: 'Module 2', estMinutes: 5 }
        ],
        status: 'suggested',
        createdAt: new Date().toISOString(),
      });
      
      // Start course
      await useLearnStore.getState().startCourse(outlineId);
      
      // First attempt fails
      useLearnStore.getState().setGenerationError(courseId, 'First attempt failed');
    });

    let store = useLearnStore.getState();
    expect(store.getGenerationError(courseId)).toBe('First attempt failed');
    
    await act(async () => {
      // Clear error (simulating successful retry)
      useLearnStore.getState().setGenerationError(courseId, null);
      
      // Simulate successful generation
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
          },
          {
            id: generateId('mod'),
            courseId: courseId,
            idx: 2,
            title: 'Module 2',
            estMinutes: 5,
            lesson: 'Lesson content 2',
            microTask: '',
            quiz: [],
            refs: []
          }
        ],
        whereToGoNext: '',
        status: 'started',
        progressByModule: {},
        completedVia: null,
        createdAt: new Date().toISOString(),
        completedAt: null
      };
      
      await useLearnStore.getState().saveCourse(fullCourse);
    });

    store = useLearnStore.getState();
    
    // Error should be cleared
    expect(store.getGenerationError(courseId)).toBeNull();
    
    // Course should have modules
    const course = store.getCourseWithModules(courseId);
    expect(course).toBeDefined();
    expect(course.modules.length).toBe(2);
  });
});

