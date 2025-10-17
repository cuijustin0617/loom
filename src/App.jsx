import { useEffect, useState, useRef } from 'react';
import { useConversations } from './hooks/useConversations';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import ExploreView from './components/ExploreView';
import OnboardingGate from './components/OnboardingGate';

function App() {
  // Always pass through the onboarding gate once; it will auto-complete
  // when login + API key requirements are already satisfied.
  const [needsGate, setNeedsGate] = useState(true);
  // Sidebar collapse state (fixed width, no resize)
  const SIDEBAR_WIDTH = 256; // px
  const MIN_CHAT_WIDTH = 560; // px, below this auto-collapse
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('loom_sidebar_collapsed') === '1');
  const autoCollapsedRef = useRef(false);
  const [exploreActive, setExploreActive] = useState(false);

  useEffect(() => {
    localStorage.setItem('loom_sidebar_collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  const toggleCollapse = () => {
    setSidebarCollapsed((v) => !v);
    // manual action cancels auto mode until next resize forces it again
    autoCollapsedRef.current = false;
  };
  const reopenSidebar = () => {
    setSidebarCollapsed(false);
    autoCollapsedRef.current = false;
  };

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

  const {
    conversations,
    currentConversationId,
    selectedModel,
    isLoading,
    getCurrentConversation,
    createNewConversation,
    switchToConversation,
    sendMessage,
    setSelectedModel,
    deleteConversation,
  } = useConversations();

  // Create first conversation if none exists
  useEffect(() => {
    if (conversations.length === 0 && !currentConversationId) {
      createNewConversation();
    }
  }, [conversations.length, currentConversationId, createNewConversation]);

  const handleNewChat = () => {
    createNewConversation();
  };

  const handleSwitchConversation = (conversationId) => {
    switchToConversation(conversationId);
  };

  const handleSendMessage = (content) => {
    // Create new conversation if none exists
    if (!currentConversationId) {
      const newId = createNewConversation();
      // Wait for next tick to ensure conversation is created
      setTimeout(() => sendMessage(content), 0);
    } else {
      sendMessage(content);
    }
  };

  const currentConversation = getCurrentConversation();

  if (needsGate) {
    return <OnboardingGate onComplete={() => setNeedsGate(false)} />;
  }

  if (exploreActive) {
    return (
      <ExploreView
        conversations={conversations}
        onExitExplore={() => setExploreActive(false)}
      />
    );
  }

  return (
    <div className="flex h-screen bg-white relative">
      {/* Sidebar (fixed width, collapsible) */}
      {!sidebarCollapsed && (
        <div className="h-full border-r border-gray-200 bg-loom-gray select-none" style={{ width: SIDEBAR_WIDTH }}>
          <Sidebar 
            conversations={conversations}
            currentConversationId={currentConversationId}
            onNewChat={handleNewChat}
            onSwitchConversation={handleSwitchConversation}
            onDeleteConversation={deleteConversation}
            isCompact={false}
            onCollapse={toggleCollapse}
            onExplore={() => setExploreActive(true)}
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

      <ChatInterface
        conversation={currentConversation}
        isLoading={isLoading}
        onSendMessage={handleSendMessage}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
      />
    </div>
  );
}

export default App;
