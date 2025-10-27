import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useChatStore } from '../../src/features/chat/store/chatStore';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { fullCleanup, initializeStores } from '../helpers/testUtils';
import { autoRefreshSuggestedFeed } from '../../src/features/learn/services/autoOperations';
import * as learnApi from '../../src/features/learn/services/learnApi';

describe('Auto-Refresh Suggested Feed', () => {
  beforeEach(async () => {
    await fullCleanup();
    await initializeStores();
    // Reset auto-refresh state
    useLearnStore.getState().setAutoRefreshing(false);
  });

  describe('Auto-refresh trigger conditions', () => {
    it('should not trigger auto-refresh when no conversations exist', async () => {
      const learnStore = useLearnStore.getState();
      
      // Verify no conversations
      const chatStore = useChatStore.getState();
      expect(Object.keys(chatStore.conversations).length).toBe(0);
      
      // Try to trigger auto-refresh
      await act(async () => {
        await autoRefreshSuggestedFeed();
      });
      
      // Should not have generated any outlines
      const outlines = Object.values(learnStore.outlines);
      expect(outlines.length).toBe(0);
    });

    it('should not trigger auto-refresh when conversations have no messages', async () => {
      let convId;
      
      // Create empty conversation
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
      });
      
      const learnStore = useLearnStore.getState();
      
      // Try to trigger auto-refresh
      await act(async () => {
        await autoRefreshSuggestedFeed();
      });
      
      // Should not have generated any outlines
      const outlines = Object.values(learnStore.outlines);
      expect(outlines.length).toBe(0);
    });

    it('should trigger auto-refresh when conversations have messages', async () => {
      // Mock the generateLearnProposals to avoid actual API calls
      const mockGenerateLearnProposals = vi.spyOn(learnApi, 'generateLearnProposals');
      mockGenerateLearnProposals.mockResolvedValue({
        outlines: [
          {
            id: 'outline-1',
            courseId: 'course-1',
            title: 'Test Course',
            whySuggested: 'Test reason',
            questions: ['Q1', 'Q2'],
            moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
            sourceChatIds: [],
            suggestKind: 'explore',
            status: 'suggested',
            createdAt: new Date().toISOString()
          }
        ]
      });
      
      // Create conversation with messages
      await act(async () => {
        const convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(convId, {
          role: 'user',
          content: 'What is machine learning?'
        });
        await useChatStore.getState().addMessage(convId, {
          role: 'assistant',
          content: 'Machine learning is a branch of AI...'
        });
      });
      
      const learnStore = useLearnStore.getState();
      
      // Trigger auto-refresh
      await act(async () => {
        await autoRefreshSuggestedFeed();
      });
      
      // Should have called generateLearnProposals
      expect(mockGenerateLearnProposals).toHaveBeenCalled();
      
      // Reload store state after async operation
      const updatedLearnStore = useLearnStore.getState();
      
      // Should have generated outlines
      const outlines = Object.values(updatedLearnStore.outlines);
      expect(outlines.length).toBeGreaterThan(0);
      
      mockGenerateLearnProposals.mockRestore();
    });
  });

  describe('Auto-refresh state management', () => {
    it('should set isAutoRefreshing to true during refresh', async () => {
      // Mock to delay the operation
      const mockGenerateLearnProposals = vi.spyOn(learnApi, 'generateLearnProposals');
      let resolvePromise;
      const delayedPromise = new Promise(resolve => {
        resolvePromise = resolve;
      });
      mockGenerateLearnProposals.mockReturnValue(delayedPromise);
      
      // Create conversation with messages
      await act(async () => {
        const convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(convId, {
          role: 'user',
          content: 'Test message'
        });
      });
      
      // Start auto-refresh (don't await initially)
      let refreshPromise;
      act(() => {
        refreshPromise = autoRefreshSuggestedFeed();
      });
      
      // Wait a bit for the state to be set
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Check that isAutoRefreshing is true
      let learnStore = useLearnStore.getState();
      expect(learnStore.isAutoRefreshing).toBe(true);
      
      // Resolve the mock
      resolvePromise({ outlines: [] });
      await act(async () => {
        await refreshPromise;
      });
      
      // Check that isAutoRefreshing is false after completion
      learnStore = useLearnStore.getState();
      expect(learnStore.isAutoRefreshing).toBe(false);
      
      mockGenerateLearnProposals.mockRestore();
    });

    it('should not trigger duplicate auto-refresh when already refreshing', async () => {
      // Reset mocks from previous tests
      vi.clearAllMocks();
      
      const mockGenerateLearnProposals = vi.spyOn(learnApi, 'generateLearnProposals');
      mockGenerateLearnProposals.mockResolvedValue({ outlines: [] });
      
      // Create conversation with messages
      await act(async () => {
        const convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(convId, {
          role: 'user',
          content: 'Test message'
        });
      });
      
      // Manually set isAutoRefreshing to true
      useLearnStore.getState().setAutoRefreshing(true);
      
      // Try to trigger auto-refresh
      await act(async () => {
        await autoRefreshSuggestedFeed();
      });
      
      // Should not have called generateLearnProposals
      expect(mockGenerateLearnProposals).not.toHaveBeenCalled();
      
      // Reset state
      useLearnStore.getState().setAutoRefreshing(false);
      
      mockGenerateLearnProposals.mockRestore();
    });

    it('should clear old suggestions before generating new ones', async () => {
      // Reset mocks
      vi.clearAllMocks();
      
      const mockGenerateLearnProposals = vi.spyOn(learnApi, 'generateLearnProposals');
      mockGenerateLearnProposals.mockResolvedValue({
        outlines: [
          {
            id: 'new-outline',
            courseId: 'new-course',
            title: 'New Course',
            whySuggested: 'New reason',
            questions: [],
            moduleSummary: [],
            sourceChatIds: [],
            suggestKind: 'explore',
            status: 'suggested',
            createdAt: new Date().toISOString()
          }
        ]
      });
      
      // Add an old suggested outline
      await act(async () => {
        await useLearnStore.getState().addOutline({
          id: 'old-outline',
          courseId: 'old-course',
          title: 'Old Course',
          whySuggested: 'Old reason',
          questions: [],
          moduleSummary: [],
          sourceChatIds: [],
          suggestKind: 'explore',
          status: 'suggested',
          createdAt: new Date().toISOString()
        });
      });
      
      // Verify old outline exists
      let learnStore = useLearnStore.getState();
      expect(learnStore.outlines['old-outline']).toBeDefined();
      
      // Create conversation with messages
      await act(async () => {
        const convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(convId, {
          role: 'user',
          content: 'Test message'
        });
      });
      
      // Trigger auto-refresh
      await act(async () => {
        await autoRefreshSuggestedFeed();
      });
      
      // Old outline should be cleared
      learnStore = useLearnStore.getState();
      expect(learnStore.outlines['old-outline']).toBeUndefined();
      
      // New outline should exist
      expect(learnStore.outlines['new-outline']).toBeDefined();
      
      mockGenerateLearnProposals.mockRestore();
    });
  });

  describe('Integration with chat operations', () => {
    it('should use gemini-2.5-flash model for auto-refresh', async () => {
      vi.clearAllMocks();
      
      const mockGenerateLearnProposals = vi.spyOn(learnApi, 'generateLearnProposals');
      mockGenerateLearnProposals.mockResolvedValue({ outlines: [] });
      
      // Create conversation with messages
      await act(async () => {
        const convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(convId, {
          role: 'user',
          content: 'Test message'
        });
      });
      
      // Trigger auto-refresh
      await act(async () => {
        await autoRefreshSuggestedFeed();
      });
      
      // Verify the model used
      expect(mockGenerateLearnProposals).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-2.5-flash'
        })
      );
      
      mockGenerateLearnProposals.mockRestore();
    });

    it('should handle errors gracefully without throwing', async () => {
      vi.clearAllMocks();
      
      const mockGenerateLearnProposals = vi.spyOn(learnApi, 'generateLearnProposals');
      mockGenerateLearnProposals.mockRejectedValue(new Error('API Error'));
      
      // Create conversation with messages
      await act(async () => {
        const convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(convId, {
          role: 'user',
          content: 'Test message'
        });
      });
      
      // Trigger auto-refresh - should not throw
      await act(async () => {
        await expect(autoRefreshSuggestedFeed()).resolves.not.toThrow();
      });
      
      // isAutoRefreshing should be reset to false
      const learnStore = useLearnStore.getState();
      expect(learnStore.isAutoRefreshing).toBe(false);
      
      mockGenerateLearnProposals.mockRestore();
    });
  });

  describe('Multiple conversations handling', () => {
    it('should process all conversations with messages', async () => {
      vi.clearAllMocks();
      
      const mockGenerateLearnProposals = vi.spyOn(learnApi, 'generateLearnProposals');
      mockGenerateLearnProposals.mockResolvedValue({ outlines: [] });
      
      // Create multiple conversations with messages
      await act(async () => {
        const conv1 = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(conv1, {
          role: 'user',
          content: 'Unique Message 1 xyz123'
        });
        
        const conv2 = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(conv2, {
          role: 'user',
          content: 'Unique Message 2 xyz456'
        });
        
        // Empty conversation - should be filtered out
        await useChatStore.getState().createConversation();
      });
      
      // Trigger auto-refresh
      await act(async () => {
        await autoRefreshSuggestedFeed();
      });
      
      // Verify conversations passed to API contain our unique messages
      expect(mockGenerateLearnProposals).toHaveBeenCalled();
      
      const call = mockGenerateLearnProposals.mock.calls[0][0];
      const conversationsWithMessages = call.conversations.filter(c => c.messages.length > 0);
      
      // Should have at least our 2 conversations with messages
      expect(conversationsWithMessages.length).toBeGreaterThanOrEqual(2);
      
      // Verify our specific messages are included
      const allMessages = conversationsWithMessages.flatMap(c => c.messages);
      expect(allMessages.some(m => m.content.includes('Unique Message 1 xyz123'))).toBe(true);
      expect(allMessages.some(m => m.content.includes('Unique Message 2 xyz456'))).toBe(true);
      
      mockGenerateLearnProposals.mockRestore();
    });
  });
});

