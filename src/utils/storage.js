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
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
};

export const loadSettings = () => {
  const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
  return stored ? JSON.parse(stored) : { selectedModel: 'gemini-2.5-flash+search+incremental' };
};
