import { GoogleGenerativeAI } from '@google/generative-ai';
import { useSettingsStore } from '../../shared/store/settingsStore';

const getGenAI = () => {
  const key = useSettingsStore.getState().apiKey?.trim() || '';
  if (!key) throw new Error('Gemini API key is missing. Open Settings to add your key.');
  return new GoogleGenerativeAI(key);
};

// Build Gemini "parts" array from a message that may include text + attachments
const buildPartsFromMessage = (msg) => {
  const parts = [];
  if (msg.content && msg.content.trim()) {
    parts.push({ text: msg.content });
  }
  if (Array.isArray(msg.attachments)) {
    for (const att of msg.attachments) {
      if (att && att.base64 && att.mimeType) {
        parts.push({
          inlineData: {
            mimeType: att.mimeType,
            data: att.base64,
          },
        });
      }
    }
  }
  // Fallback to at least an empty text part to avoid invalid requests
  if (parts.length === 0) {
    parts.push({ text: '' });
  }
  return parts;
};

export const sendGeminiMessage = async (messages, model = 'gemini-2.5-flash') => {
  try {
    // Support suffix variants (e.g., gemini-2.5-flash+search, gemini-2.5-flash+incremental)
    const normalized = (model || '').trim();
    const useSearch = normalized.includes('+search') || normalized.endsWith('-search');
    // Strip everything after '+' and remove optional '-search'
    const baseModel = normalized.split('+')[0].replace('-search', '');

    const geminiModel = getGenAI().getGenerativeModel({ model: baseModel });

    // Always use structured contents to support multimodal parts
    const contents = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: buildPartsFromMessage(msg),
    }));

    // Heuristic: if the prompt demands JSON-only output, avoid adding search tool noise and skip appending sources.
    const wantsJsonOnly = Array.isArray(messages) && messages.some(m => /\b(json only|return only valid json|output:\s*json only)/i.test(String(m.content || '')));

    const request = (useSearch && !wantsJsonOnly)
      ? { contents, tools: [{ googleSearch: {} }] }
      : { contents };

    const result = await geminiModel.generateContent(request);
    const response = await result.response;

    // Base text
    let out = response.text();

    // Attempt to extract links and append as Sources only when not JSON-only
    if (!wantsJsonOnly) {
      try {
        const candidates = response.candidates || [];
        const linkMap = new Map(); // url -> title

        const titleForUrl = (url, obj) => {
          let title = obj?.title || obj?.pageTitle || obj?.sourceTitle || obj?.name;
          try {
            if (!title) {
              const u = new URL(url);
              title = u.hostname.replace(/^www\./, '');
            }
          } catch {}
          return title || url;
        };

        const collectFromObj = (obj) => {
          if (!obj) return;
          if (Array.isArray(obj)) { obj.forEach(collectFromObj); return; }
          if (typeof obj !== 'object') return;

          // If object has a url-like field, record it with any nearby title
          const url = obj.uri || obj.url || obj.sourceUrl;
          if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
            linkMap.set(url, titleForUrl(url, obj));
          }

          for (const v of Object.values(obj)) collectFromObj(v);
        };

        for (const cand of candidates) {
          if (cand.urlContextMetadata) collectFromObj(cand.urlContextMetadata);
          if (cand.citationMetadata) collectFromObj(cand.citationMetadata);
          if (cand.groundingMetadata) collectFromObj(cand.groundingMetadata);
        }

        if (linkMap.size > 0) {
          const linksMd = Array.from(linkMap.entries())
            .map(([u, t]) => `- [${t}](${u})`)
            .join('\n');
          out = `${out}\n\nSources:\n${linksMd}`;
        }
      } catch {
        // best-effort only
      }
    }

    return out;
  } catch (error) {
    throw new Error(`Gemini API Error: ${error.message}`);
  }
};

export const generateTitle = async (messages) => {
  try {
    const geminiModel = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    
    const conversationText = messages.slice(0, 4).map(msg => 
      `${msg.role === 'user' ? 'Human' : 'Assistant'}: ${msg.content}`
    ).join('\n\n');
    
    const prompt = `Based on this conversation, generate a short, descriptive title (max 6 words) that captures the main topic or question:\n\n${conversationText}`;
    
    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    
    let t = (response.text() || '').trim();
    // Basic cleanup
    t = t.replace(/^"+|"+$/g, ''); // strip surrounding quotes
    t = t.replace(/^'+|'+$/g, '');
    if (!t) return null;
    const lower = t.toLowerCase();
    if (lower === 'new chat' || lower === 'new conversation' || lower === 'untitled' || lower === 'conversation') return null;
    if (t.length > 60) t = t.slice(0, 57) + '…';
    return t;
  } catch (error) {
    console.error('Title generation failed:', error);
    return null; // avoid overwriting with a placeholder
  }
};

export const generateSummary = async (messages) => {
  try {
    const geminiModel = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    const conversationText = messages.map(msg => 
      `${msg.role === 'user' ? 'Human' : 'Assistant'}: ${msg.content}`
    ).join('\n\n');
    
    const prompt = `Summarize this conversation in 1-2 sentences, focusing on the main topic and key points discussed:\n\n${conversationText}`;
    
    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    
    return response.text().trim();
  } catch (error) {
    console.error('Summary generation failed:', error);
    return 'Conversation summary unavailable';
  }
};
