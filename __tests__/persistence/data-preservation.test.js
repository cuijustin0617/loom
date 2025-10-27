import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useChatStore } from '../../src/features/chat/store/chatStore';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { fullCleanup, initializeStores, createTestCourse } from '../helpers/testUtils';

describe('Data Preservation: Nothing Disappears Without User Action', () => {
  beforeEach(async () => {
    await fullCleanup();
    await initializeStores();
  });

  describe('Chat Data Preservation', () => {
    it('should never delete conversations without explicit user action', async () => {
      const convIds = [];
      
      // Create multiple conversations
      await act(async () => {
        for (let i = 0; i < 5; i++) {
          const convId = await useChatStore.getState().createConversation();
          convIds.push(convId);
          await useChatStore.getState().addMessage(convId, {
            role: 'user',
            content: `Message ${i}`
          });
        }
      });

      // Perform various operations that should NOT delete conversations
      await act(async () => {
        // Create another conversation
        await useChatStore.getState().createConversation();
        
        // Add messages to existing conversation
        await useChatStore.getState().addMessage(convIds[0], {
          role: 'assistant',
          content: 'Response'
        });
        
        // Load conversations again
        await useChatStore.getState().loadConversations();
        await useChatStore.getState().loadAllMessages();
      });

      // Original conversations should still exist
      const chatStore = useChatStore.getState();
      for (const convId of convIds) {
        expect(chatStore.conversations[convId]).toBeDefined();
        expect(chatStore.conversations[convId].id).toBe(convId);
      }
    });

    it('should preserve messages across all operations', async () => {
      let convId, messageIds;
      
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        messageIds = [
          await useChatStore.getState().addMessage(convId, { role: 'user', content: 'Q1' }),
          await useChatStore.getState().addMessage(convId, { role: 'assistant', content: 'A1' }),
          await useChatStore.getState().addMessage(convId, { role: 'user', content: 'Q2' }),
        ];
      });

      // Perform operations
      await act(async () => {
        // Create other conversations
        await useChatStore.getState().createConversation();
        await useChatStore.getState().createConversation();
        
        // Reload data
        await useChatStore.getState().loadConversations();
        await useChatStore.getState().loadAllMessages();
      });

      // All original messages should exist
      const chatStore = useChatStore.getState();
      for (const msgId of messageIds) {
        expect(chatStore.messages[msgId]).toBeDefined();
        expect(chatStore.messages[msgId].conversationId).toBe(convId);
      }
    });

    it('should persist chats across app restarts', async () => {
      const chatData = [];
      
      // Create chats
      await act(async () => {
        for (let i = 0; i < 3; i++) {
          const convId = await useChatStore.getState().createConversation();
          const msgId = await useChatStore.getState().addMessage(convId, {
            role: 'user',
            content: `Persistent chat ${i}`
          });
          chatData.push({ convId, msgId });
        }
      });

      // Simulate app restart
      await act(async () => {
        await fullCleanup();
        await initializeStores();
      });

      // All chats should be restored
      const chatStore = useChatStore.getState();
      for (const { convId, msgId } of chatData) {
        expect(chatStore.conversations[convId]).toBeDefined();
        expect(chatStore.messages[msgId]).toBeDefined();
      }
    });

    it('should only delete conversation when user explicitly deletes it', async () => {
      let conv1, conv2, conv3;
      
      await act(async () => {
        conv1 = await useChatStore.getState().createConversation();
        conv2 = await useChatStore.getState().createConversation();
        conv3 = await useChatStore.getState().createConversation();
        
        // Add messages to all
        await useChatStore.getState().addMessage(conv1, { role: 'user', content: 'Test 1' });
        await useChatStore.getState().addMessage(conv2, { role: 'user', content: 'Test 2' });
        await useChatStore.getState().addMessage(conv3, { role: 'user', content: 'Test 3' });
      });

      // Explicitly delete conv2
      await act(async () => {
        await useChatStore.getState().deleteConversation(conv2);
      });

      const chatStore = useChatStore.getState();
      
      // Conv1 and Conv3 should exist
      expect(chatStore.conversations[conv1]).toBeDefined();
      expect(chatStore.conversations[conv3]).toBeDefined();
      
      // Conv2 should be deleted
      expect(chatStore.conversations[conv2]).toBeUndefined();
    });
  });

  describe('Learn Data Preservation', () => {
    it('should never delete completed courses without user action', async () => {
      const courses = [];
      
      // Create completed courses
      await act(async () => {
        for (let i = 0; i < 3; i++) {
          const { course } = await createTestCourse({
            status: 'completed',
            title: `Completed Course ${i}`
          });
          courses.push(course.id);
        }
      });

      // Perform operations that should NOT delete completed courses
      await act(async () => {
        // Add new courses
        await createTestCourse({ status: 'started', title: 'New Started' });
        await createTestCourse({ status: 'suggested', title: 'New Suggested' });
        
        // Add new goal
        await useLearnStore.getState().addGoal('New Goal', 'Description');
        
        // Cleanup old suggested (should not affect completed)
        await useLearnStore.getState().cleanupOldSuggestedOutlines();
      });

      // All completed courses should still exist
      const learnStore = useLearnStore.getState();
      for (const courseId of courses) {
        expect(learnStore.courses[courseId]).toBeDefined();
        expect(learnStore.courses[courseId].status).toBe('completed');
      }
    });

    it('should never delete started courses without user action', async () => {
      const courses = [];
      
      await act(async () => {
        for (let i = 0; i < 3; i++) {
          const { course } = await createTestCourse({
            status: 'started',
            title: `Started Course ${i}`
          });
          courses.push(course.id);
        }
      });

      // Perform various operations
      await act(async () => {
        await createTestCourse({ status: 'completed', title: 'New Completed' });
        await useLearnStore.getState().addGoal('Another Goal', 'Test');
        await useLearnStore.getState().cleanupOldSuggestedOutlines();
      });

      // All started courses should still exist
      const learnStore = useLearnStore.getState();
      for (const courseId of courses) {
        expect(learnStore.courses[courseId]).toBeDefined();
        expect(learnStore.courses[courseId].status).toBe('started');
      }
    });

    it('should preserve course progress across operations', async () => {
      const { course, modules } = await createTestCourse({ status: 'started' });
      
      // Make progress
      await act(async () => {
        await useLearnStore.getState().updateModuleProgress(course.id, modules[0].id, 'done');
      });

      const progressBefore = useLearnStore.getState().courses[course.id].progressByModule;

      // Perform operations
      await act(async () => {
        await createTestCourse({ status: 'started', title: 'Another Course' });
        await useLearnStore.getState().addGoal(`Test Goal ${Date.now()}`, 'Desc');
      });

      // Progress should be preserved
      const progressAfter = useLearnStore.getState().courses[course.id].progressByModule;
      expect(progressAfter[modules[0].id]).toBe('done');
      expect(progressAfter[modules[0].id]).toBe(progressBefore[modules[0].id]);
    });

    it('should only cleanup old SUGGESTED outlines, not started/completed', async () => {
      const testData = {
        suggested: [],
        started: [],
        completed: []
      };
      
      const uniqueGoal = `Test Goal ${Date.now()}`;
      
      await act(async () => {
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        // Add 12 suggested outlines (should cleanup to 9)
        for (let i = 0; i < 12; i++) {
          const outline = {
            title: `Suggested ${i}`,
            goal: uniqueGoal,
            modules: [],
            whereToGoNext: '',
            status: 'suggested',
            createdAt: new Date(Date.now() + i * 1000).toISOString()
          };
          await useLearnStore.getState().addOutline(outline);
        }
        
        // Add started courses
        for (let i = 0; i < 3; i++) {
          const { course } = await createTestCourse({
            status: 'started',
            title: `Started ${i}`
          });
          testData.started.push(course.id);
        }
        
        // Add completed courses
        for (let i = 0; i < 3; i++) {
          const { course } = await createTestCourse({
            status: 'completed',
            title: `Completed ${i}`
          });
          testData.completed.push(course.id);
        }
        
        // Run cleanup
        await useLearnStore.getState().cleanupOldSuggestedOutlines();
      });

      const learnStore = useLearnStore.getState();
      
      // Suggested should be limited to 9
      const suggested = learnStore.getSuggestedOutlines();
      expect(suggested.length).toBeLessThanOrEqual(9);
      
      // All started courses should exist
      for (const courseId of testData.started) {
        expect(learnStore.courses[courseId]).toBeDefined();
        expect(learnStore.courses[courseId].status).toBe('started');
      }
      
      // All completed courses should exist
      for (const courseId of testData.completed) {
        expect(learnStore.courses[courseId]).toBeDefined();
        expect(learnStore.courses[courseId].status).toBe('completed');
      }
    });

    it('should persist learn data across app restarts', async () => {
      const testData = {
        completed: [],
        started: [],
        goals: []
      };
      
      await act(async () => {
        // Create goals
        await useLearnStore.getState().addGoal('Goal 1', 'Desc 1');
        await useLearnStore.getState().addGoal('Goal 2', 'Desc 2');
        
        // Create courses
        const c1 = await createTestCourse({ status: 'completed', title: 'Persist Completed' });
        const c2 = await createTestCourse({ status: 'started', title: 'Persist Started' });
        
        testData.completed.push(c1.course.id);
        testData.started.push(c2.course.id);
      });

      // Simulate app restart
      await act(async () => {
        await fullCleanup();
        await initializeStores();
      });

      const learnStore = useLearnStore.getState();
      
      // Goals should be restored
      const goals = Object.values(learnStore.goals);
      expect(goals.length).toBeGreaterThanOrEqual(2);
      
      // Courses should be restored
      for (const courseId of testData.completed) {
        expect(learnStore.courses[courseId]).toBeDefined();
        expect(learnStore.courses[courseId].status).toBe('completed');
      }
      
      for (const courseId of testData.started) {
        expect(learnStore.courses[courseId]).toBeDefined();
        expect(learnStore.courses[courseId].status).toBe('started');
      }
    });

    it('should only dismiss outlines when user explicitly dismisses', async () => {
      // Clear existing outlines first
      await act(async () => {
        await useLearnStore.getState().clearSuggestedOutlines();
      });
      
      const uniqueGoal = `Test Goal ${Date.now()}`;
      let outlineToDismiss;
      const outlineIds = [];
      
      await act(async () => {
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        // Add 3 suggested outlines with unique timestamps far in future
        const baseTime = Date.now() + 1000000;
        for (let i = 0; i < 3; i++) {
          const outline = {
            title: `DismissTest_${uniqueGoal}_${i}`,
            goal: uniqueGoal,
            modules: [],
            whereToGoNext: '',
            status: 'suggested',
            createdAt: new Date(baseTime + i * 1000).toISOString()
          };
          await useLearnStore.getState().addOutline(outline);
        }
      });

      // Get one outline to dismiss
      const suggested = useLearnStore.getState().getSuggestedOutlines();
      const ourOutlines = suggested.filter(o => o.title.includes(`DismissTest_${uniqueGoal}`));
      expect(ourOutlines.length).toBe(3);
      outlineToDismiss = ourOutlines[0].id;
      
      // Explicitly dismiss one outline
      await act(async () => {
        await useLearnStore.getState().updateOutlineStatus(outlineToDismiss, 'dismissed');
      });

      const learnStore = useLearnStore.getState();
      const suggestedAfter = learnStore.getSuggestedOutlines();
      
      // Dismissed outline should not be in suggested
      expect(suggestedAfter.some(o => o.id === outlineToDismiss)).toBe(false);
      
      // But it should still exist with dismissed status
      const dismissedOutline = learnStore.outlines[outlineToDismiss];
      expect(dismissedOutline).toBeDefined();
      expect(dismissedOutline.status).toBe('dismissed');
      
      // Other outlines should still be suggested
      const otherOurOutlines = suggestedAfter.filter(o => o.title.includes(`DismissTest_${uniqueGoal}`));
      expect(otherOurOutlines.length).toBeGreaterThan(0);
      for (const outline of otherOurOutlines) {
        expect(outline.status).toBe('suggested');
      }
    });
  });

  describe('Cross-Feature Data Preservation', () => {
    it('should preserve both chat and learn data simultaneously', async () => {
      const testData = {
        chats: [],
        courses: []
      };
      
      await act(async () => {
        // Create chat data
        for (let i = 0; i < 2; i++) {
          const convId = await useChatStore.getState().createConversation();
          await useChatStore.getState().addMessage(convId, {
            role: 'user',
            content: `Persist chat ${i}`
          });
          testData.chats.push(convId);
        }
        
        // Create learn data
        for (let i = 0; i < 2; i++) {
          const { course } = await createTestCourse({
            status: 'completed',
            title: `Persist course ${i}`
          });
          testData.courses.push(course.id);
        }
      });

      // Perform operations on both
      await act(async () => {
        await useChatStore.getState().createConversation();
        await createTestCourse({ status: 'started', title: 'New' });
      });

      const chatStore = useChatStore.getState();
      const learnStore = useLearnStore.getState();
      
      // Both should be preserved
      for (const convId of testData.chats) {
        expect(chatStore.conversations[convId]).toBeDefined();
      }
      
      for (const courseId of testData.courses) {
        expect(learnStore.courses[courseId]).toBeDefined();
      }
    });

    it('should preserve data when switching between modes', async () => {
      let chatId, courseId;
      
      // User in Chat mode
      await act(async () => {
        chatId = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(chatId, {
          role: 'user',
          content: 'Chat message'
        });
      });

      // User switches to Learn mode
      await act(async () => {
        const { course } = await createTestCourse({ status: 'started' });
        courseId = course.id;
      });

      // User switches back to Chat mode
      await act(async () => {
        await useChatStore.getState().loadConversations();
        await useChatStore.getState().loadAllMessages();
      });

      // User switches back to Learn mode
      await act(async () => {
        // Just accessing Learn store
        const courses = useLearnStore.getState().getStartedCourses();
      });

      // Both should still exist
      const chatStore = useChatStore.getState();
      const learnStore = useLearnStore.getState();
      
      expect(chatStore.conversations[chatId]).toBeDefined();
      expect(learnStore.courses[courseId]).toBeDefined();
    });
  });
});

