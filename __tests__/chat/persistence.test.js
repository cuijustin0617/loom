/**
 * Chat Mode Persistence Tests
 * 
 * Tests that conversations and messages persist correctly
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { setupTestEnvironment, createTestConversation, fullCleanup, initializeStores, generateId, now } from '../helpers/testUtils';
import { useChatStore } from '../../src/features/chat/store/chatStore';
import db from '../../src/lib/db/database';

describe('Chat Mode: Persistence', () => {
  beforeEach(async () => {
    await setupTestEnvironment();
  });

  describe('Conversations Persistence', () => {
    it('should persist conversation in IndexedDB', async () => {
      const conversationId = await createTestConversation(0);
      
      const dbConversations = await db.conversations.toArray();
      expect(dbConversations).toHaveLength(1);
      expect(dbConversations[0].id).toBe(conversationId);
    });

    it('should load conversations from IndexedDB on init', async () => {
      const convId1 = await createTestConversation(2);
      const convId2 = await createTestConversation(2);
      
      // Clear store
      useChatStore.setState({ conversations: {}, messages: {} });
      
      // Reload
      await act(async () => {
        await useChatStore.getState().loadConversations();
      });
      
      const conversations = Object.values(useChatStore.getState().conversations);
      expect(conversations).toHaveLength(2);
      expect(conversations.map(c => c.id).sort()).toEqual([convId1, convId2].sort());
    });

    it('should persist conversation after reload', async () => {
      const convId = await createTestConversation(3);
      
      await fullCleanup();
      await initializeStores();
      
      const conversations = Object.values(useChatStore.getState().conversations);
      expect(conversations).toHaveLength(1);
      expect(conversations[0].id).toBe(convId);
    });

    it('should persist conversation metadata', async () => {
      const store = useChatStore.getState();
      const convId = await store.createConversation({ model: 'gemini-2.5-flash-lite' });
      
      await store.updateConversation(convId, {
        title: 'Important Discussion',
        summary: 'This is about testing',
        summaryMessageCount: 5
      });
      
      await fullCleanup();
      await initializeStores();
      
      const conv = useChatStore.getState().conversations[convId];
      expect(conv.title).toBe('Important Discussion');
      expect(conv.summary).toBe('This is about testing');
      expect(conv.summaryMessageCount).toBe(5);
    });

    it('should survive multiple reload cycles', async () => {
      const convId = await createTestConversation(2);
      
      for (let i = 0; i < 5; i++) {
        await fullCleanup();
        await initializeStores();
        
        const conversations = Object.values(useChatStore.getState().conversations);
        expect(conversations).toHaveLength(1);
        expect(conversations[0].id).toBe(convId);
      }
    });
  });

  describe('Messages Persistence', () => {
    it('should persist messages in IndexedDB', async () => {
      const convId = await createTestConversation(3);
      
      const dbMessages = await db.messages.where('conversationId').equals(convId).toArray();
      expect(dbMessages).toHaveLength(3);
    });

    it('should load messages from IndexedDB on init', async () => {
      const convId = await createTestConversation(4);
      
      // Clear store
      useChatStore.setState({ conversations: {}, messages: {} });
      
      // Reload
      await act(async () => {
        await useChatStore.getState().loadConversations();
        await useChatStore.getState().loadMessages(convId);
      });
      
      const messages = Object.values(useChatStore.getState().messages)
        .filter(m => m.conversationId === convId);
      expect(messages).toHaveLength(4);
    });

    it('should persist messages after reload', async () => {
      const convId = await createTestConversation(5);
      
      await fullCleanup();
      await initializeStores();
      
      // Load messages for conversation
      await act(async () => {
        await useChatStore.getState().loadMessages(convId);
      });
      
      const messages = Object.values(useChatStore.getState().messages)
        .filter(m => m.conversationId === convId);
      expect(messages).toHaveLength(5);
    });

    it('should persist message content and metadata', async () => {
      const store = useChatStore.getState();
      const convId = await store.createConversation();
      
      await act(async () => {
        await store.addMessage(convId, {
          role: 'user',
          content: 'Test message with important content',
          attachments: [{ name: 'test.pdf', mimeType: 'application/pdf', base64: 'abc123' }]
        });
      });
      
      await fullCleanup();
      await initializeStores();
      await act(async () => {
        await store.loadMessages(convId);
      });
      
      const messages = Object.values(useChatStore.getState().messages)
        .filter(m => m.conversationId === convId);
      
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Test message with important content');
      expect(messages[0].role).toBe('user');
      expect(messages[0].attachments).toHaveLength(1);
      expect(messages[0].attachments[0].name).toBe('test.pdf');
    });

    it('should persist attachments correctly', async () => {
      const store = useChatStore.getState();
      const convId = await store.createConversation();
      
      const attachment = {
        name: 'image.png',
        mimeType: 'image/png',
        size: 1024,
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      };
      
      await act(async () => {
        await store.addMessage(convId, {
          role: 'user',
          content: 'Check this image',
          attachments: [attachment]
        });
      });
      
      await fullCleanup();
      await initializeStores();
      await act(async () => {
        await store.loadMessages(convId);
      });
      
      const messages = Object.values(useChatStore.getState().messages)
        .filter(m => m.conversationId === convId);
      
      expect(messages[0].attachments[0]).toEqual(attachment);
    });
  });

  describe('Conversation Deletion', () => {
    it('should delete conversation from IndexedDB', async () => {
      const convId = await createTestConversation(2);
      
      await act(async () => {
        await useChatStore.getState().deleteConversation(convId);
      });
      
      const dbConversations = await db.conversations.toArray();
      expect(dbConversations).toHaveLength(0);
    });

    it('should delete all messages when deleting conversation', async () => {
      const convId = await createTestConversation(5);
      
      // Verify messages exist
      let dbMessages = await db.messages.where('conversationId').equals(convId).toArray();
      expect(dbMessages).toHaveLength(5);
      
      // Delete conversation
      await act(async () => {
        await useChatStore.getState().deleteConversation(convId);
      });
      
      // Messages should be gone
      dbMessages = await db.messages.where('conversationId').equals(convId).toArray();
      expect(dbMessages).toHaveLength(0);
    });

    it('should persist deletion after reload', async () => {
      const convId = await createTestConversation(3);
      
      await act(async () => {
        await useChatStore.getState().deleteConversation(convId);
      });
      
      await fullCleanup();
      await initializeStores();
      
      const conversations = Object.values(useChatStore.getState().conversations);
      expect(conversations).toHaveLength(0);
    });

    it('should not affect other conversations when deleting one', async () => {
      const convId1 = await createTestConversation(2);
      const convId2 = await createTestConversation(2);
      
      await act(async () => {
        await useChatStore.getState().deleteConversation(convId1);
      });
      
      const conversations = Object.values(useChatStore.getState().conversations);
      expect(conversations).toHaveLength(1);
      expect(conversations[0].id).toBe(convId2);
      
      // Messages from conv2 should still exist
      const messages = Object.values(useChatStore.getState().messages)
        .filter(m => m.conversationId === convId2);
      expect(messages).toHaveLength(2);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple conversations created simultaneously', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(createTestConversation(2));
      }
      
      const convIds = await Promise.all(promises);
      
      const conversations = Object.values(useChatStore.getState().conversations);
      expect(conversations).toHaveLength(10);
      
      // All should persist
      await fullCleanup();
      await initializeStores();
      
      const reloadedConversations = Object.values(useChatStore.getState().conversations);
      expect(reloadedConversations).toHaveLength(10);
    });

    it('should handle rapid message additions', async () => {
      let convId;
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
      });
      
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          useChatStore.getState().addMessage(convId, {
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `Message ${i}`
          })
        );
      }
      
      await Promise.all(promises);
      
      await act(async () => {
        await useChatStore.getState().loadMessages(convId);
      });
      
      const store = useChatStore.getState();
      const messages = Object.values(store.messages)
        .filter(m => m.conversationId === convId);
      expect(messages).toHaveLength(20);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty conversations', async () => {
      const store = useChatStore.getState();
      const convId = await store.createConversation();
      
      await fullCleanup();
      await initializeStores();
      
      const conversations = Object.values(useChatStore.getState().conversations);
      expect(conversations).toHaveLength(1);
      expect(conversations[0].id).toBe(convId);
    });

    it('should handle large message content', async () => {
      let convId;
      const largeContent = 'A'.repeat(50000); // 50KB
      
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(convId, {
          role: 'assistant',
          content: largeContent
        });
      });
      
      await fullCleanup();
      await initializeStores();
      await act(async () => {
        await useChatStore.getState().loadMessages(convId);
      });
      
      const store = useChatStore.getState();
      const messages = Object.values(store.messages)
        .filter(m => m.conversationId === convId);
      
      expect(messages[0].content).toBe(largeContent);
    });

    it('should handle conversation with many messages', async () => {
      let convId;
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        
        // Add 100 messages
        for (let i = 0; i < 100; i++) {
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
      
      const store = useChatStore.getState();
      const messages = Object.values(store.messages)
        .filter(m => m.conversationId === convId);
      expect(messages).toHaveLength(100);
    });
  });

  describe('Summary Persistence', () => {
    it('should persist conversation summary', async () => {
      let convId;
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().updateConversation(convId, {
          summary: 'This conversation covers testing strategies',
          summaryMessageCount: 10
        });
      });
      
      await fullCleanup();
      await initializeStores();
      
      const store = useChatStore.getState();
      const conv = store.conversations[convId];
      expect(conv.summary).toBe('This conversation covers testing strategies');
      expect(conv.summaryMessageCount).toBe(10);
    });

    it('should update summary without losing messages', async () => {
      const convId = await createTestConversation(5);
      
      await act(async () => {
        await useChatStore.getState().updateConversation(convId, {
          summary: 'Updated summary',
          summaryMessageCount: 5
        });
        await useChatStore.getState().loadMessages(convId);
      });
      
      const store = useChatStore.getState();
      const messages = Object.values(store.messages)
        .filter(m => m.conversationId === convId);
      expect(messages).toHaveLength(5);
      
      const conv = store.conversations[convId];
      expect(conv.summary).toBe('Updated summary');
    });
  });
});

