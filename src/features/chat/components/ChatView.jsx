/**
 * ChatView - Main Chat Feature Container
 * 
 * Manages conversation list, active conversation, and chat interface.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../store/chatStore';
import { useSettingsStore } from '../../../shared/store/settingsStore';
import db from '../../../lib/db/database';
import ChatInterface from './ChatInterface';
import Sidebar from './Sidebar';

const SIDEBAR_WIDTH = 256; // px
const MIN_CHAT_WIDTH = 560; // px

function ChatView() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('loom_sidebar_collapsed') === '1'
  );
  const autoCollapsedRef = useRef(false);
  
  const currentConversationId = useSettingsStore(state => state.currentConversationId);
  const conversations = useChatStore(state => state.conversations);
  const messages = useChatStore(state => state.messages);
  const loadConversations = useChatStore(state => state.loadConversations);
  const loadAllMessages = useChatStore(state => state.loadAllMessages);
  const currentConversation = conversations[currentConversationId];
  
  // Auto-recovery: Check if store is empty but data exists in IndexedDB
  // This handles cases where HMR resets the store unexpectedly
  const hasCheckedRecovery = useRef(false);
  useEffect(() => {
    async function checkAndRecover() {
      // Only check once per mount
      if (hasCheckedRecovery.current) return;
      hasCheckedRecovery.current = true;
      
      // Check if store is empty
      const storeEmpty = Object.keys(conversations).length === 0 && Object.keys(messages).length === 0;
      
      if (!storeEmpty) {
        console.log('[ChatView] Store has data, no recovery needed');
        return;
      }
      
      // Check if IndexedDB has data
      try {
        const [dbConversations, dbMessages] = await Promise.all([
          db.conversations.count(),
          db.messages.count()
        ]);
        
        const hasData = dbConversations > 0 || dbMessages > 0;
        
        if (hasData) {
          console.log('[ChatView] Store empty but IndexedDB has data - recovering...', {
            conversations: dbConversations,
            messages: dbMessages
          });
          await loadConversations();
          await loadAllMessages();
          console.log('[ChatView] Recovery complete');
        } else {
          console.log('[ChatView] No data in store or IndexedDB - fresh start');
        }
      } catch (error) {
        console.error('[ChatView] Recovery check failed:', error);
      }
    }
    
    checkAndRecover();
  }, [conversations, messages, loadConversations, loadAllMessages]);
  
  // Compute conversation IDs sorted by update time
  const conversationIds = useMemo(() => {
    const convs = Object.values(conversations);
    return convs
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(c => c.id);
  }, [conversations]);
  
  // Save collapse state
  useEffect(() => {
    localStorage.setItem('loom_sidebar_collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);
  
  // Auto collapse/expand on viewport changes
  useEffect(() => {
    const recalc = () => {
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const needsCollapse = vw - SIDEBAR_WIDTH < MIN_CHAT_WIDTH;
      
      if (needsCollapse && !sidebarCollapsed) {
        setSidebarCollapsed(true);
        autoCollapsedRef.current = true;
      } else if (!needsCollapse && sidebarCollapsed && autoCollapsedRef.current) {
        setSidebarCollapsed(false);
        autoCollapsedRef.current = false;
      }
    };
    
    recalc();
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, [sidebarCollapsed]);
  
  const toggleCollapse = () => {
    setSidebarCollapsed(v => !v);
    autoCollapsedRef.current = false;
  };
  
  const reopenSidebar = () => {
    setSidebarCollapsed(false);
    autoCollapsedRef.current = false;
  };
  
  return (
    <div className="flex h-full bg-white relative">
      {/* Sidebar */}
      {!sidebarCollapsed && (
        <div 
          className="h-full border-r border-gray-200 bg-loom-gray select-none" 
          style={{ width: SIDEBAR_WIDTH }}
        >
          <Sidebar 
            conversationIds={conversationIds}
            currentConversationId={currentConversationId}
            onCollapse={toggleCollapse}
          />
        </div>
      )}
      
      {/* Open button when collapsed */}
      {sidebarCollapsed && (
        <button
          onClick={reopenSidebar}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 inline-flex items-center justify-center rounded-full border border-gray-300 bg-white/90 backdrop-blur shadow hover:bg-white"
          title="Open sidebar"
        >
          <span className="text-base text-gray-700">&gt;</span>
        </button>
      )}
      
      {/* Chat Interface */}
      <ChatInterface conversation={currentConversation} />
    </div>
  );
}

export default ChatView;

