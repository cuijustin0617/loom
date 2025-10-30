/**
 * Settings Store
 * 
 * Manages user preferences and API keys.
 * Persisted to IndexedDB automatically.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import db from '../../lib/db/database';

/**
 * Settings Store
 */
export const useSettingsStore = create(
  immer((set, get) => ({
    // State
    apiKey: '',
    openaiKey: '',
    e2eePassphrase: '',
    selectedModel: 'gemini-2.5-pro+search+incremental',
    learnModel: 'gemini-2.5-flash',
    currentConversationId: null,
    currentMode: 'chat', // 'chat' | 'learn'
    
    // Loading state
    isLoaded: false,
    
    // Actions
    
    /**
     * Load settings from IndexedDB
     */
    loadSettings: async () => {
      try {
        const settings = await db.settings.toArray();
        const settingsMap = Object.fromEntries(
          settings.map(s => [s.key, s.value])
        );
        
        set(draft => {
          draft.apiKey = settingsMap.apiKey || '';
          draft.openaiKey = settingsMap.openaiKey || '';
          draft.e2eePassphrase = settingsMap.e2eePassphrase || '';
          draft.selectedModel = settingsMap.selectedModel || 'gemini-2.5-pro+search+incremental';
          draft.learnModel = settingsMap.learnModel || 'gemini-2.5-flash';
          draft.currentConversationId = settingsMap.currentConversationId || null;
          draft.currentMode = 'chat'; // Don't persist mode, always start in chat
          draft.isLoaded = true;
        });
      } catch (error) {
        console.error('[SettingsStore] Failed to load settings:', error);
        set(draft => {
          draft.isLoaded = true;
        });
      }
    },
    
    /**
     * Set API key
     * @param {string} key - Gemini API key
     */
    setApiKey: async (key) => {
      set(draft => {
        draft.apiKey = key;
      });
      await db.settings.put({ key: 'apiKey', value: key });
    },
    
    /**
     * Set OpenAI key
     * @param {string} key - OpenAI API key
     */
    setOpenAIKey: async (key) => {
      set(draft => {
        draft.openaiKey = key;
      });
      await db.settings.put({ key: 'openaiKey', value: key });
    },
    
    /**
     * Set E2EE passphrase
     * @param {string} passphrase - Encryption passphrase
     */
    setE2EEPassphrase: async (passphrase) => {
      set(draft => {
        draft.e2eePassphrase = passphrase;
      });
      await db.settings.put({ key: 'e2eePassphrase', value: passphrase });
    },
    
    /**
     * Set selected model
     * @param {string} model - Model ID
     */
    setSelectedModel: async (model) => {
      set(draft => {
        draft.selectedModel = model;
      });
      await db.settings.put({ key: 'selectedModel', value: model });
    },
    
    /**
     * Set Learn mode model
     * @param {string} model - Model ID
     */
    setLearnModel: async (model) => {
      set(draft => {
        draft.learnModel = model;
      });
      await db.settings.put({ key: 'learnModel', value: model });
    },
    
    /**
     * Set current conversation ID
     * @param {string|null} id - Conversation ID
     */
    setCurrentConversationId: async (id) => {
      set(draft => {
        draft.currentConversationId = id;
      });
      await db.settings.put({ key: 'currentConversationId', value: id });
    },
    
    /**
     * Set current mode (chat or learn)
     * @param {'chat'|'learn'} mode - Current mode
     */
    setCurrentMode: (mode) => {
      set(draft => {
        draft.currentMode = mode;
      });
      // Don't persist mode - it's UI state only
    }
  }))
);

/**
 * Initialize settings store (call on app mount)
 */
export async function initializeSettings() {
  await useSettingsStore.getState().loadSettings();
}

