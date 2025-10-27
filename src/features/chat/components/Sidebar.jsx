/**
 * Chat Sidebar
 * 
 * Shows conversation list with summaries, new chat button, and profile menu.
 */

import { useState } from 'react';
import { useChatStore } from '../store/chatStore';
import { useSettingsStore } from '../../../shared/store/settingsStore';
import { useChatOperations } from '../hooks/useChatOperations';
import ProfileMenu from '../../../shared/components/ProfileMenu';
import Logo from '../../../shared/components/Logo';

function Sidebar({ conversationIds, currentConversationId, onCollapse }) {
  const conversations = useChatStore(state => state.conversations);
  const { handleNewConversation, handleSwitchConversation, handleDeleteConversation } = useChatOperations();
  const [deletingId, setDeletingId] = useState(null);
  
  const handleDelete = async (e, conversationId) => {
    e.stopPropagation();
    
    if (!window.confirm('Delete this conversation?')) return;
    
    setDeletingId(conversationId);
    try {
      await handleDeleteConversation(conversationId);
    } catch (error) {
      console.error('[Sidebar] Delete failed:', error);
      alert('Failed to delete conversation');
    } finally {
      setDeletingId(null);
    }
  };
  
  return (
    <div className="h-full flex flex-col bg-loom-gray">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <Logo />
        <button
          onClick={onCollapse}
          className="p-2 rounded-full hover:bg-gray-200 text-gray-600"
          title="Collapse sidebar"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
      </div>
      
      {/* New Chat Button */}
      <div className="p-3 border-b border-gray-200">
        <button
          onClick={handleNewConversation}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors font-medium"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New Chat
        </button>
      </div>
      
      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto">
        {conversationIds.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            No conversations yet
          </div>
        ) : (
          <div className="p-2">
            {conversationIds.map(id => {
              const conversation = conversations[id];
              if (!conversation) return null;
              
              const isActive = id === currentConversationId;
              const isDeleting = id === deletingId;
              
              return (
                <div
                  key={id}
                  onClick={() => !isDeleting && handleSwitchConversation(id)}
                  className={`w-full group relative flex items-start gap-3 p-3 rounded-lg mb-1 transition-colors cursor-pointer ${
                    isActive 
                      ? 'bg-violet-100 border border-violet-200' 
                      : 'hover:bg-gray-100 border border-transparent'
                  } ${isDeleting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {/* Conversation Icon */}
                  <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                    isActive ? 'bg-violet-200' : 'bg-gray-200'
                  }`}>
                    <svg className={`w-4 h-4 ${isActive ? 'text-violet-700' : 'text-gray-600'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                    </svg>
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium text-sm mb-0.5 truncate ${
                      isActive ? 'text-violet-900' : 'text-gray-900'
                    }`}>
                      {conversation.title || 'New Chat'}
                    </div>
                    
                    {conversation.summary && (
                      <div className="text-xs text-gray-500 line-clamp-2">
                        {conversation.summary}
                      </div>
                    )}
                    
                    {!conversation.summary && (
                      <div className="text-xs text-gray-400 italic">
                        No summary yet
                      </div>
                    )}
                  </div>
                  
                  {/* Delete Button */}
                  {!isDeleting && (
                    <button
                      onClick={(e) => handleDelete(e, id)}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-red-100 text-gray-400 hover:text-red-600 transition-all"
                      title="Delete conversation"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                      </svg>
                    </button>
                  )}
                  
                  {isDeleting && (
                    <div className="flex-shrink-0 w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {/* Profile Menu at Bottom */}
      <div className="mt-auto border-t border-gray-200 p-3">
        <ProfileMenu />
      </div>
    </div>
  );
}

export default Sidebar;

