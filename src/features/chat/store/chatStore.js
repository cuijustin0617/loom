/**
 * Chat Store
 * 
 * Manages conversations and messages with normalized state.
 * Single source of truth for all chat data.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import db, { generateId, now } from '../../../lib/db/database';

/**
 * Chat Store
 */
export const useChatStore = create(
  immer((set, get) => ({
    // Normalized state
    conversations: {}, // { [id]: Conversation }
    messages: {},      // { [id]: Message }
    
    // UI state
    isLoading: false,
    
    // Actions
    
    /**
     * Load all conversations from database
     */
    loadConversations: async () => {
      try {
        const conversations = await db.conversations.toArray();
        
        set(draft => {
          draft.conversations = Object.fromEntries(
            conversations.map(c => [c.id, c])
          );
        });
      } catch (error) {
        console.error('[ChatStore] Failed to load conversations:', error);
      }
    },
    
    /**
     * Load messages for a specific conversation
     * @param {string} conversationId - Conversation ID
     */
    loadMessages: async (conversationId) => {
      try {
        const messages = await db.messages
          .where('conversationId')
          .equals(conversationId)
          .toArray();
        
        set(draft => {
          for (const msg of messages) {
            draft.messages[msg.messageId] = msg;
          }
        });
      } catch (error) {
        console.error('[ChatStore] Failed to load messages:', error);
      }
    },
    
    /**
     * Load all messages from database
     * (Used for Learn mode to access all conversation messages)
     */
    loadAllMessages: async () => {
      try {
        const messages = await db.messages.toArray();
        
        console.log('[ChatStore] Loading all messages from database:', messages.length);
        
        set(draft => {
          draft.messages = Object.fromEntries(
            messages.map(m => [m.messageId, m])
          );
        });
        
        console.log('[ChatStore] Loaded', messages.length, 'messages into store');
      } catch (error) {
        console.error('[ChatStore] Failed to load all messages:', error);
      }
    },
    
    /**
     * Create a new conversation
     * @param {{model?: string}} options
     * @returns {Promise<string>} New conversation ID
     */
    createConversation: async (options = {}) => {
      const id = generateId('conv');
      const conversation = {
        id,
        title: 'New Chat',
        summary: '',
        summaryMessageCount: 0,
        model: options.model || 'gemini-2.5-pro+search+incremental',
        createdAt: now(),
        updatedAt: now()
      };
      
      // Save to database
      await db.conversations.add(conversation);
      
      // Update store
      set(draft => {
        draft.conversations[id] = conversation;
      });
      
      return id;
    },
    
    /**
     * Update conversation
     * @param {string} id - Conversation ID
     * @param {Partial<Conversation>} updates - Fields to update
     */
    updateConversation: async (id, updates) => {
      const updatedAt = now();
      
      // Update database
      await db.conversations.update(id, { ...updates, updatedAt });
      
      // Update store
      set(draft => {
        if (draft.conversations[id]) {
          Object.assign(draft.conversations[id], updates, { updatedAt });
        }
      });
    },
    
    /**
     * Delete conversation and its messages
     * @param {string} id - Conversation ID
     */
    deleteConversation: async (id) => {
      // Delete from database (with transaction for safety)
      await db.transaction('rw', [db.conversations, db.messages], async () => {
        await db.conversations.delete(id);
        await db.messages.where('conversationId').equals(id).delete();
      });
      
      // Update store
      set(draft => {
        delete draft.conversations[id];
        
        // Remove messages
        Object.keys(draft.messages).forEach(msgId => {
          if (draft.messages[msgId].conversationId === id) {
            delete draft.messages[msgId];
          }
        });
      });
    },
    
    /**
     * Add message to conversation
     * @param {string} conversationId - Conversation ID
     * @param {{role: 'user'|'assistant', content: string, attachments?: Array, isError?: boolean}} message
     * @returns {Promise<string>} Message ID
     */
    addMessage: async (conversationId, message) => {
      const messageId = message.messageId || generateId('msg');
      const createdAt = now();
      
      const fullMessage = {
        messageId,
        conversationId,
        role: message.role,
        content: message.content,
        attachments: message.attachments || [],
        isError: message.isError || false,
        createdAt
      };
      
      // Save to database (use put to allow upsert)
      await db.messages.put(fullMessage);
      
      // Update conversation's updatedAt
      await db.conversations.update(conversationId, { updatedAt: now() });
      
      // Update store
      set(draft => {
        draft.messages[messageId] = fullMessage;
        
        if (draft.conversations[conversationId]) {
          draft.conversations[conversationId].updatedAt = now();
        }
      });
      
      return messageId;
    },
    
    /**
     * Update message content (for streaming)
     * @param {string} messageId - Message ID
     * @param {string} content - New content
     */
    updateMessage: (messageId, content) => {
      set(draft => {
        if (draft.messages[messageId]) {
          draft.messages[messageId].content = content;
        }
      });
    },
    
    /**
     * Finalize streaming message (save to database)
     * @param {string} messageId - Message ID
     */
    finalizeMessage: async (messageId) => {
      const message = get().messages[messageId];
      if (!message) return;
      
      await db.messages
        .where('messageId')
        .equals(messageId)
        .modify({ content: message.content });
    },
    
    /**
     * Set loading state
     * @param {boolean} loading - Loading state
     */
    setLoading: (loading) => {
      set(draft => {
        draft.isLoading = loading;
      });
    },
    
    /**
     * Prune empty conversations
     */
    pruneEmptyConversations: async () => {
      const conversations = Object.values(get().conversations);
      const allMessages = Object.values(get().messages);
      
      for (const conv of conversations) {
        const msgs = allMessages.filter(m => m.conversationId === conv.id);
        if (msgs.length === 0) {
          await get().deleteConversation(conv.id);
        }
      }
    }
  }))
);

/**
 * Initialize chat store (call on app mount)
 */
export async function initializeChat() {
  await useChatStore.getState().loadConversations();
  await useChatStore.getState().loadAllMessages();
}

