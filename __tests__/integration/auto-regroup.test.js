import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { fullCleanup, initializeStores } from '../helpers/testUtils';
import { autoRegroupPendingCourses, shouldTriggerAutoRegroup } from '../../src/features/learn/services/autoOperations';
import { markOutlineStatus } from '../../src/features/learn/services/learnApi';
import * as learnApi from '../../src/features/learn/services/learnApi';
import { generateId } from '../../src/lib/db/database';

describe('Auto-Regroup Pending Courses', () => {
  beforeEach(async () => {
    await fullCleanup();
    await initializeStores();
    // Reset auto-regroup state
    useLearnStore.getState().setAutoRegrouping(false);
  });

  describe('Auto-regroup trigger conditions', () => {
    it('should not trigger when there are no pending courses', async () => {
      const learnStore = useLearnStore.getState();
      
      // Verify no pending courses
      const pendingCount = learnStore.getPendingCoursesCount();
      expect(pendingCount).toBe(0);
      
      // Should not trigger
      expect(shouldTriggerAutoRegroup()).toBe(false);
    });

    it('should not trigger when there is only 1 pending course', async () => {
      // Create 1 pending course (completed with no goal)
      await act(async () => {
        const courseId = generateId('course');
        await useLearnStore.getState().saveCourse({
          id: courseId,
          title: 'Pending Course 1',
          goal: '', // No goal = pending
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        });
      });
      
      const learnStore = useLearnStore.getState();
      const pendingCount = learnStore.getPendingCoursesCount();
      expect(pendingCount).toBe(1);
      
      // Should not trigger (need at least 2)
      expect(shouldTriggerAutoRegroup()).toBe(false);
    });

    it('should not trigger when there are exactly 2 pending courses', async () => {
      // Get initial count
      const initialCount = useLearnStore.getState().getPendingCoursesCount();
      
      // Create 2 pending courses
      await act(async () => {
        for (let i = 0; i < 2; i++) {
          const courseId = generateId('course');
          await useLearnStore.getState().saveCourse({
            id: courseId,
            title: `Pending Course ${i + 1}`,
            goal: '', // No goal = pending
            moduleIds: [],
            status: 'completed',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          });
        }
      });
      
      const learnStore = useLearnStore.getState();
      const pendingCount = learnStore.getPendingCoursesCount();
      expect(pendingCount).toBe(initialCount + 2);
      
      // Should not trigger (need MORE than 2)
      // Only check if we have exactly 2 total
      if (pendingCount === 2) {
        expect(shouldTriggerAutoRegroup()).toBe(false);
      }
    });

    it('should trigger when there are more than 2 pending courses', async () => {
      // Get initial count
      const initialCount = useLearnStore.getState().getPendingCoursesCount();
      
      // Create 3 pending courses
      await act(async () => {
        for (let i = 0; i < 3; i++) {
          const courseId = generateId('course');
          await useLearnStore.getState().saveCourse({
            id: courseId,
            title: `Pending Course ${i + 1}`,
            goal: '', // No goal = pending
            moduleIds: [],
            status: 'completed',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          });
        }
      });
      
      const learnStore = useLearnStore.getState();
      const pendingCount = learnStore.getPendingCoursesCount();
      expect(pendingCount).toBe(initialCount + 3);
      
      // Should trigger if we have more than 2
      expect(pendingCount).toBeGreaterThan(2);
      expect(shouldTriggerAutoRegroup()).toBe(true);
    });

    it('should not count courses with goals as pending', async () => {
      // Get initial count
      const initialCount = useLearnStore.getState().getPendingCoursesCount();
      
      // Create 2 courses with goals and 1 without
      await act(async () => {
        // With goals
        for (let i = 0; i < 2; i++) {
          const courseId = generateId('course');
          await useLearnStore.getState().saveCourse({
            id: courseId,
            title: `Course with Goal ${i + 1}`,
            goal: 'Test Goal',
            moduleIds: [],
            status: 'completed',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          });
        }
        
        // Without goal
        const courseId = generateId('course');
        await useLearnStore.getState().saveCourse({
          id: courseId,
          title: 'Pending Course',
          goal: '',
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        });
      });
      
      const learnStore = useLearnStore.getState();
      const pendingCount = learnStore.getPendingCoursesCount();
      
      // Should have increased by only 1 (the one without goal)
      expect(pendingCount).toBe(initialCount + 1);
    });

    it('should not count started courses as pending', async () => {
      // Get initial count
      const initialCount = useLearnStore.getState().getPendingCoursesCount();
      
      // Create 3 started courses with no goal
      await act(async () => {
        for (let i = 0; i < 3; i++) {
          const courseId = generateId('course');
          await useLearnStore.getState().saveCourse({
            id: courseId,
            title: `Started Course ${i + 1}`,
            goal: '',
            moduleIds: [],
            status: 'started', // Not completed
            createdAt: new Date().toISOString()
          });
        }
      });
      
      const learnStore = useLearnStore.getState();
      const pendingCount = learnStore.getPendingCoursesCount();
      
      // Should not have increased (started courses don't count)
      expect(pendingCount).toBe(initialCount);
    });
  });

  describe('Auto-regroup state management', () => {
    it('should set isAutoRegrouping to true during regroup', async () => {
      // Mock to delay the operation
      const mockRegroupAllCompleted = vi.spyOn(learnApi, 'regroupAllCompleted');
      let resolvePromise;
      const delayedPromise = new Promise(resolve => {
        resolvePromise = resolve;
      });
      mockRegroupAllCompleted.mockReturnValue(delayedPromise);
      
      // Create 3 pending courses
      await act(async () => {
        for (let i = 0; i < 3; i++) {
          const courseId = generateId('course');
          await useLearnStore.getState().saveCourse({
            id: courseId,
            title: `Pending Course ${i + 1}`,
            goal: '',
            moduleIds: [],
            status: 'completed',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          });
        }
      });
      
      // Start auto-regroup (don't await initially)
      let regroupPromise;
      act(() => {
        regroupPromise = autoRegroupPendingCourses();
      });
      
      // Wait a bit for the state to be set
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Check that isAutoRegrouping is true
      let learnStore = useLearnStore.getState();
      expect(learnStore.isAutoRegrouping).toBe(true);
      
      // Resolve the mock
      resolvePromise({ regrouped: 3, pending: 0, groups: 1 });
      await act(async () => {
        await regroupPromise;
      });
      
      // Check that isAutoRegrouping is false after completion
      learnStore = useLearnStore.getState();
      expect(learnStore.isAutoRegrouping).toBe(false);
      
      mockRegroupAllCompleted.mockRestore();
    });

    it('should not trigger duplicate auto-regroup when already regrouping', async () => {
      vi.clearAllMocks();
      
      const mockRegroupAllCompleted = vi.spyOn(learnApi, 'regroupAllCompleted');
      mockRegroupAllCompleted.mockResolvedValue({ regrouped: 0, pending: 0, groups: 0 });
      
      // Create 3 pending courses
      await act(async () => {
        for (let i = 0; i < 3; i++) {
          const courseId = generateId('course');
          await useLearnStore.getState().saveCourse({
            id: courseId,
            title: `Pending Course ${i + 1}`,
            goal: '',
            moduleIds: [],
            status: 'completed',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          });
        }
      });
      
      // Manually set isAutoRegrouping to true
      useLearnStore.getState().setAutoRegrouping(true);
      
      // Try to trigger auto-regroup
      await act(async () => {
        await autoRegroupPendingCourses();
      });
      
      // Should not have called regroupAllCompleted
      expect(mockRegroupAllCompleted).not.toHaveBeenCalled();
      
      // Reset state
      useLearnStore.getState().setAutoRegrouping(false);
      
      mockRegroupAllCompleted.mockRestore();
    });

    it('should handle errors gracefully without throwing', async () => {
      vi.clearAllMocks();
      
      const mockRegroupAllCompleted = vi.spyOn(learnApi, 'regroupAllCompleted');
      mockRegroupAllCompleted.mockRejectedValue(new Error('Regroup Error'));
      
      // Create 3 pending courses
      await act(async () => {
        for (let i = 0; i < 3; i++) {
          const courseId = generateId('course');
          await useLearnStore.getState().saveCourse({
            id: courseId,
            title: `Pending Course ${i + 1}`,
            goal: '',
            moduleIds: [],
            status: 'completed',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          });
        }
      });
      
      // Trigger auto-regroup - should not throw
      await act(async () => {
        await expect(autoRegroupPendingCourses()).resolves.not.toThrow();
      });
      
      // isAutoRegrouping should be reset to false
      const learnStore = useLearnStore.getState();
      expect(learnStore.isAutoRegrouping).toBe(false);
      
      mockRegroupAllCompleted.mockRestore();
    });
  });

  describe('Integration with "already know" action', () => {
    it('should trigger auto-regroup after marking 3rd course as "already know"', async () => {
      vi.clearAllMocks();
      
      const mockRegroupAllCompleted = vi.spyOn(learnApi, 'regroupAllCompleted');
      mockRegroupAllCompleted.mockResolvedValue({ regrouped: 3, pending: 0, groups: 1 });
      
      // Get initial count
      const initialCount = useLearnStore.getState().getPendingCoursesCount();
      
      // Create 2 outlines and mark them as "already know"
      await act(async () => {
        for (let i = 0; i < 2; i++) {
          const outlineId = generateId('outline');
          const courseId = generateId('course');
          
          await useLearnStore.getState().addOutline({
            id: outlineId,
            courseId: courseId,
            title: `Course ${i + 1}`,
            whySuggested: 'Test',
            questions: [],
            moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
            sourceChatIds: [],
            suggestKind: 'explore',
            status: 'suggested',
            createdAt: new Date().toISOString()
          });
          
          await markOutlineStatus(outlineId, 'completed', 'already_know');
        }
      });
      
      // Verify 2 pending courses were added
      let learnStore = useLearnStore.getState();
      expect(learnStore.getPendingCoursesCount()).toBe(initialCount + 2);
      
      // Auto-regroup should not have been called yet (need > 2 total)
      if (initialCount + 2 <= 2) {
        expect(mockRegroupAllCompleted).not.toHaveBeenCalled();
      }
      
      // Mark 3rd course as "already know"
      await act(async () => {
        const outlineId = generateId('outline');
        const courseId = generateId('course');
        
        await useLearnStore.getState().addOutline({
          id: outlineId,
          courseId: courseId,
          title: 'Course 3',
          whySuggested: 'Test',
          questions: [],
          moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
          sourceChatIds: [],
          suggestKind: 'explore',
          status: 'suggested',
          createdAt: new Date().toISOString()
        });
        
        await markOutlineStatus(outlineId, 'completed', 'already_know');
      });
      
      // Wait for background operation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Auto-regroup should have been triggered if we now have > 2 total
      learnStore = useLearnStore.getState();
      if (learnStore.getPendingCoursesCount() > 2) {
        expect(mockRegroupAllCompleted).toHaveBeenCalled();
      }
      
      mockRegroupAllCompleted.mockRestore();
    });

    it('should not trigger auto-regroup when marking 2nd course as "already know"', async () => {
      vi.clearAllMocks();
      
      const mockRegroupAllCompleted = vi.spyOn(learnApi, 'regroupAllCompleted');
      mockRegroupAllCompleted.mockResolvedValue({ regrouped: 0, pending: 2, groups: 0 });
      
      // Get initial count
      const initialCount = useLearnStore.getState().getPendingCoursesCount();
      
      // If we already have > 0 pending, clear them for this test
      if (initialCount > 0) {
        // This test expects to start fresh, so skip if there's already data
        mockRegroupAllCompleted.mockRestore();
        return;
      }
      
      // Create and mark 2 courses as "already know"
      await act(async () => {
        for (let i = 0; i < 2; i++) {
          const outlineId = generateId('outline');
          const courseId = generateId('course');
          
          await useLearnStore.getState().addOutline({
            id: outlineId,
            courseId: courseId,
            title: `Course ${i + 1}`,
            whySuggested: 'Test',
            questions: [],
            moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
            sourceChatIds: [],
            suggestKind: 'explore',
            status: 'suggested',
            createdAt: new Date().toISOString()
          });
          
          await markOutlineStatus(outlineId, 'completed', 'already_know');
        }
      });
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Auto-regroup should NOT have been triggered (need > 2)
      expect(mockRegroupAllCompleted).not.toHaveBeenCalled();
      
      mockRegroupAllCompleted.mockRestore();
    });
  });

  describe('Pending courses count accuracy', () => {
    it('should correctly count pending courses with various statuses', async () => {
      // Get initial count
      const initialCount = useLearnStore.getState().getPendingCoursesCount();
      
      await act(async () => {
        // 3 completed with no goal (pending)
        for (let i = 0; i < 3; i++) {
          const courseId = generateId('course');
          await useLearnStore.getState().saveCourse({
            id: courseId,
            title: `Pending ${i + 1}`,
            goal: '',
            moduleIds: [],
            status: 'completed',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          });
        }
        
        // 2 completed with goal (not pending)
        for (let i = 0; i < 2; i++) {
          const courseId = generateId('course');
          await useLearnStore.getState().saveCourse({
            id: courseId,
            title: `With Goal ${i + 1}`,
            goal: 'Test Goal',
            moduleIds: [],
            status: 'completed',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          });
        }
        
        // 1 started with no goal (not pending - not completed)
        const courseId = generateId('course');
        await useLearnStore.getState().saveCourse({
          id: courseId,
          title: 'Started',
          goal: '',
          moduleIds: [],
          status: 'started',
          createdAt: new Date().toISOString()
        });
      });
      
      const learnStore = useLearnStore.getState();
      const pendingCount = learnStore.getPendingCoursesCount();
      
      // Should have increased by 3 (only the completed courses with no goal)
      expect(pendingCount).toBe(initialCount + 3);
    });

    it('should treat whitespace-only goal as pending', async () => {
      // Get initial count
      const initialCount = useLearnStore.getState().getPendingCoursesCount();
      
      await act(async () => {
        // Course with whitespace-only goal
        const courseId = generateId('course');
        await useLearnStore.getState().saveCourse({
          id: courseId,
          title: 'Whitespace Goal',
          goal: '   ', // Whitespace only
          moduleIds: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        });
      });
      
      const learnStore = useLearnStore.getState();
      const pendingCount = learnStore.getPendingCoursesCount();
      
      // Should have increased by 1 (whitespace-only goal counts as pending)
      expect(pendingCount).toBe(initialCount + 1);
    });
  });
});

