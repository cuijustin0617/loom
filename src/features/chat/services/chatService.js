/**
 * Chat Service
 * 
 * Handles sending messages to AI models and managing responses.
 */

import { sendGeminiMessage, generateTitle, generateSummary } from '../../../lib/ai/gemini';
import { sendOpenAIMessage } from '../../../lib/ai/openai';
import { sendGeminiLiveIncremental } from '../../../lib/ai/geminiLive';
import { normalizeText } from '../../../shared/utils/normalize';
import { useChatStore } from '../store/chatStore';
import { generateId, now } from '../../../lib/db/database';

/**
 * Send chat message
 * @param {Object} options
 * @param {Array} options.messages - Messages array
 * @param {string} options.model - Model ID
 * @param {Function} options.onDelta - Callback for streaming chunks
 * @returns {Promise<{messageId: string, title?: string}>}
 */
export async function sendChatMessage({ messages, model, onDelta }) {
  console.log('[ChatService] sendChatMessage called with:', { 
    messageCount: messages.length, 
    model,
    firstMessage: messages[0],
    lastMessage: messages[messages.length - 1]
  });
  
  const isIncremental = model.includes('+incremental');
  const useSearch = model.includes('+search');
  
  // Create assistant message placeholder for streaming
  let assistantMessageId = null;
  if (isIncremental) {
    assistantMessageId = generateId('msg');
    const conversationId = messages[messages.length - 1]?.conversationId;
    
    if (conversationId) {
      await useChatStore.getState().addMessage(conversationId, {
        role: 'assistant',
        content: '',
        messageId: assistantMessageId
      });
    }
  }
  
  try {
    console.log('[ChatService] Calling AI API with model:', model);
    let response;
    
    // Choose API based on model
    if (model === 'gpt-4o-mini') {
      // OpenAI (no attachments support)
      const hasAttachments = messages.some(m => 
        Array.isArray(m.attachments) && m.attachments.length > 0
      );
      
      if (hasAttachments) {
        throw new Error('Image/PDF attachments are supported with Gemini models only. Switch to Gemini 2.5 to use attachments.');
      }
      
      response = await sendOpenAIMessage(messages);
    } else if (isIncremental) {
      // Gemini Live (streaming)
      let fullText = '';
      let rafScheduled = false;
      let lastPushed = '';
      
      const flushUpdate = () => {
        rafScheduled = false;
        const normalized = normalizeText(fullText);
        if (normalized === lastPushed) return;
        lastPushed = normalized;
        
        if (onDelta && assistantMessageId) {
          onDelta(normalized, assistantMessageId);
        }
      };
      
      const onChunk = (chunk) => {
        fullText += chunk;
        if (!rafScheduled) {
          rafScheduled = true;
          requestAnimationFrame(flushUpdate);
        }
      };
      
      response = await sendGeminiLiveIncremental(
        messages,
        onChunk,
        () => {}, // onError handled by outer catch
        useSearch
      );
    } else {
      // Gemini standard
      response = await sendGeminiMessage(messages, model);
    }
    
    // Normalize response
    const normalizedResponse = normalizeText(response);
    
    // For non-streaming, create the assistant message now
    if (!isIncremental) {
      const conversationId = messages[messages.length - 1]?.conversationId;
      if (conversationId) {
        assistantMessageId = await useChatStore.getState().addMessage(conversationId, {
          role: 'assistant',
          content: normalizedResponse
        });
      }
    }
    
    // Generate title if this is one of the first exchanges
    let title = null;
    if (messages.length <= 2) {
      try {
        title = await generateTitle(messages);
      } catch (error) {
        console.warn('[ChatService] Failed to generate title:', error);
      }
    }
    
    console.log('[ChatService] Success! Response received, messageId:', assistantMessageId);
    return {
      messageId: assistantMessageId,
      title
    };
  } catch (error) {
    console.error('[ChatService] Failed to send message:', error);
    console.error('[ChatService] Error stack:', error.stack);
    throw error;
  }
}

/**
 * Generate summary for conversation
 * @param {Array} messages - Messages array
 * @returns {Promise<string|null>}
 */
export async function generateConversationSummary(messages) {
  try {
    if (!messages || messages.length === 0) return null;
    return await generateSummary(messages);
  } catch (error) {
    console.error('[ChatService] Failed to generate summary:', error);
    return null;
  }
}

/**
 * Check if summary needs to be generated for a conversation
 * @param {Object} conversation - Conversation object
 * @param {Array} messages - Messages array
 * @returns {boolean}
 */
export function shouldGenerateSummary(conversation, messages) {
  // Generate summary for new chats (after first exchange)
  if (!conversation.summary && messages.length >= 2) {
    return true;
  }
  
  // Generate summary every 3 new messages
  const messagesSinceLastSummary = conversation.summaryMessageCount || 0;
  if (messages.length - messagesSinceLastSummary >= 3) {
    return true;
  }
  
  return false;
}

