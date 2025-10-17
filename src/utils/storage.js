// Local storage utilities for conversation management

export const STORAGE_KEYS = {
  CONVERSATIONS: 'loom_conversations',
  CURRENT_CONVERSATION: 'loom_current_conversation',
  SETTINGS: 'loom_settings'
};

export const saveConversations = (conversations) => {
  localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations));
};

export const loadConversations = () => {
  const stored = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
  return stored ? JSON.parse(stored) : [];
};

export const saveCurrentConversationId = (id) => {
  localStorage.setItem(STORAGE_KEYS.CURRENT_CONVERSATION, id);
};

export const loadCurrentConversationId = () => {
  return localStorage.getItem(STORAGE_KEYS.CURRENT_CONVERSATION);
};

export const saveSettings = (settings) => {
  const existing = loadSettings() || {};
  // If BYOK key changed, refresh its timestamp so we can treat it as fresh for a week
  let merged = { ...existing, ...settings };
  if (Object.prototype.hasOwnProperty.call(settings, 'byokGeminiKey')) {
    const newKey = (settings.byokGeminiKey || '').trim();
    const oldKey = (existing.byokGeminiKey || '').trim();
    if (newKey !== oldKey) {
      merged.byokGeminiKeyUpdatedAt = Date.now();
    }
  }
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(merged));
};

export const loadSettings = () => {
  const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
  return stored ? JSON.parse(stored) : { selectedModel: 'gemini-2.5-pro+search+incremental', byokGeminiKey: '', e2eePassphrase: '', byokGeminiKeyUpdatedAt: 0 };
};

// API key freshness helpers
export const API_KEY_MAX_AGE_DAYS = 7;
export const API_KEY_MAX_AGE_MS = API_KEY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export const getByokKeyAgeMs = () => {
  const s = loadSettings() || {};
  const t = Number(s.byokGeminiKeyUpdatedAt || 0);
  if (!t) return Infinity;
  return Date.now() - t;
};

export const isByokKeyFresh = () => {
  const s = loadSettings() || {};
  const key = (s.byokGeminiKey || '').trim();
  if (!key) return false;
  return getByokKeyAgeMs() <= API_KEY_MAX_AGE_MS;
};
