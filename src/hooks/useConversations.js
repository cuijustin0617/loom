import { useState, useEffect, useCallback, useRef } from 'react';
import { sendOpenAIMessage } from '../services/openai';
import { sendGeminiMessage, generateTitle, generateSummary } from '../services/gemini';
import { sendGeminiLiveIncremental } from '../services/geminiLive';
import { normalizeText } from '../utils/normalize';
import { 
  saveConversations, 
  loadConversations, 
  saveCurrentConversationId, 
  loadCurrentConversationId,
  saveSettings,
  loadSettings 
} from '../utils/storage';

export const useConversations = () => {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash+search+incremental');
  const [isLoading, setIsLoading] = useState(false);
  const [inactivityTimer, setInactivityTimer] = useState(null);

  // Load data on mount
  useEffect(() => {
    const loadedConversations = loadConversations() || [];
    const loadedCurrentId = loadCurrentConversationId();
    const loadedSettings = loadSettings() || {};

    // One-time normalization for stored messages to reduce render-time work
    const normalizedConversations = loadedConversations.map(c => ({
      ...c,
      messages: Array.isArray(c.messages)
        ? c.messages.map(m => ({ ...m, content: normalizeText(m.content) }))
        : [],
    }));

    setConversations(normalizedConversations);
    setCurrentConversationId(loadedCurrentId);
    if (loadedSettings.selectedModel) setSelectedModel(loadedSettings.selectedModel);
  }, []);

  // Save conversations whenever they change (debounced to avoid heavy writes during streaming)
  const saveDebounceRef = useRef(null);
  useEffect(() => {
    if (conversations.length === 0) return;
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    const delay = isLoading ? 600 : 150;
    saveDebounceRef.current = setTimeout(() => {
      saveConversations(conversations);
    }, delay);
    return () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    };
  }, [conversations, isLoading]);

  // Save current conversation ID
  useEffect(() => {
    if (currentConversationId) {
      saveCurrentConversationId(currentConversationId);
    }
  }, [currentConversationId]);

  // Save settings
  useEffect(() => {
    saveSettings({ selectedModel });
  }, [selectedModel]);

  const getCurrentConversation = useCallback(() => {
    return conversations.find(conv => conv.id === currentConversationId);
  }, [conversations, currentConversationId]);

  const createNewConversation = useCallback(() => {
    const newId = Date.now().toString();
    const newConversation = {
      id: newId,
      title: 'New Chat',
      messages: [],
      model: selectedModel,
      createdAt: new Date().toISOString(),
      summary: ''
    };

    // If the current conversation is empty, drop it instead of keeping a blank tab
    setConversations(prev => {
      const currentIdx = prev.findIndex(c => c.id === currentConversationId);
      const pruned =
        currentIdx !== -1 && prev[currentIdx].messages.length === 0
          ? prev.filter(c => c.id !== currentConversationId)
          : prev;
      return [newConversation, ...pruned];
    });
    setCurrentConversationId(newId);
    
    return newId;
  }, [selectedModel, currentConversationId]);

  const switchToConversation = useCallback(async (conversationId) => {
    // Capture current conversation before switching
    const currentConv = getCurrentConversation();

    // Switch immediately to keep UI responsive
    setCurrentConversationId(conversationId);

    // If the previous conversation was empty, prune it in the background
    if (currentConv && currentConv.id !== conversationId && currentConv.messages.length === 0) {
      setConversations(prev => prev.filter(c => c.id !== currentConv.id));
    }

    // Generate summary for the previous conversation without blocking the UI
    if (currentConv && currentConv.messages.length > 0 && !currentConv.summary) {
      generateSummary(currentConv.messages)
        .then(summary => {
          if (!summary) return;
          setConversations(prev => prev.map(conv => 
            conv.id === currentConv.id 
              ? { ...conv, summary }
              : conv
          ));
        })
        .catch(error => {
          console.error('Failed to generate summary:', error);
        });
    }
  }, [getCurrentConversation]);

  const deleteConversation = useCallback((conversationId) => {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== conversationId);
      // If we deleted the active conversation, switch to the next available one
      if (currentConversationId === conversationId) {
        const fallbackId = next.length > 0 ? next[0].id : null;
        setCurrentConversationId(fallbackId);
      }
      return next;
    });
  }, [currentConversationId]);

  const sendMessage = useCallback(async (content) => {
    // Ensure there's an active conversation; create one if missing
    let targetConversationId = currentConversationId;
    let createdThisCall = false;
    if (!targetConversationId) {
      targetConversationId = createNewConversation();
      createdThisCall = true;
    }

    // Allow calling with a simple string or with an object { text, attachments }
    const isObjectPayload = content && typeof content === 'object' && !Array.isArray(content);
    const text = isObjectPayload ? (content.text ?? '') : content;
    const attachments = isObjectPayload ? (content.attachments ?? []) : [];

    const userMessage = {
      role: 'user',
      id: `${Date.now()}-u`,
      content: normalizeText(text),
      attachments,
      timestamp: new Date().toISOString()
    };

    // Add user message immediately; if the convo doesn't exist yet in state,
    // create a minimal one to ensure the echo shows up.
    setConversations(prev => {
      const existing = prev.find(c => c.id === targetConversationId);
      if (!existing) {
        const tempConversation = {
          id: targetConversationId,
          title: 'New Chat',
          messages: [userMessage],
          model: selectedModel,
          createdAt: new Date().toISOString(),
          summary: ''
        };
        // New conversation always appears on top
        return [tempConversation, ...prev];
      }
      // Append user message and move this conversation to the top (most recent)
      const updated = { ...existing, messages: [...existing.messages, userMessage] };
      const others = prev.filter(c => c.id !== targetConversationId);
      return [updated, ...others];
    });

    setIsLoading(true);
    
    try {
      // Build the messages payload. If we created the conversation in this call,
      // the previous messages are guaranteed to be empty.
      let messagesForAPI = [userMessage];
      if (!createdThisCall) {
        const currentConv = getCurrentConversation();
        if (currentConv && currentConv.id === targetConversationId) {
          messagesForAPI = [...currentConv.messages, userMessage];
        }
      }
      
      let response;
      if (selectedModel === 'gpt-4o-mini') {
        // Minimal scope: images/PDFs supported for Gemini models only for now
        const hasAnyAttachments = attachments && attachments.length > 0;
        if (hasAnyAttachments) {
          throw new Error('Image/PDF attachments are supported with Gemini models only. Switch to Gemini 2.5 to use attachments.');
        }
        response = await sendOpenAIMessage(messagesForAPI);
      } else if (selectedModel.includes('+incremental')) {
        // Create placeholder assistant message for incremental updates
        const placeholderId = Date.now().toString();
        const assistantDraft = {
          role: 'assistant',
          id: placeholderId,
          content: '',
          timestamp: new Date().toISOString(),
          _streamId: placeholderId,
        };

        setConversations(prev => prev.map(conv =>
          conv.id === targetConversationId
            ? { ...conv, messages: [...messagesForAPI, assistantDraft] }
            : conv
        ));

        const useSearch = selectedModel.includes('+search');

        // Collect deltas and update the draft message inline (throttled via rAF)
        let finalText = '';
        let rafScheduled = false;
        let lastPushed = '';
        const flushUpdate = () => {
          rafScheduled = false;
          const normalized = normalizeText(finalText);
          if (normalized === lastPushed) return;
          lastPushed = normalized;
          setConversations(prev => prev.map(conv => {
            if (conv.id !== targetConversationId) return conv;
            const msgs = conv.messages.slice();
            // Update the last assistant with _streamId or last element
            const idx = msgs.findIndex(m => m._streamId === placeholderId);
            if (idx !== -1) {
              msgs[idx] = { ...msgs[idx], content: normalized };
            } else if (msgs.length > 0) {
              const last = msgs[msgs.length - 1];
              if (last.role === 'assistant') {
                msgs[msgs.length - 1] = { ...last, content: normalized };
              }
            }
            return { ...conv, messages: msgs };
          }));
        };
        const onDelta = (chunk) => {
          finalText += chunk;
          if (!rafScheduled) {
            rafScheduled = true;
            (typeof window !== 'undefined' && window.requestAnimationFrame
              ? window.requestAnimationFrame
              : (fn) => setTimeout(fn, 16))(flushUpdate);
          }
        };

        response = await sendGeminiLiveIncremental(messagesForAPI, onDelta, () => {}, useSearch);
      } else {
        response = await sendGeminiMessage(messagesForAPI, selectedModel);
      }

      // If we streamed, the draft already exists and content updated.
      // If not streamed, append a regular assistant message now.
      if (!selectedModel.includes('+incremental')) {
        const assistantMessage = {
          role: 'assistant',
          id: `${Date.now()}-a`,
          content: normalizeText(response),
          timestamp: new Date().toISOString()
        };

        setConversations(prev => prev.map(conv => 
          conv.id === targetConversationId 
            ? { ...conv, messages: [...messagesForAPI, assistantMessage] }
            : conv
        ));
      }

      // Generate title after 2nd user message (4 total messages)
      const totalMessages = messagesForAPI.length + 1;
      if (totalMessages === 4) {
        try {
          // Build the convo end depending on streaming
          let convoForTitle;
          if (selectedModel.includes('+incremental')) {
            const current = getCurrentConversation();
            const lastAssistant = current?.messages[current.messages.length - 1];
            convoForTitle = [...messagesForAPI, lastAssistant];
          } else {
            const assistantMessage = {
              role: 'assistant',
              content: response,
              timestamp: new Date().toISOString()
            };
            convoForTitle = [...messagesForAPI, assistantMessage];
          }
          const title = await generateTitle(convoForTitle);
          setConversations(prev => prev.map(conv => 
            conv.id === targetConversationId 
              ? { ...conv, title }
              : conv
          ));
        } catch (error) {
          console.error('Failed to generate title:', error);
        }
      }

    } catch (error) {
      const errorMessage = {
        role: 'assistant',
        id: `${Date.now()}-e`,
        content: error.message,
        timestamp: new Date().toISOString(),
        isError: true
      };

      setConversations(prev => prev.map(conv => 
        conv.id === targetConversationId 
          ? { ...conv, messages: [...conv.messages, errorMessage] }
          : conv
      ));
    } finally {
      setIsLoading(false);
    }

    // Reset inactivity timer
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
    }
    
    const timer = setTimeout(async () => {
      const conv = getCurrentConversation();
      if (conv && conv.messages.length > 0 && !conv.summary) {
        try {
          const summary = await generateSummary(conv.messages);
          setConversations(prev => prev.map(c => 
            c.id === conv.id ? { ...c, summary } : c
          ));
        } catch (error) {
          console.error('Failed to generate summary:', error);
        }
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    setInactivityTimer(timer);
  }, [currentConversationId, selectedModel, getCurrentConversation, inactivityTimer, createNewConversation]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
      }
    };
  }, [inactivityTimer]);

  return {
    conversations,
    currentConversationId,
    selectedModel,
    isLoading,
    getCurrentConversation,
    createNewConversation,
    switchToConversation,
    sendMessage,
    setSelectedModel,
    deleteConversation
  };
};
