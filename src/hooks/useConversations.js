import { useState, useEffect, useCallback, useRef } from 'react';
import { onAuthChanged, db } from '../services/firebase';
import {
  collection,
  doc,
  setDoc,
  addDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  deleteDoc,
  getDocs,
} from 'firebase/firestore';
import { encryptJSON, decryptJSON } from '../utils/crypto';
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
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-pro+search+incremental');
  const [isLoading, setIsLoading] = useState(false);
  const [inactivityTimer, setInactivityTimer] = useState(null);
  const [user, setUser] = useState(null);

  // Helper to identify placeholder titles we should avoid persisting/overwriting with
  const isPlaceholderTitle = useCallback((t) => {
    const s = String(t || '').trim().toLowerCase();
    return !s || s === 'new chat' || s === 'new conversation' || s === 'untitled' || s === 'conversation';
  }, []);

  // Load data on mount
  useEffect(() => {
    const loadedConversations = loadConversations() || [];
    const loadedCurrentId = loadCurrentConversationId();
    const loadedSettings = loadSettings() || {};

    // One-time normalization for stored messages to reduce render-time work
    const normalizedConversations = loadedConversations
      .map(c => ({
        ...c,
        messages: Array.isArray(c.messages)
          ? c.messages.map(m => ({ ...m, content: normalizeText(m.content) }))
          : [],
      }))
      // Drop any persisted empty conversations
      .filter(c => Array.isArray(c.messages) && c.messages.length > 0);

    setConversations(normalizedConversations);
    const exists = normalizedConversations.some(c => c.id === loadedCurrentId);
    setCurrentConversationId(exists ? loadedCurrentId : null);
    if (loadedSettings.selectedModel) setSelectedModel(loadedSettings.selectedModel);
  }, []);

  // Firebase auth state
  useEffect(() => {
    const unsub = onAuthChanged((u) => setUser(u || null));
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  // Save conversations whenever they change (debounced to avoid heavy writes during streaming)
  const saveDebounceRef = useRef(null);
  useEffect(() => {
    if (conversations.length === 0) return;
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    const delay = isLoading ? 600 : 150;
    saveDebounceRef.current = setTimeout(() => {
      // Persist only non-empty conversations to avoid resurrecting empty placeholders
      const toPersist = conversations.filter(c => Array.isArray(c.messages) && c.messages.length > 0);
      saveConversations(toPersist);
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

  // Remote sync: conversations metadata for logged-in user
  useEffect(() => {
    if (!user || !db) return;
    const convsRef = collection(db, 'users', user.uid, 'conversations');
    const unsub = onSnapshot(convsRef, (snap) => {
      const remote = [];
      snap.forEach((d) => {
        const data = d.data() || {};
        // Skip remote placeholders that have no messages
        const looksEmptyRemote = !data.hasMessages && (!data.summary || String(data.summary).trim() === '') && isPlaceholderTitle(data.title);
        if (looksEmptyRemote) {
          return; // ignore empty placeholders
        }
        remote.push({
          id: d.id,
          title: data.title || 'New Chat',
          summary: data.summary || '',
          model: data.model || selectedModel,
          createdAt: data.createdAt || new Date().toISOString(),
          messages: [],
        });
      });
      // Merge remote metadata into local list without overriding local messages
      setConversations((prev) => {
        const map = new Map(prev.map((c) => [c.id, c]));
        for (const rc of remote) {
          const existing = map.get(rc.id);
          if (existing) {
            // Prefer a non-default local title over a default/placeholder remote one
            const mergedTitle = (!isPlaceholderTitle(existing.title) && isPlaceholderTitle(rc.title))
              ? existing.title
              : (rc.title || existing.title || 'New Chat');
            map.set(rc.id, { ...existing, title: mergedTitle, summary: rc.summary || existing.summary || '', model: rc.model || existing.model });
          } else {
            map.set(rc.id, rc);
          }
        }
        return Array.from(map.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      });
    });
    return () => unsub();
  }, [user]);

  // Remote sync: messages of current conversation (requires passphrase)
  useEffect(() => {
    if (!user || !currentConversationId || !db) return;
    const passphrase = (loadSettings()?.e2eePassphrase || '').trim();
    if (!passphrase) return;
    const msgsRef = query(
      collection(db, 'users', user.uid, 'conversations', currentConversationId, 'messages'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(msgsRef, async (snap) => {
      try {
        const remoteMsgs = [];
        let containsOmitted = false;
        for (const d of snap.docs) {
          const data = d.data() || {};
          const payload = data.contentCiphertext;
          if (!payload) continue;
          const decrypted = await decryptJSON(passphrase, payload);
          remoteMsgs.push({
            id: d.id,
            role: data.author || 'assistant',
            content: normalizeText(decrypted.content || ''),
            attachments: Array.isArray(decrypted.attachments) ? decrypted.attachments : [],
            timestamp: data.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
          });
          if (decrypted.attachmentsOmitted || data.attachmentsOmitted) containsOmitted = true;
        }
        // Do not clobber local messages if remote is behind.
        // - Ignore when remote has zero messages (likely not yet synced).
        // - Only apply when remote has at least as many messages as local.
        setConversations((prev) => prev.map((c) => {
          if (c.id !== currentConversationId) return c;
          const remoteCount = remoteMsgs.length;
          const localCount = Array.isArray(c.messages) ? c.messages.length : 0;
          if (remoteCount === 0) return c;
          if (remoteCount < localCount) return c;
          if (containsOmitted) return c; // preserve local attachments when remote trimmed
          return { ...c, messages: remoteMsgs };
        }));
      } catch (e) {
        // If decryption fails, skip updating to avoid clobbering local state
      }
    });
    return () => unsub();
  }, [user, currentConversationId]);

  // Helpers for Firestore writes
  const ensureConversationDoc = useCallback(async (conversationId, meta) => {
    if (!user || !db) return;
    const ref = doc(db, 'users', user.uid, 'conversations', conversationId);
    await setDoc(ref, {
      title: meta?.title || 'New Chat',
      summary: meta?.summary || '',
      model: meta?.model || selectedModel,
      createdAt: meta?.createdAt || new Date().toISOString(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }, [user, selectedModel]);

  const writeMessage = useCallback(async (conversationId, message) => {
    if (!user || !db) return;
    const passphrase = (loadSettings()?.e2eePassphrase || '').trim();
    if (!passphrase) return;
    const att = Array.isArray(message.attachments) ? message.attachments : [];
    const approxBase64Bytes = att.reduce((sum, a) => sum + (a?.base64?.length || 0), 0);
    const approxContentBytes = (message.content || '').length;
    const SHOULD_TRIM = approxBase64Bytes > 200000 || approxBase64Bytes + approxContentBytes > 900000;
    const toEncrypt = SHOULD_TRIM
      ? {
          content: message.content || '',
          attachments: [],
          attachmentsOmitted: att.length > 0,
          attachmentsMeta: att.map(a => ({ name: a?.name, mimeType: a?.mimeType, size: a?.size })),
        }
      : {
          content: message.content || '',
          attachments: att,
        };
    const payload = await encryptJSON(passphrase, toEncrypt);
    const msgsRef = collection(db, 'users', user.uid, 'conversations', conversationId, 'messages');
    await addDoc(msgsRef, {
      author: message.role === 'user' ? 'user' : 'assistant',
      contentCiphertext: payload,
      createdAt: serverTimestamp(),
      attachmentsOmitted: SHOULD_TRIM ? true : false,
    });
    try {
      const ref = doc(db, 'users', user.uid, 'conversations', conversationId);
      await setDoc(ref, { hasMessages: true, updatedAt: serverTimestamp() }, { merge: true });
    } catch {}
  }, [user]);

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
    // Do not create remote container until the first message is sent
    
    return newId;
  }, [selectedModel, currentConversationId, ensureConversationDoc]);

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
    // Remote delete (best effort)
    if (user && db) {
      (async () => {
        try {
          const msgsCol = collection(db, 'users', user.uid, 'conversations', conversationId, 'messages');
          const snap = await getDocs(msgsCol);
          await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
          await deleteDoc(doc(db, 'users', user.uid, 'conversations', conversationId));
        } catch {}
      })();
    }
  }, [currentConversationId, user]);

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

    // Build a quick provisional title from the first user input
    const computeProvisionalTitle = (t) => {
      const raw = String(t || '').trim().replace(/\s+/g, ' ');
      if (!raw) return 'New Chat';
      // Take first sentence or first ~6 words, max ~60 chars
      const firstSentence = raw.split(/[.!?]\s+/)[0];
      const words = firstSentence.split(' ').slice(0, 6).join(' ');
      const clipped = words.length > 60 ? words.slice(0, 57) + '…' : words;
      return clipped || 'New Chat';
    };
    const provisionalTitle = computeProvisionalTitle(userMessage.content);

    // Add user message immediately; if the convo doesn't exist yet in state,
    // create a minimal one to ensure the echo shows up.
    setConversations(prev => {
      const existing = prev.find(c => c.id === targetConversationId);
      if (!existing) {
        const tempConversation = {
          id: targetConversationId,
          title: provisionalTitle,
          messages: [userMessage],
          model: selectedModel,
          createdAt: new Date().toISOString(),
          summary: ''
        };
        // New conversation always appears on top
        return [tempConversation, ...prev];
      }
      // Append user message and move this conversation to the top (most recent)
      const updated = { 
        ...existing, 
        title: (isPlaceholderTitle(existing.title)) ? provisionalTitle : existing.title,
        messages: [...existing.messages, userMessage] 
      };
      const others = prev.filter(c => c.id !== targetConversationId);
      return [updated, ...others];
    });

    setIsLoading(true);
    
    try {
      // Best-effort remote write for user message
      await ensureConversationDoc(targetConversationId, { model: selectedModel });
      await writeMessage(targetConversationId, userMessage);

      // Kick off early title generation based on the first user message
      // Update only if the title hasn't been customized yet
      try {
        const earlyTitle = await generateTitle([userMessage]);
        if (earlyTitle && !isPlaceholderTitle(earlyTitle)) {
          setConversations(prev => prev.map(conv => 
            conv.id === targetConversationId && (isPlaceholderTitle(conv.title) || conv.title === provisionalTitle)
              ? { ...conv, title: earlyTitle }
              : conv
          ));
          await ensureConversationDoc(targetConversationId, { title: earlyTitle });
        }
      } catch {}

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
        // Remote write assistant message
        await writeMessage(targetConversationId, assistantMessage);
      } else {
        // For incremental mode, write the final assistant message after streaming completes
        const current = getCurrentConversation();
        const last = current?.messages?.[current.messages.length - 1];
        if (last && last.role === 'assistant') {
          await writeMessage(targetConversationId, last);
        }
      }

      // Update/refine title after first assistant response if still default/provisional
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
        const refinedTitle = await generateTitle(convoForTitle);
        if (refinedTitle && !isPlaceholderTitle(refinedTitle)) {
          setConversations(prev => prev.map(conv => 
            conv.id === targetConversationId && (isPlaceholderTitle(conv.title) || conv.title === provisionalTitle)
              ? { ...conv, title: refinedTitle }
              : conv
          ));
          await ensureConversationDoc(targetConversationId, { title: refinedTitle });
        }
      } catch (error) {
        console.error('Failed to generate title:', error);
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
          if (user && db) {
            await ensureConversationDoc(conv.id, { summary });
          }
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
