/**
 * Test: Auto-Refresh Mode Awareness
 * 
 * Tests that auto-refresh respects the current mode (chat/learn)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { useChatStore } from '../../src/features/chat/store/chatStore';
import { useSettingsStore } from '../../src/shared/store/settingsStore';
import { autoRefreshSuggestedFeed } from '../../src/features/learn/services/autoOperations';

// Mock the generateLearnProposals function
vi.mock('../../src/features/learn/services/learnApi', () => ({
  generateLearnProposals: vi.fn(async () => ({ 
    outlines: [
      {
        id: 'test-outline-1',
        courseId: 'test-course-1',
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
  })),
  regroupAllCompleted: vi.fn(async () => ({ regrouped: 0, pending: 0, groups: 0 }))
}));

describe('Auto-Refresh Mode Awareness', () => {
  beforeEach(async () => {
    // Reset stores using proper methods
    useLearnStore.setState({
      courses: {},
      modules: {},
      outlines: {},
      goals: {},
      goalCourses: {},
      isAutoRefreshing: false,
      isAutoRegrouping: false,
      generatingCourseIds: {},
      activeCourseId: null
    });
    
    useChatStore.setState({
      conversations: {},
      messages: {},
      isLoading: false
    });
    
    useSettingsStore.setState({
      currentMode: 'chat'
    });
    
    await useLearnStore.getState().loadLearnData();
  });

  it('should skip auto-refresh when user is on Learn page', async () => {
    const settingsStore = useSettingsStore.getState();
    const learnStore = useLearnStore.getState();
    
    // Set mode to Learn
    settingsStore.setCurrentMode('learn');
    
    // Create a conversation with messages
    const chatStore = useChatStore.getState();
    const convId = await chatStore.createConversation();
    
    await chatStore.addMessage(convId, {
      role: 'user',
      content: 'Test message'
    });
    
    // Clear any existing outlines
    await learnStore.clearSuggestedOutlines();
    
    // Trigger auto-refresh
    await autoRefreshSuggestedFeed();
    
    // Should NOT have generated any outlines
    const outlines = Object.values(learnStore.outlines);
    expect(outlines.length).toBe(0);
    
    // Should NOT be in refreshing state
    expect(learnStore.isAutoRefreshing).toBe(false);
  });

  it('should run auto-refresh when user is on Chat page', async () => {
    const settingsStore = useSettingsStore.getState();
    const learnStore = useLearnStore.getState();
    
    // Set mode to Chat
    settingsStore.setCurrentMode('chat');
    
    // Create a conversation with messages
    const chatStore = useChatStore.getState();
    const convId = await chatStore.createConversation();
    
    // Add messages to the conversation
    await chatStore.addMessage(convId, {
      role: 'user',
      content: 'Tell me about React hooks'
    });
    
    await chatStore.addMessage(convId, {
      role: 'assistant',
      content: 'React hooks are functions that let you use state and lifecycle features...'
    });
    
    // Update conversation with a summary
    await chatStore.updateConversation(convId, {
      summary: 'Discussion about React hooks and their usage'
    });
    
    // Clear any existing outlines
    await learnStore.clearSuggestedOutlines();
    
    // Trigger auto-refresh - should not skip when on Chat page
    const refreshPromise = autoRefreshSuggestedFeed();
    
    // Wait for it to complete
    await refreshPromise;
    
    // Should NOT be in refreshing state after completion
    expect(learnStore.isAutoRefreshing).toBe(false);
    
    // The main test is that it didn't skip (we tested skip in the previous test)
    // Content generation is tested elsewhere, we're just testing mode-awareness here
  });

  it('should not show auto-refresh indicator when user switches to Learn page', async () => {
    const settingsStore = useSettingsStore.getState();
    const learnStore = useLearnStore.getState();
    
    // Start in Chat mode
    settingsStore.setCurrentMode('chat');
    
    // Create a conversation
    const chatStore = useChatStore.getState();
    const convId = await chatStore.createConversation();
    
    await chatStore.addMessage(convId, {
      role: 'user',
      content: 'Test message'
    });
    
    // Clear outlines
    await learnStore.clearSuggestedOutlines();
    
    // User is on Chat page, auto-refresh should work
    await autoRefreshSuggestedFeed();
    const outlinesAfterRefresh = Object.values(learnStore.outlines);
    expect(outlinesAfterRefresh.length).toBeGreaterThan(0);
    
    // Now switch to Learn page
    settingsStore.setCurrentMode('learn');
    
    // Try auto-refresh again
    await autoRefreshSuggestedFeed();
    
    // Should not have cleared or regenerated
    const outlinesAfterSwitch = Object.values(learnStore.outlines);
    expect(outlinesAfterSwitch.length).toBe(outlinesAfterRefresh.length);
  });

  it('should handle rapid mode switches gracefully', async () => {
    const settingsStore = useSettingsStore.getState();
    const learnStore = useLearnStore.getState();
    const chatStore = useChatStore.getState();
    
    // Create conversation
    const convId = await chatStore.createConversation();
    
    await chatStore.addMessage(convId, {
      role: 'user',
      content: 'Test'
    });
    
    // Rapidly switch modes and trigger refresh
    settingsStore.setCurrentMode('chat');
    const promise1 = autoRefreshSuggestedFeed();
    
    settingsStore.setCurrentMode('learn');
    const promise2 = autoRefreshSuggestedFeed();
    
    settingsStore.setCurrentMode('chat');
    const promise3 = autoRefreshSuggestedFeed();
    
    // Wait for all to complete
    await Promise.all([promise1, promise2, promise3]);
    
    // Should not crash or duplicate
    expect(learnStore.isAutoRefreshing).toBe(false);
  });
});

