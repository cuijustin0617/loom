import { GoogleGenAI, Modality } from '@google/genai';
import { useSettingsStore } from '../../shared/store/settingsStore';

// Live model to use for streaming (preview as per docs)
const getLiveModel = (selectedModel = '') => {
  const normalized = (selectedModel || '').trim();
  if (normalized.includes('pro')) {
    return 'gemini-live-2.5-pro-preview';
  }
  return 'gemini-live-2.5-flash-preview';
};

const getAi = () => {
  const key = useSettingsStore.getState().apiKey?.trim() || '';
  if (!key) throw new Error('Gemini API key is missing. Open Settings to add your key.');
  return new GoogleGenAI({ apiKey: key });
};

const toTurns = (messages) => {
  return messages.map((m) => {
    const parts = [];
    if (m.content && m.content.trim()) {
      parts.push({ text: m.content });
    }
    if (Array.isArray(m.attachments)) {
      for (const att of m.attachments) {
        if (att && att.base64 && att.mimeType) {
          parts.push({ inlineData: { mimeType: att.mimeType, data: att.base64 } });
        }
      }
    }
    if (parts.length === 0) parts.push({ text: '' });
    return {
      role: m.role === 'user' ? 'user' : 'model',
      parts,
    };
  });
};

/**
 * Send conversation to Gemini Live API with incremental updates.
 * @param {Array} messages - Conversation messages (same schema as elsewhere)
 * @param {function(string):void} onDelta - Called for each text chunk
 * @param {function(string):void} onDone - Called once when the server marks turn complete
 * @param {boolean} useSearch - Whether to enable Google Search grounding
 * @returns {Promise<string>} Resolves with the final concatenated text
 */
export const sendGeminiLiveIncremental = async (messages, onDelta, onDone, useSearch = false, selectedModel = '') => {
  console.log('[GeminiLive] Starting incremental stream...', { messageCount: messages.length, useSearch });
  
  const responseQueue = [];
  let session;

  const config = {
    responseModalities: [Modality.TEXT],
  };
  if (useSearch) {
    config.tools = [{ googleSearch: {} }];
  }

  try {
    console.log('[GeminiLive] Getting AI instance...');
    const ai = getAi();
    
    console.log('[GeminiLive] Connecting to Live API...');
    session = await ai.live.connect({
      model: getLiveModel(selectedModel),
      callbacks: {
        onopen: function () {
          console.log('[GeminiLive] Connection opened');
        },
        onmessage: function (message) {
          console.log('[GeminiLive] Received message:', message);
          responseQueue.push(message);
        },
        onerror: function (e) {
          console.error('[GeminiLive] Stream error:', e);
          // Surface errors via queue to break waiting loop
          responseQueue.push({ __error: e });
        },
        onclose: function () {
          console.log('[GeminiLive] Connection closed');
        },
      },
      config,
    });
    
    console.log('[GeminiLive] Connected! Session:', session);

    const turns = toTurns(messages);
    console.log('[GeminiLive] Sending turns to API:', turns);
    session.sendClientContent({ turns, turnComplete: true });
    console.log('[GeminiLive] Content sent, waiting for responses...');

    let finalText = '';
    const linkMap = new Map(); // url -> title

    const titleForUrl = (url, obj) => {
      let title = obj?.title || obj?.pageTitle || obj?.sourceTitle || obj?.name;
      try { if (!title) { const u = new URL(url); title = u.hostname.replace(/^www\./, ''); } } catch {}
      return title || url;
    };
    const collectFromObj = (obj) => {
      if (!obj) return;
      if (Array.isArray(obj)) { obj.forEach(collectFromObj); return; }
      if (typeof obj !== 'object') return;
      const url = obj.uri || obj.url || obj.sourceUrl;
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        linkMap.set(url, titleForUrl(url, obj));
      }
      for (const v of Object.values(obj)) collectFromObj(v);
    };
    let done = false;
    let iterations = 0;
    const MAX_ITERATIONS = 600; // 30 seconds (600 * 50ms)

    while (!done) {
      iterations++;
      if (iterations > MAX_ITERATIONS) {
        console.error('[GeminiLive] Timeout: No response received after 30 seconds');
        throw new Error('Gemini Live API timeout - no response received');
      }
      
      let message = responseQueue.shift();
      if (!message) {
        // sleep 50ms
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      
      console.log('[GeminiLive] Processing message from queue:', message);
      
      if (message.__error) {
        throw message.__error;
      }
      if (message.text) {
        finalText += message.text;
        onDelta?.(message.text);
      }
      // Best-effort: collect URLs from any metadata that might be present on live chunks
      if (message.citationMetadata) collectFromObj(message.citationMetadata);
      if (message.groundingMetadata) collectFromObj(message.groundingMetadata);
      if (message.serverContent) collectFromObj(message.serverContent);
      if (message.serverContent && message.serverContent.turnComplete) {
        console.log('[GeminiLive] Turn complete!');
        done = true;
      }
    }

    // Append sources at end if available
    if (linkMap.size > 0) {
      const linksMd = Array.from(linkMap.entries()).map(([u, t]) => `- [${t}](${u})`).join('\n');
      const appendix = `\n\nSources:\n${linksMd}`;
      finalText += appendix;
      onDelta?.(appendix);
    }

    onDone?.(finalText);
    return finalText;
  } finally {
    try { session?.close(); } catch {}
  }
};
