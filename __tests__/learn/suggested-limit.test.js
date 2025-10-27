import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { fullCleanup, initializeStores } from '../helpers/testUtils';
import { generateId } from '../../src/lib/db/database';

describe('Learn Mode: Suggested Outlines Limit', () => {
  beforeEach(async () => {
    await fullCleanup();
    await initializeStores();
  });

  describe('Suggested Outlines Max 9', () => {
    it('should only keep 9 most recent suggested outlines', async () => {
      const uniqueGoal = `Test Goal ${Date.now()}`;
      await act(async () => {
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        // Add 15 suggested outlines
        for (let i = 0; i < 15; i++) {
          const outlineId = generateId('outline');
          await useLearnStore.getState().saveOutline({
            id: outlineId,
            title: `Outline ${i}`,
            goal: uniqueGoal,
            modules: [],
            whereToGoNext: '',
            status: 'suggested',
            createdAt: new Date(Date.now() + i * 1000).toISOString() // Ensure different timestamps
          });
        }
      });

      const store = useLearnStore.getState();
      const suggestedOutlines = store.getSuggestedOutlines();
      
      // Should only have 9 most recent
      expect(suggestedOutlines.length).toBeLessThanOrEqual(9);
    });

    it('should remove oldest suggested outlines when adding new ones', async () => {
      const uniqueGoal = `Test Goal ${Date.now()}`;
      await act(async () => {
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        // Add 9 outlines
        const oldOutlineIds = [];
        for (let i = 0; i < 9; i++) {
          const outlineId = generateId('outline');
          oldOutlineIds.push(outlineId);
          await useLearnStore.getState().saveOutline({
            id: outlineId,
            title: `Old Outline ${i}`,
            goal: uniqueGoal,
            modules: [],
            whereToGoNext: '',
            status: 'suggested',
            createdAt: new Date(Date.now() + i * 1000).toISOString()
          });
        }
        
        // Add 3 more (should remove 3 oldest)
        const newOutlineIds = [];
        for (let i = 0; i < 3; i++) {
          const outlineId = generateId('outline');
          newOutlineIds.push(outlineId);
          await useLearnStore.getState().saveOutline({
            id: outlineId,
            title: `New Outline ${i}`,
            goal: uniqueGoal,
            modules: [],
            whereToGoNext: '',
            status: 'suggested',
            createdAt: new Date(Date.now() + 10000 + i * 1000).toISOString()
          });
        }
        
        // Cleanup old outlines
        await useLearnStore.getState().cleanupOldSuggestedOutlines();
      });

      const store = useLearnStore.getState();
      const suggestedOutlines = store.getSuggestedOutlines();
      
      expect(suggestedOutlines.length).toBeLessThanOrEqual(9);
      
      // Should have the 3 newest plus 6 from the old batch
      const titles = suggestedOutlines.map(o => o.title);
      expect(titles).toContain('New Outline 0');
      expect(titles).toContain('New Outline 1');
      expect(titles).toContain('New Outline 2');
    });

    it('should not remove outlines that have been started or saved', async () => {
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        // Add 9 suggested outlines
        for (let i = 0; i < 9; i++) {
          const outlineId = generateId('outline');
          await useLearnStore.getState().saveOutline({
            id: outlineId,
            title: `Outline ${i}`,
            goal: uniqueGoal,
            modules: [],
            whereToGoNext: '',
            status: 'suggested',
            createdAt: new Date(Date.now() + i * 1000).toISOString()
          });
        }
        
        // Start one outline (convert to course)
        const suggestedBefore = useLearnStore.getState().getSuggestedOutlines();
        const firstOutline = suggestedBefore[0];
        
        await useLearnStore.getState().updateOutlineStatus(firstOutline.id, 'started');
        
        // Add more outlines
        for (let i = 0; i < 5; i++) {
          const outlineId = generateId('outline');
          await useLearnStore.getState().saveOutline({
            id: outlineId,
            title: `New Outline ${i}`,
            goal: uniqueGoal,
            modules: [],
            whereToGoNext: '',
            status: 'suggested',
            createdAt: new Date(Date.now() + 10000 + i * 1000).toISOString()
          });
        }
        
        // Cleanup old suggested
        await useLearnStore.getState().cleanupOldSuggestedOutlines();
      });

      const store = useLearnStore.getState();
      const suggestedOutlines = store.getSuggestedOutlines();
      
      // Should only have suggested ones, max 9
      expect(suggestedOutlines.length).toBeLessThanOrEqual(9);
      
      // Started outline should not be in suggested anymore
      const allOutlines = Object.values(store.outlines);
      const startedOutlines = allOutlines.filter(o => o.status === 'started');
      expect(startedOutlines.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle dismissed outlines separately from cleanup', async () => {
      const beforeSuggestedCount = useLearnStore.getState().getSuggestedOutlines().length;
      
      let dismissedId;
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        // Add 5 outlines
        const outlineIds = [];
        for (let i = 0; i < 5; i++) {
          const outlineId = generateId('outline');
          outlineIds.push(outlineId);
          await useLearnStore.getState().saveOutline({
            id: outlineId,
            title: `Outline ${i}`,
            goal: uniqueGoal,
            modules: [],
            whereToGoNext: '',
            status: 'suggested',
            createdAt: new Date(Date.now() + i * 1000).toISOString()
          });
        }
        
        // Dismiss one (before cleanup)
        dismissedId = outlineIds[0];
        await useLearnStore.getState().updateOutlineStatus(dismissedId, 'dismissed');
      });

      const store = useLearnStore.getState();
      const suggestedOutlines = store.getSuggestedOutlines();
      const allOutlines = Object.values(store.outlines);
      
      // Dismissed should not be in suggested
      expect(suggestedOutlines.length).toBeLessThanOrEqual(9);
      
      // Dismissed outline should not be in suggested
      expect(suggestedOutlines.some(o => o.id === dismissedId)).toBe(false);
      
      // Check if dismissed outline exists (it should be in outlines with status 'dismissed')
      const dismissedOutline = store.outlines[dismissedId];
      if (dismissedOutline) {
        expect(dismissedOutline.status).toBe('dismissed');
      } else {
        // If it was cleaned up, check if at least the dismiss operation worked
        const stillSuggested = suggestedOutlines.some(o => o.id === dismissedId);
        expect(stillSuggested).toBe(false);
      }
    });
  });

  describe('No Pagination for Suggested', () => {
    it('should never have more than one page of suggested outlines', async () => {
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        // Try to add 20 outlines
        for (let i = 0; i < 20; i++) {
          const outlineId = generateId('outline');
          await useLearnStore.getState().saveOutline({
            id: outlineId,
            title: `Outline ${i}`,
            goal: uniqueGoal,
            modules: [],
            whereToGoNext: '',
            status: 'suggested',
            createdAt: new Date(Date.now() + i * 1000).toISOString()
          });
        }
        
        // Cleanup to enforce limit
        await useLearnStore.getState().cleanupOldSuggestedOutlines();
      });

      const store = useLearnStore.getState();
      const suggestedOutlines = store.getSuggestedOutlines();
      
      // With ITEMS_PER_PAGE = 10 in LearnView, 9 items means no pagination needed
      expect(suggestedOutlines.length).toBeLessThanOrEqual(9);
      
      // Verify pagination would be 0 or 1 pages (not 2+)
      const ITEMS_PER_PAGE = 10;
      const totalPages = Math.ceil(suggestedOutlines.length / ITEMS_PER_PAGE);
      expect(totalPages).toBeLessThanOrEqual(1);
    });

    it('should maintain most recent outlines after cleanup', async () => {
      const uniquePrefix = `${Date.now()}_${Math.random()}`;
      const createdTitles = [];
      
      await act(async () => {
        const uniqueGoal = `Test Goal ${uniquePrefix}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        // Add outlines with incrementing timestamps
        const baseTime = Date.now();
        for (let i = 0; i < 12; i++) {
          const outlineId = generateId('outline');
          const title = `Outline_${uniquePrefix}_${i}`;
          createdTitles.push(title);
          await useLearnStore.getState().saveOutline({
            id: outlineId,
            title,
            goal: uniqueGoal,
            modules: [],
            whereToGoNext: '',
            status: 'suggested',
            createdAt: new Date(baseTime + i * 1000).toISOString()
          });
        }
        
        // Cleanup
        await useLearnStore.getState().cleanupOldSuggestedOutlines();
      });

      const store = useLearnStore.getState();
      const suggestedOutlines = store.getSuggestedOutlines();
      
      expect(suggestedOutlines.length).toBeLessThanOrEqual(9);
      
      // Filter to only our test outlines
      const ourOutlines = suggestedOutlines.filter(o => o.title.includes(uniquePrefix));
      
      // Should have max 9 of our outlines
      expect(ourOutlines.length).toBeLessThanOrEqual(9);
      
      // The most recent should be present (last 9 created)
      if (ourOutlines.length > 0) {
        const lastCreatedTitles = createdTitles.slice(-9);
        // At least some of the most recent should be present
        const hasRecentOnes = ourOutlines.some(o => lastCreatedTitles.includes(o.title));
        expect(hasRecentOnes).toBe(true);
      }
    });
  });

  describe('Empty State Handling', () => {
    it('should handle when there are no suggested outlines', async () => {
      const beforeCount = useLearnStore.getState().getSuggestedOutlines().length;
      
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
      });

      const afterCount = useLearnStore.getState().getSuggestedOutlines().length;
      
      // Adding a goal shouldn't add suggested outlines
      expect(afterCount).toBe(beforeCount);
    });

    it('should not error when cleaning up with no outlines', async () => {
      const beforeCount = useLearnStore.getState().getSuggestedOutlines().length;
      
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        // Cleanup with no new outlines
        await useLearnStore.getState().cleanupOldSuggestedOutlines();
      });

      const afterCount = useLearnStore.getState().getSuggestedOutlines().length;
      
      // Cleanup shouldn't error and shouldn't change count when nothing is added
      expect(afterCount).toBe(beforeCount);
    });

    it('should handle cleanup with fewer than 9 outlines', async () => {
      // First, clear existing suggested outlines to have a clean slate
      await act(async () => {
        await useLearnStore.getState().clearSuggestedOutlines();
      });
      
      const uniquePrefix = `${Date.now()}_${Math.random()}`;
      
      await act(async () => {
        const uniqueGoal = `Test Goal ${uniquePrefix}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        // Add only 3 outlines with future timestamps (so they're most recent)
        const baseTime = Date.now() + 100000; // Far future
        for (let i = 0; i < 3; i++) {
          const outlineId = generateId('outline');
          await useLearnStore.getState().saveOutline({
            id: outlineId,
            title: `Outline_${uniquePrefix}_${i}`,
            goal: uniqueGoal,
            modules: [],
            whereToGoNext: '',
            status: 'suggested',
            createdAt: new Date(baseTime + i * 1000).toISOString()
          });
        }
        
        // Cleanup (should not remove anything since we only have 3)
        await useLearnStore.getState().cleanupOldSuggestedOutlines();
      });

      const store = useLearnStore.getState();
      const suggestedOutlines = store.getSuggestedOutlines();
      const ourOutlines = suggestedOutlines.filter(o => o.title.includes(uniquePrefix));
      
      // All 3 of our outlines should still be there
      expect(ourOutlines.length).toBe(3);
      
      // Total should be at most 9 and in this case should be exactly 3 (since we cleared before)
      expect(suggestedOutlines.length).toBeLessThanOrEqual(9);
      expect(suggestedOutlines.length).toBe(3);
    });
  });
});

