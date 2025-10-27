/**
 * Chat Operations Hook
 * 
 * Wraps chat operations (send message, delete, etc.) with React Query.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useChatStore } from '../store/chatStore';
import { useSettingsStore } from '../../../shared/store/settingsStore';
import { queryKeys } from '../../../lib/queryClient';
import { sendChatMessage, shouldGenerateSummary, generateConversationSummary } from '../services/chatService';
import { autoRefreshSuggestedFeed } from '../../learn/services/autoOperations';

// Helper: Get conversation messages
function getConversationMessages(conversationId, allMessages) {
  const msgs = Object.values(allMessages);
  return msgs
    .filter(m => m.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Helper: Get sorted conversation IDs
function getSortedConversationIds(conversations) {
  const convs = Object.values(conversations);
  return convs
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(c => c.id);
}

export function useChatOperations() {
  const queryClient = useQueryClient();
  const createConversation = useChatStore(state => state.createConversation);
  const addMessage = useChatStore(state => state.addMessage);
  const updateMessage = useChatStore(state => state.updateMessage);
  const finalizeMessage = useChatStore(state => state.finalizeMessage);
  const updateConversation = useChatStore(state => state.updateConversation);
  const deleteConversation = useChatStore(state => state.deleteConversation);
  const pruneEmptyConversations = useChatStore(state => state.pruneEmptyConversations);
  const setLoading = useChatStore(state => state.setLoading);
  const setCurrentConversationId = useSettingsStore(state => state.setCurrentConversationId);
  const currentConversationId = useSettingsStore(state => state.currentConversationId);
  const selectedModel = useSettingsStore(state => state.selectedModel);
  
  /**
   * Create new conversation
   */
  const handleNewConversation = async () => {
    try {
      // Prune empty conversations first
      await pruneEmptyConversations();
      
      const newId = await createConversation({ model: selectedModel });
      console.log('[ChatOperations] Created new conversation:', newId);
      await setCurrentConversationId(newId);
      console.log('[ChatOperations] Set current conversation ID:', newId);
      return newId;
    } catch (error) {
      console.error('[ChatOperations] Failed to create conversation:', error);
      throw error;
    }
  };
  
  /**
   * Switch to conversation
   */
  const handleSwitchConversation = async (conversationId) => {
    console.log('[ChatOperations] Switching to conversation:', conversationId);
    await setCurrentConversationId(conversationId);
    console.log('[ChatOperations] Current conversation ID set to:', conversationId);
  };
  
  /**
   * Delete conversation
   */
  const handleDeleteConversation = async (conversationId) => {
    await deleteConversation(conversationId);
    
    // If we deleted the current conversation, switch to another
    if (conversationId === currentConversationId) {
      const conversations = useChatStore.getState().conversations;
      const conversationIds = getSortedConversationIds(conversations);
      const nextId = conversationIds[0] || null;
      await setCurrentConversationId(nextId);
    }
  };
  
  /**
   * Send message mutation
   */
  const sendMessageMutation = useMutation({
    mutationFn: async ({ content, attachments, conversationId }) => {
      console.log('[ChatOperations] sendMessage mutation started', { content, conversationId, currentConversationId });
      
      // Ensure we have a conversation
      let targetConversationId = conversationId || currentConversationId;
      let isNew = false;
      
      if (!targetConversationId) {
        console.log('[ChatOperations] No conversation, creating new one');
        targetConversationId = await handleNewConversation();
        isNew = true;
      }
      
      // Add user message
      const userMessageId = await addMessage(targetConversationId, {
        role: 'user',
        content,
        attachments: attachments || []
      });
      
      // Generate provisional title for new conversations
      if (isNew) {
        const provisionalTitle = content.trim().slice(0, 60) || 'New Chat';
        await updateConversation(targetConversationId, { title: provisionalTitle });
      }
      
      // Get conversation messages for API call
      const allMessages = useChatStore.getState().messages;
      const messages = getConversationMessages(targetConversationId, allMessages);
      
      // Call API
      const result = await sendChatMessage({
        messages,
        model: selectedModel,
        onDelta: (chunk, assistantMessageId) => {
          // Update message in store during streaming
          updateMessage(assistantMessageId, chunk);
        }
      });
      
      return {
        conversationId: targetConversationId,
        assistantMessageId: result.messageId,
        title: result.title
      };
    },
    onSuccess: async ({ conversationId, assistantMessageId, title }) => {
      // Finalize streaming message
      if (assistantMessageId) {
        await finalizeMessage(assistantMessageId);
      }
      
      // Update title if generated
      if (title) {
        await updateConversation(conversationId, { title });
      }
      
      // Check if summary needs to be generated
      const conversation = useChatStore.getState().conversations[conversationId];
      const allMessages = useChatStore.getState().messages;
      const messages = getConversationMessages(conversationId, allMessages);
      
      let summaryGenerated = false;
      if (conversation && shouldGenerateSummary(conversation, messages)) {
        try {
          const summary = await generateConversationSummary(messages);
          if (summary) {
            await updateConversation(conversationId, {
              summary,
              summaryMessageCount: messages.length
            });
            summaryGenerated = true;
          }
        } catch (error) {
          console.warn('[Chat] Failed to generate summary:', error);
        }
      }
      
      // Trigger auto-refresh of suggested feed if summary was generated
      if (summaryGenerated) {
        console.log('[Chat] Summary generated, triggering auto-refresh of suggested feed');
        // Run in background, don't wait
        autoRefreshSuggestedFeed().catch(error => {
          console.warn('[Chat] Auto-refresh failed:', error);
        });
      }
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId) });
    },
    onError: async (error, { conversationId }) => {
      console.error('[Chat] Send message failed:', error);
      
      // Add error message
      if (conversationId || currentConversationId) {
        await addMessage(conversationId || currentConversationId, {
          role: 'assistant',
          content: error.message || 'Failed to send message',
          isError: true
        });
      }
    },
    onSettled: () => {
      setLoading(false);
    }
  });
  
  /**
   * Send message function
   */
  const sendMessage = async (content, attachments = []) => {
    setLoading(true);
    await sendMessageMutation.mutateAsync({ 
      content, 
      attachments,
      conversationId: currentConversationId 
    });
  };
  
  return {
    sendMessage,
    handleNewConversation,
    handleSwitchConversation,
    handleDeleteConversation,
    isLoading: sendMessageMutation.isPending
  };
}

