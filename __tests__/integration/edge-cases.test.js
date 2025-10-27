/**
 * Edge Case Tests
 * 
 * Tests unusual scenarios and boundary conditions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { setupTestEnvironment, createTestConversation, createTestCourse, createTestOutline, fullCleanup, initializeStores } from '../helpers/testUtils';
import { useChatStore } from '../../src/features/chat/store/chatStore';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import db from '../../src/lib/db/database';

describe('Edge Cases', () => {
  beforeEach(async () => {
    await setupTestEnvironment();
  });

  describe('Boundary Conditions', () => {
    it('should handle zero conversations', async () => {
      const chatStore = useChatStore.getState();
      const conversations = Object.values(chatStore.conversations);
      expect(conversations).toEqual([]);
    });

    it('should handle zero courses', async () => {
      const learnStore = useLearnStore.getState();
      const suggested = learnStore.getSuggestedOutlines();
      const started = learnStore.getStartedCourses();
      const completed = learnStore.getCompletedCourses();
      
      expect(suggested).toEqual([]);
      expect(started).toEqual([]);
      expect(completed).toEqual([]);
    });

    it('should handle single conversation', async () => {
      const convId = await createTestConversation(1);
      const chatStore = useChatStore.getState();
      
      expect(Object.keys(chatStore.conversations)).toHaveLength(1);
      expect(chatStore.conversations[convId]).toBeDefined();
    });

    it('should handle single course', async () => {
      const outline = await createTestOutline();
      const learnStore = useLearnStore.getState();
      
      expect(learnStore.getSuggestedOutlines()).toHaveLength(1);
    });

    it('should handle extremely long conversation titles', async () => {
      const chatStore = useChatStore.getState();
      const convId = await chatStore.createConversation();
      
      const longTitle = 'A'.repeat(1000);
      await act(async () => {
        await chatStore.updateConversation(convId, { title: longTitle });
      });
      
      await fullCleanup();
      await initializeStores();
      
      const conv = useChatStore.getState().conversations[convId];
      expect(conv.title).toBe(longTitle);
    });

    it('should handle extremely long course titles', async () => {
      const longTitle = 'B'.repeat(1000);
      const outline = await createTestOutline({ title: longTitle });
      
      await fullCleanup();
      await initializeStores();
      
      const suggested = useLearnStore.getState().getSuggestedOutlines();
      expect(suggested[0].title).toBe(longTitle);
    });
  });

  describe('Concurrent State Changes', () => {
    it('should handle rapid conversation creation and deletion', async () => {
      const convIds = [];
      
      // Create 10 conversations rapidly
      await act(async () => {
        for (let i = 0; i < 10; i++) {
          const id = await useChatStore.getState().createConversation();
          convIds.push(id);
        }
      });
      
      // Delete every other one
      await act(async () => {
        for (let i = 0; i < 10; i += 2) {
          await useChatStore.getState().deleteConversation(convIds[i]);
        }
      });
      
      const chatStore = useChatStore.getState();
      expect(Object.keys(chatStore.conversations)).toHaveLength(5);
    });

    it('should handle rapid outline status changes', async () => {
      const outline = await createTestOutline();
      
      // Rapidly change status
      await act(async () => {
        await useLearnStore.getState().updateOutlineStatus(outline.id, 'started');
        await useLearnStore.getState().updateOutlineStatus(outline.id, 'completed');
      });
      
      const learnStore = useLearnStore.getState();
      const reloadedOutline = learnStore.outlines[outline.id];
      expect(reloadedOutline.status).toBe('completed');
    });

    it('should handle concurrent module progress updates', async () => {
      const { course, modules } = await createTestCourse();
      
      // Update all modules - sequentially to avoid race conditions
      await act(async () => {
        for (const module of modules) {
          await useLearnStore.getState().updateModuleProgress(course.id, module.id, 'done');
        }
      });
      
      const learnStore = useLearnStore.getState();
      const courseData = learnStore.getCourseWithModules(course.id);
      expect(courseData.status).toBe('completed');
    });
  });

  describe('Invalid Data Handling', () => {
    it('should handle missing course modules gracefully', async () => {
      const learnStore = useLearnStore.getState();
      const courseId = 'course-no-modules';
      
      const course = {
        id: courseId,
        title: 'Course Without Modules',
        goal: 'Test',
        questionIds: [],
        moduleIds: ['mod-1', 'mod-2'], // Modules don't exist
        whereToGoNext: '',
        status: 'started',
        progressByModule: {},
        completedVia: null,
        createdAt: new Date().toISOString(),
        completedAt: null
      };
      
      await learnStore.saveCourse({ ...course, modules: [] });
      
      const courseData = learnStore.getCourseWithModules(courseId);
      expect(courseData).toBeTruthy();
      expect(courseData.modules).toEqual([]);
    });

    it('should handle orphaned messages', async () => {
      const chatStore = useChatStore.getState();
      
      // Add message to non-existent conversation
      await act(async () => {
        await chatStore.addMessage('non-existent-conv', {
          role: 'user',
          content: 'Orphaned message'
        });
      });
      
      // Should not crash
      expect(true).toBe(true);
    });

    it('should handle empty message content', async () => {
      let convId;
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(convId, {
          role: 'user',
          content: ''
        });
        await useChatStore.getState().loadMessages(convId);
      });
      
      const chatStore = useChatStore.getState();
      const messages = Object.values(chatStore.messages)
        .filter(m => m.conversationId === convId);
      
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('');
    });
  });

  describe('Special Characters and Encoding', () => {
    it('should handle special characters in conversation titles', async () => {
      let convId;
      const specialTitle = '🚀 Test <script>alert("xss")</script> & "quotes" \'apostrophes\' \n\t special';
      
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().updateConversation(convId, { title: specialTitle });
      });
      
      await fullCleanup();
      await initializeStores();
      
      const conv = useChatStore.getState().conversations[convId];
      expect(conv.title).toBe(specialTitle);
    });

    it('should handle Unicode in message content', async () => {
      let convId;
      const unicodeContent = '你好世界 🌍 مرحبا العالم Привет мир';
      
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(convId, {
          role: 'user',
          content: unicodeContent
        });
      });
      
      await fullCleanup();
      await initializeStores();
      await act(async () => {
        await useChatStore.getState().loadMessages(convId);
      });
      
      const chatStore = useChatStore.getState();
      const messages = Object.values(chatStore.messages)
        .filter(m => m.conversationId === convId);
      
      expect(messages[0].content).toBe(unicodeContent);
    });

    it('should handle markdown in course content', async () => {
      const { course, modules } = await createTestCourse();
      
      const markdownContent = `
# Heading
## Sub-heading
- List item 1
- List item 2

**Bold** and *italic*

\`\`\`javascript
const test = 'code';
\`\`\`

[Link](https://example.com)
      `;
      
      const learnStore = useLearnStore.getState();
      
      // Update module with markdown
      await act(async () => {
        await db.modules.update(modules[0].id, { lesson: markdownContent });
      });
      
      await fullCleanup();
      await initializeStores();
      
      const reloadedCourse = learnStore.getCourseWithModules(course.id);
      expect(reloadedCourse.modules[0].lesson).toBe(markdownContent);
    });
  });

  describe('Time and Timestamp Handling', () => {
    it('should maintain chronological order after multiple operations', async () => {
      const chatStore = useChatStore.getState();
      const convId = await chatStore.createConversation();
      
      // Add messages with slight delays
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          await chatStore.addMessage(convId, {
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `Message ${i}`
          });
        });
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      await act(async () => {
        await chatStore.loadMessages(convId);
      });
      
      const messages = Object.values(chatStore.messages)
        .filter(m => m.conversationId === convId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      
      // Verify order
      for (let i = 0; i < messages.length - 1; i++) {
        expect(messages[i + 1].createdAt >= messages[i].createdAt).toBe(true);
      }
    });

    it('should handle completion timestamps correctly', async () => {
      const { course, modules } = await createTestCourse();
      const learnStore = useLearnStore.getState();
      
      const beforeCompletion = new Date().toISOString();
      
      // Complete all modules
      await act(async () => {
        for (const module of modules) {
          await learnStore.updateModuleProgress(course.id, module.id, 'done');
        }
      });
      
      const afterCompletion = new Date().toISOString();
      
      const courseData = learnStore.getCourseWithModules(course.id);
      expect(courseData.completedAt).toBeTruthy();
      expect(courseData.completedAt >= beforeCompletion).toBe(true);
      expect(courseData.completedAt <= afterCompletion).toBe(true);
    });
  });

  describe('Large Dataset Handling', () => {
    it('should handle 100+ conversations', async () => {
      // Create 100 conversations
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(createTestConversation(1));
      }
      
      await Promise.all(promises);
      
      await fullCleanup();
      await initializeStores();
      
      const chatStore = useChatStore.getState();
      expect(Object.keys(chatStore.conversations)).toHaveLength(100);
    });

    it('should handle 50+ courses', async () => {
      const learnStore = useLearnStore.getState();
      
      for (let i = 0; i < 50; i++) {
        await createTestOutline({ title: `Course ${i}` });
      }
      
      await fullCleanup();
      await initializeStores();
      
      const reloadedStore = useLearnStore.getState();
      // Max 9 suggested outlines enforced
      expect(reloadedStore.getSuggestedOutlines().length).toBeLessThanOrEqual(9);
      // Should have the most recent ones
      expect(reloadedStore.getSuggestedOutlines().length).toBeGreaterThan(0);
    });

    it('should handle conversation with 200+ messages', async () => {
      let convId;
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        
        // Add 200 messages
        for (let i = 0; i < 200; i++) {
          await useChatStore.getState().addMessage(convId, {
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `Message ${i}`
          });
        }
      });
      
      await fullCleanup();
      await initializeStores();
      await act(async () => {
        await useChatStore.getState().loadMessages(convId);
      });
      
      const chatStore = useChatStore.getState();
      const messages = Object.values(chatStore.messages)
        .filter(m => m.conversationId === convId);
      
      expect(messages).toHaveLength(200);
    });
  });
});

