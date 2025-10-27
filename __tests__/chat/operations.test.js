/**
 * Chat Mode Operations Tests
 * 
 * Tests CRUD operations on conversations and messages
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { setupTestEnvironment, createTestConversation } from '../helpers/testUtils';
import { useChatStore } from '../../src/features/chat/store/chatStore';

describe('Chat Mode: Operations', () => {
  beforeEach(async () => {
    await setupTestEnvironment();
  });

  describe('Create Operations', () => {
    it('should create a new conversation', async () => {
      let convId;
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
      });
      
      const store = useChatStore.getState();
      expect(convId).toBeTruthy();
      expect(store.conversations[convId]).toBeDefined();
      expect(store.conversations[convId].title).toBe('New Chat');
    });

    it('should create conversation with custom model', async () => {
      let convId;
      await act(async () => {
        convId = await useChatStore.getState().createConversation({ model: 'gemini-2.5-flash-lite' });
      });
      
      const store = useChatStore.getState();
      expect(store.conversations[convId].model).toBe('gemini-2.5-flash-lite');
    });

    it('should create multiple conversations', async () => {
      let convId1, convId2, convId3;
      await act(async () => {
        convId1 = await useChatStore.getState().createConversation();
        convId2 = await useChatStore.getState().createConversation();
        convId3 = await useChatStore.getState().createConversation();
      });
      
      const store = useChatStore.getState();
      const conversations = Object.values(store.conversations);
      expect(conversations).toHaveLength(3);
      expect([convId1, convId2, convId3]).toHaveLength(3);
    });

    it('should add message to conversation', async () => {
      let convId, messageId;
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        messageId = await useChatStore.getState().addMessage(convId, {
          role: 'user',
          content: 'Hello, world!'
        });
      });
      
      const store = useChatStore.getState();
      expect(messageId).toBeTruthy();
      expect(store.messages[messageId]).toBeDefined();
      expect(store.messages[messageId].content).toBe('Hello, world!');
      expect(store.messages[messageId].role).toBe('user');
      expect(store.messages[messageId].conversationId).toBe(convId);
    });

    it('should add multiple messages to conversation', async () => {
      const convId = await createTestConversation(10);
      const store = useChatStore.getState();
      
      await act(async () => {
        await store.loadMessages(convId);
      });
      
      const messages = Object.values(store.messages)
        .filter(m => m.conversationId === convId);
      expect(messages).toHaveLength(10);
    });

    it('should maintain message order by createdAt', async () => {
      const convId = await createTestConversation(5);
      const store = useChatStore.getState();
      
      await act(async () => {
        await store.loadMessages(convId);
      });
      
      const messages = Object.values(store.messages)
        .filter(m => m.conversationId === convId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i].createdAt >= messages[i - 1].createdAt).toBe(true);
      }
    });
  });

  describe('Update Operations', () => {
    it('should update conversation title', async () => {
      let convId;
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().updateConversation(convId, { title: 'Updated Title' });
      });
      
      const store = useChatStore.getState();
      expect(store.conversations[convId].title).toBe('Updated Title');
    });

    it('should update conversation summary', async () => {
      let convId;
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().updateConversation(convId, { 
          summary: 'This is a summary',
          summaryMessageCount: 5
        });
      });
      
      const store = useChatStore.getState();
      expect(store.conversations[convId].summary).toBe('This is a summary');
      expect(store.conversations[convId].summaryMessageCount).toBe(5);
    });

    it('should update conversation updatedAt timestamp', async () => {
      let convId, originalUpdatedAt;
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
      });
      
      originalUpdatedAt = useChatStore.getState().conversations[convId].updatedAt;
      
      // Wait a tiny bit
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await act(async () => {
        await useChatStore.getState().updateConversation(convId, { title: 'New Title' });
      });
      
      const store = useChatStore.getState();
      expect(store.conversations[convId].updatedAt > originalUpdatedAt).toBe(true);
    });

    it('should update message content (streaming)', async () => {
      let convId, messageId;
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        messageId = await useChatStore.getState().addMessage(convId, {
          role: 'assistant',
          content: ''
        });
        
        useChatStore.getState().updateMessage(messageId, 'Partial');
        useChatStore.getState().updateMessage(messageId, 'Partial content');
        useChatStore.getState().updateMessage(messageId, 'Partial content complete');
      });
      
      const store = useChatStore.getState();
      expect(store.messages[messageId].content).toBe('Partial content complete');
    });

    it('should finalize streaming message', async () => {
      let convId, messageId;
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        messageId = await useChatStore.getState().addMessage(convId, {
          role: 'assistant',
          content: ''
        });
      });
      
      await act(async () => {
        useChatStore.getState().updateMessage(messageId, 'Streamed content');
        await useChatStore.getState().finalizeMessage(messageId);
      });
      
      const store = useChatStore.getState();
      // Message should be persisted with final content
      expect(store.messages[messageId].content).toBe('Streamed content');
    });
  });

  describe('Delete Operations', () => {
    it('should delete conversation', async () => {
      let convId;
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
      });
      
      let store = useChatStore.getState();
      expect(store.conversations[convId]).toBeDefined();
      
      await act(async () => {
        await useChatStore.getState().deleteConversation(convId);
      });
      
      store = useChatStore.getState();
      expect(store.conversations[convId]).toBeUndefined();
    });

    it('should delete conversation with messages', async () => {
      const convId = await createTestConversation(5);
      
      await act(async () => {
        await useChatStore.getState().loadMessages(convId);
      });
      
      let store = useChatStore.getState();
      let messages = Object.values(store.messages)
        .filter(m => m.conversationId === convId);
      expect(messages).toHaveLength(5);
      
      await act(async () => {
        await useChatStore.getState().deleteConversation(convId);
      });
      
      store = useChatStore.getState();
      expect(store.conversations[convId]).toBeUndefined();
      messages = Object.values(store.messages)
        .filter(m => m.conversationId === convId);
      expect(messages).toHaveLength(0);
    });

    it('should delete specific conversation without affecting others', async () => {
      const convId1 = await createTestConversation(2);
      const convId2 = await createTestConversation(2);
      
      await act(async () => {
        await useChatStore.getState().deleteConversation(convId1);
      });
      
      const store = useChatStore.getState();
      expect(store.conversations[convId1]).toBeUndefined();
      expect(store.conversations[convId2]).toBeDefined();
    });
  });

  describe('Prune Operations', () => {
    it('should prune empty conversations', async () => {
      // Create conversation with messages
      const convId1 = await createTestConversation(2);
      
      // Create empty conversation
      let convId2;
      await act(async () => {
        convId2 = await useChatStore.getState().createConversation();
      });
      
      // Create another conversation with messages
      const convId3 = await createTestConversation(1);
      
      let store = useChatStore.getState();
      expect(Object.keys(store.conversations)).toHaveLength(3);
      
      await act(async () => {
        await useChatStore.getState().pruneEmptyConversations();
      });
      
      store = useChatStore.getState();
      // Only conversations with messages should remain
      expect(Object.keys(store.conversations)).toHaveLength(2);
      expect(store.conversations[convId1]).toBeDefined();
      expect(store.conversations[convId2]).toBeUndefined();
      expect(store.conversations[convId3]).toBeDefined();
    });

    it('should not prune conversations with messages', async () => {
      const convId = await createTestConversation(5);
      
      await act(async () => {
        await useChatStore.getState().pruneEmptyConversations();
      });
      
      const store = useChatStore.getState();
      expect(store.conversations[convId]).toBeDefined();
    });
  });

  describe('Loading Operations', () => {
    it('should load all conversations on init', async () => {
      // Create conversations first
      await createTestConversation(1);
      await createTestConversation(1);
      await createTestConversation(1);
      
      // Clear store
      useChatStore.setState({ conversations: {}, messages: {} });
      
      // Load
      await act(async () => {
        await useChatStore.getState().loadConversations();
      });
      
      const conversations = Object.values(useChatStore.getState().conversations);
      expect(conversations).toHaveLength(3);
    });

    it('should load messages for specific conversation', async () => {
      const convId = await createTestConversation(10);
      
      // Clear messages from store
      useChatStore.setState({ messages: {} });
      
      await act(async () => {
        await useChatStore.getState().loadMessages(convId);
      });
      
      const store = useChatStore.getState();
      const messages = Object.values(store.messages)
        .filter(m => m.conversationId === convId);
      expect(messages).toHaveLength(10);
    });

    it('should load messages without affecting other conversations', async () => {
      const convId1 = await createTestConversation(5);
      const convId2 = await createTestConversation(3);
      
      // Load only conv1 messages
      await act(async () => {
        useChatStore.setState({ messages: {} });
        await useChatStore.getState().loadMessages(convId1);
      });
      
      const store = useChatStore.getState();
      const conv1Messages = Object.values(store.messages)
        .filter(m => m.conversationId === convId1);
      const conv2Messages = Object.values(store.messages)
        .filter(m => m.conversationId === convId2);
      
      expect(conv1Messages).toHaveLength(5);
      expect(conv2Messages).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle updating non-existent conversation gracefully', async () => {
      const store = useChatStore.getState();
      
      await act(async () => {
        await store.updateConversation('non-existent-id', { title: 'Test' });
      });
      
      // Should not crash
      expect(store.conversations['non-existent-id']).toBeUndefined();
    });

    it('should handle deleting non-existent conversation gracefully', async () => {
      const store = useChatStore.getState();
      
      await act(async () => {
        await store.deleteConversation('non-existent-id');
      });
      
      // Should not crash
      expect(true).toBe(true);
    });

    it('should handle adding message to non-existent conversation', async () => {
      // This might create orphaned message or fail gracefully
      let messageId;
      await act(async () => {
        messageId = await useChatStore.getState().addMessage('non-existent-conv', {
          role: 'user',
          content: 'Test'
        });
      });
      
      const store = useChatStore.getState();
      // Should still create the message (orphaned)
      expect(store.messages[messageId]).toBeDefined();
    });
  });
});

