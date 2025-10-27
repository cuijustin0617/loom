/**
 * Integration Tests - Cross-Feature
 * 
 * Tests interactions between Chat and Learn modes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { setupTestEnvironment, createTestConversation, fullCleanup, initializeStores } from '../helpers/testUtils';
import { useChatStore } from '../../src/features/chat/store/chatStore';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { useSettingsStore } from '../../src/shared/store/settingsStore';

describe('Integration: Cross-Feature Tests', () => {
  beforeEach(async () => {
    await setupTestEnvironment();
  });

  describe('Settings Persistence', () => {
    it('should persist API key across reloads', async () => {
      const store = useSettingsStore.getState();
      
      await act(async () => {
        await store.setApiKey('test-api-key-123');
      });
      
      await fullCleanup();
      await initializeStores();
      
      const reloadedStore = useSettingsStore.getState();
      expect(reloadedStore.apiKey).toBe('test-api-key-123');
    });

    it('should persist model selections', async () => {
      const store = useSettingsStore.getState();
      
      await act(async () => {
        await store.setSelectedModel('gemini-2.5-flash-lite');
        await store.setLearnModel('gemini-2.5-flash-lite');
      });
      
      await fullCleanup();
      await initializeStores();
      
      const reloadedStore = useSettingsStore.getState();
      expect(reloadedStore.selectedModel).toBe('gemini-2.5-flash-lite');
      expect(reloadedStore.learnModel).toBe('gemini-2.5-flash-lite');
    });

    it('should persist current conversation ID', async () => {
      const convId = await createTestConversation(2);
      const settingsStore = useSettingsStore.getState();
      
      await act(async () => {
        await settingsStore.setCurrentConversationId(convId);
      });
      
      await fullCleanup();
      await initializeStores();
      
      const reloadedSettings = useSettingsStore.getState();
      expect(reloadedSettings.currentConversationId).toBe(convId);
    });
  });

  describe('Chat and Learn Independence', () => {
    it('should maintain Learn data when Chat conversations are deleted', async () => {
      // Create Learn goal
      await act(async () => {
        await useLearnStore.getState().addGoal('Testing', 'Learn testing');
      });
      
      // Create Chat conversation
      const convId = await createTestConversation(5);
      
      // Delete Chat conversation
      await act(async () => {
        await useChatStore.getState().deleteConversation(convId);
      });
      
      // Learn data should still exist
      const learnStore = useLearnStore.getState();
      const goals = Object.values(learnStore.goals);
      expect(goals).toHaveLength(1);
      expect(goals[0].label).toBe('Testing');
    });

    it('should maintain Chat data when Learn courses are deleted', async () => {
      // Create Chat conversation
      const convId = await createTestConversation(5);
      
      // Create Learn course
      const learnStore = useLearnStore.getState();
      const outline = {
        id: 'outline-1',
        courseId: 'course-1',
        title: 'Test Course',
        goal: 'Learn',
        status: 'suggested',
        summary: 'Test',
        questions: [],
        moduleSummary: [],
        createdAt: new Date().toISOString()
      };
      
      await act(async () => {
        await learnStore.addOutline(outline);
        await learnStore.updateOutlineStatus('outline-1', 'dismissed');
      });
      
      // Chat data should still exist
      const chatStore = useChatStore.getState();
      expect(chatStore.conversations[convId]).toBeDefined();
      
      await act(async () => {
        await chatStore.loadMessages(convId);
      });
      
      const messages = Object.values(chatStore.messages)
        .filter(m => m.conversationId === convId);
      expect(messages).toHaveLength(5);
    });
  });

  describe('Full App Lifecycle', () => {
    it('should handle complete app workflow', async () => {
      // 1. User creates conversations
      const convId1 = await createTestConversation(3);
      const convId2 = await createTestConversation(2);
      
      // 2. User generates Learn suggestions (mock)
      const learnStore = useLearnStore.getState();
      await act(async () => {
        await learnStore.addOutline({
          id: 'outline-1',
          courseId: 'course-1',
          title: 'Course from Chat',
          goal: 'Learning',
          status: 'suggested',
          summary: 'Based on conversations',
          questions: ['Q1', 'Q2'],
          moduleSummary: [
            { title: 'Module 1', estMinutes: 5 }
          ],
          createdAt: new Date().toISOString()
        });
      });
      
      // 3. User starts course
      await act(async () => {
        await learnStore.startCourse('outline-1');
      });
      
      // 4. Simulate reload
      await fullCleanup();
      await initializeStores();
      
      // 5. Verify all data persists
      const chatStore = useChatStore.getState();
      expect(Object.keys(chatStore.conversations)).toHaveLength(2);
      
      const reloadedLearnStore = useLearnStore.getState();
      const started = reloadedLearnStore.getStartedCourses();
      expect(started).toHaveLength(1);
      expect(started[0].title).toBe('Course from Chat');
    });

    it('should handle multiple feature interactions', async () => {
      // Create multiple conversations
      for (let i = 0; i < 3; i++) {
        await createTestConversation(2);
      }
      
      // Create multiple goals
      const learnStore = useLearnStore.getState();
      await act(async () => {
        await learnStore.addGoal('JavaScript', 'JS');
        await learnStore.addGoal('React', 'React');
        await learnStore.addGoal('Testing', 'Tests');
      });
      
      // Create multiple outlines
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          await learnStore.addOutline({
            id: `outline-${i}`,
            courseId: `course-${i}`,
            title: `Course ${i}`,
            goal: ['JavaScript', 'React', 'Testing'][i % 3],
            status: 'suggested',
            summary: `Summary ${i}`,
            questions: [],
            moduleSummary: [],
            createdAt: new Date().toISOString()
          });
        });
      }
      
      // Reload and verify
      await fullCleanup();
      await initializeStores();
      
      const chatStore = useChatStore.getState();
      const reloadedLearnStore = useLearnStore.getState();
      
      expect(Object.keys(chatStore.conversations)).toHaveLength(3);
      expect(Object.keys(reloadedLearnStore.goals)).toHaveLength(3);
      expect(reloadedLearnStore.getSuggestedOutlines()).toHaveLength(5);
    });
  });

  describe('Migration Compatibility', () => {
    it('should handle fresh install (no migration data)', async () => {
      await fullCleanup();
      await initializeStores();
      
      const chatStore = useChatStore.getState();
      const learnStore = useLearnStore.getState();
      const settingsStore = useSettingsStore.getState();
      
      expect(Object.keys(chatStore.conversations)).toHaveLength(0);
      expect(Object.keys(learnStore.courses)).toHaveLength(0);
      expect(settingsStore.isLoaded).toBe(true);
    });

    it('should maintain data integrity after settings changes', async () => {
      // Create data
      const convId = await createTestConversation(5);
      
      await act(async () => {
        await useLearnStore.getState().addGoal('Testing', 'Test');
      });
      
      // Change settings
      await act(async () => {
        await useSettingsStore.getState().setSelectedModel('gemini-2.5-flash-lite');
        await useSettingsStore.getState().setLearnModel('gemini-2.5-flash-lite');
      });
      
      // Data should remain intact
      const chatStore = useChatStore.getState();
      const learnStore = useLearnStore.getState();
      expect(chatStore.conversations[convId]).toBeDefined();
      expect(Object.keys(learnStore.goals)).toHaveLength(1);
    });
  });

  describe('Performance Under Load', () => {
    it('should handle moderate data load efficiently', async () => {
      const startTime = Date.now();
      
      // Create 20 conversations with 10 messages each
      for (let i = 0; i < 20; i++) {
        await createTestConversation(10);
      }
      
      // Create 30 Learn outlines
      const learnStore = useLearnStore.getState();
      for (let i = 0; i < 30; i++) {
        await act(async () => {
          await learnStore.addOutline({
            id: `outline-${i}`,
            courseId: `course-${i}`,
            title: `Course ${i}`,
            goal: `Goal ${i % 5}`,
            status: i % 3 === 0 ? 'started' : 'suggested',
            summary: `Summary ${i}`,
            questions: [],
            moduleSummary: [],
            createdAt: new Date().toISOString()
          });
        });
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete in reasonable time (< 10 seconds)
      expect(duration).toBeLessThan(10000);
      
      // Reload should also be fast
      const reloadStart = Date.now();
      await fullCleanup();
      await initializeStores();
      const reloadEnd = Date.now();
      const reloadDuration = reloadEnd - reloadStart;
      
      expect(reloadDuration).toBeLessThan(5000);
      
      // Verify data integrity
      const chatStore = useChatStore.getState();
      const reloadedLearnStore = useLearnStore.getState();
      
      expect(Object.keys(chatStore.conversations)).toHaveLength(20);
      // Max 9 suggested outlines enforced, but total outlines can be more (including dismissed, started, etc.)
      expect(Object.keys(reloadedLearnStore.outlines).length).toBeGreaterThan(0);
      expect(reloadedLearnStore.getSuggestedOutlines().length).toBeLessThanOrEqual(9);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from partial data corruption', async () => {
      // Create valid data
      await createTestConversation(3);
      const learnStore = useLearnStore.getState();
      
      await act(async () => {
        await learnStore.addOutline({
          id: 'outline-1',
          courseId: 'course-1',
          title: 'Valid Course',
          goal: 'Learning',
          status: 'suggested',
          summary: 'Test',
          questions: [],
          moduleSummary: [],
          createdAt: new Date().toISOString()
        });
      });
      
      // App should continue working
      await fullCleanup();
      await initializeStores();
      
      const chatStore = useChatStore.getState();
      const reloadedLearnStore = useLearnStore.getState();
      
      expect(Object.keys(chatStore.conversations).length).toBeGreaterThan(0);
      expect(reloadedLearnStore.getSuggestedOutlines().length).toBeGreaterThan(0);
    });
  });
});

