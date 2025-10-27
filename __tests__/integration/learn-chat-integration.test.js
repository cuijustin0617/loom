import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useChatStore } from '../../src/features/chat/store/chatStore';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { fullCleanup, initializeStores } from '../helpers/testUtils';
import { generateId } from '../../src/lib/db/database';

describe('Learn-Chat Integration: Message Access', () => {
  beforeEach(async () => {
    await fullCleanup();
    await initializeStores();
  });

  describe('Learn mode accessing chat messages', () => {
    it('should be able to access messages from chat conversations', async () => {
      let convId, msgId1, msgId2;
      
      // Create conversation with messages in chat mode
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        msgId1 = await useChatStore.getState().addMessage(convId, {
          role: 'user',
          content: 'What is machine learning?'
        });
        msgId2 = await useChatStore.getState().addMessage(convId, {
          role: 'assistant',
          content: 'Machine learning is a branch of AI...'
        });
      });

      // Verify messages are in chat store
      const chatStore = useChatStore.getState();
      expect(chatStore.conversations[convId]).toBeDefined();
      expect(chatStore.messages[msgId1]).toBeDefined();
      expect(chatStore.messages[msgId2]).toBeDefined();
      
      // Verify we can filter messages by conversation
      const allMessages = Object.values(chatStore.messages);
      const convMessages = allMessages.filter(m => m.conversationId === convId);
      
      expect(convMessages.length).toBe(2);
      expect(convMessages[0].content).toBe('What is machine learning?');
      expect(convMessages[1].content).toBe('Machine learning is a branch of AI...');
    });

    it('should load all messages on initialization for learn mode', async () => {
      // Create conversations with messages
      await act(async () => {
        const conv1 = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(conv1, {
          role: 'user',
          content: 'Message 1'
        });
        await useChatStore.getState().addMessage(conv1, {
          role: 'assistant',
          content: 'Response 1'
        });

        const conv2 = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(conv2, {
          role: 'user',
          content: 'Message 2'
        });
        await useChatStore.getState().addMessage(conv2, {
          role: 'assistant',
          content: 'Response 2'
        });
      });

      // Simulate app restart
      await act(async () => {
        await fullCleanup();
        await initializeStores();
      });

      // After reinitialization, all messages should be loaded
      const chatStore = useChatStore.getState();
      const messageCount = Object.keys(chatStore.messages).length;
      
      expect(messageCount).toBeGreaterThanOrEqual(4);
      expect(Object.keys(chatStore.conversations).length).toBeGreaterThanOrEqual(2);
    });

    it('should find messages when building conversation data for learn', async () => {
      let convId;
      
      // Create conversation with messages
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(convId, {
          role: 'user',
          content: 'How do neural networks work?'
        });
        await useChatStore.getState().addMessage(convId, {
          role: 'assistant',
          content: 'Neural networks are computational models...'
        });
      });

      // Simulate what Learn mode does
      const chatStore = useChatStore.getState();
      const conversations = Object.values(chatStore.conversations);
      const allMessages = Object.values(chatStore.messages);
      
      // Build conversation data with messages
      const conversationsData = conversations.map(c => {
        const messages = allMessages.filter(m => m.conversationId === c.id);
        return {
          id: c.id,
          messages,
          ...c
        };
      });
      
      // Should find conversations with messages
      expect(conversationsData.length).toBeGreaterThan(0);
      const convWithMessages = conversationsData.filter(c => c.messages.length > 0);
      expect(convWithMessages.length).toBeGreaterThan(0);
      expect(convWithMessages[0].messages.length).toBe(2);
    });

    it('should handle empty conversations gracefully', async () => {
      let emptyConvId;
      
      // Create empty conversation
      await act(async () => {
        emptyConvId = await useChatStore.getState().createConversation();
      });

      const chatStore = useChatStore.getState();
      const allMessages = Object.values(chatStore.messages);
      
      // Check our specific empty conversation
      const emptyConv = chatStore.conversations[emptyConvId];
      const emptyConvMessages = allMessages.filter(m => m.conversationId === emptyConvId);
      
      // Should have conversation but no messages for this specific conversation
      expect(emptyConv).toBeDefined();
      expect(emptyConvMessages.length).toBe(0);
    });

    it('should handle multiple conversations with mixed message counts', async () => {
      const testConvIds = [];
      
      await act(async () => {
        // Conv 1: 3 messages
        const conv1 = await useChatStore.getState().createConversation();
        testConvIds.push(conv1);
        await useChatStore.getState().addMessage(conv1, { role: 'user', content: 'Q1_unique' });
        await useChatStore.getState().addMessage(conv1, { role: 'assistant', content: 'A1_unique' });
        await useChatStore.getState().addMessage(conv1, { role: 'user', content: 'Q2_unique' });

        // Conv 2: 0 messages (empty)
        const conv2 = await useChatStore.getState().createConversation();
        testConvIds.push(conv2);

        // Conv 3: 2 messages
        const conv3 = await useChatStore.getState().createConversation();
        testConvIds.push(conv3);
        await useChatStore.getState().addMessage(conv3, { role: 'user', content: 'Q3_unique' });
        await useChatStore.getState().addMessage(conv3, { role: 'assistant', content: 'A3_unique' });
      });

      const chatStore = useChatStore.getState();
      const allMessages = Object.values(chatStore.messages);
      
      // Build conversation data only for our test conversations
      const conversationsData = testConvIds.map(id => ({
        id,
        messages: allMessages.filter(m => m.conversationId === id),
        ...chatStore.conversations[id]
      }));
      
      // Should have 3 test conversations
      expect(conversationsData.length).toBe(3);
      
      // 2 of them should have messages
      const withMessages = conversationsData.filter(c => c.messages.length > 0);
      expect(withMessages.length).toBe(2);
      
      // Total should be 5 messages
      const totalMessages = conversationsData.reduce((sum, c) => sum + c.messages.length, 0);
      expect(totalMessages).toBe(5);
    });
  });

  describe('Message persistence across operations', () => {
    it('should not lose messages when loading conversations', async () => {
      let convId, msgCount;
      
      // Create and populate
      await act(async () => {
        convId = await useChatStore.getState().createConversation();
        await useChatStore.getState().addMessage(convId, { role: 'user', content: 'Test 1' });
        await useChatStore.getState().addMessage(convId, { role: 'assistant', content: 'Test 2' });
        msgCount = Object.keys(useChatStore.getState().messages).length;
      });

      // Reload conversations (simulating what might happen)
      await act(async () => {
        await useChatStore.getState().loadConversations();
      });

      // Messages should still be there
      const afterMsgCount = Object.keys(useChatStore.getState().messages).length;
      expect(afterMsgCount).toBe(msgCount);
    });

    it('should persist messages across app restarts', async () => {
      const testMessages = [];
      
      // Create messages
      await act(async () => {
        const conv = await useChatStore.getState().createConversation();
        const msg1 = await useChatStore.getState().addMessage(conv, { role: 'user', content: 'Persist test 1' });
        const msg2 = await useChatStore.getState().addMessage(conv, { role: 'assistant', content: 'Persist test 2' });
        testMessages.push(msg1, msg2);
      });

      // Simulate restart
      await act(async () => {
        await fullCleanup();
        await initializeStores();
      });

      // Messages should be loaded
      const chatStore = useChatStore.getState();
      const messages = Object.values(chatStore.messages);
      
      // Should have our messages
      const ourMessages = messages.filter(m => 
        m.content === 'Persist test 1' || m.content === 'Persist test 2'
      );
      expect(ourMessages.length).toBe(2);
    });
  });
});

