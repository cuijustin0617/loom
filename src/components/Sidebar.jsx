import Logo from './Logo';
import { useEffect, useState } from 'react';
import ProfileMenu from './ProfileMenu';

const Sidebar = ({ 
  conversations, 
  currentConversationId, 
  onNewChat, 
  onSwitchConversation,
  onDeleteConversation,
  isCompact = false,
  onCollapse,
  // Explore wiring (optional)
  onExplore,
  hideExploreButton = false,
  primaryButtonLabel = 'New Chat',
  onPrimaryButton,
  hideCollapseHandle = false,
}) => {
  return (
    <div className="bg-loom-gray flex flex-col h-full relative">
      {/* Header with Logo and Explore button */}
      <div className="p-3 sm:p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <Logo />
          <div className="flex items-center gap-2">
            {!hideExploreButton && (
              <button onClick={onExplore} className="px-2.5 py-1 text-sm text-violet-600 border border-violet-600 rounded-md hover:bg-violet-600 hover:text-white transition-colors" title="Explore">
                {isCompact ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-7z"/></svg>
                ) : (
                  'Explore'
                )}
              </button>
            )}
          </div>
        </div>
        
        {/* New Chat Button */}
        <button
          onClick={onPrimaryButton || onNewChat}
          className="w-full flex items-center space-x-2 px-3 py-2 text-left text-gray-800 border border-violet-600 rounded-md hover:bg-violet-600/10 transition-colors"
          title={primaryButtonLabel}
        >
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {!isCompact && <span className="truncate">{primaryButtonLabel}</span>}
        </button>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <div className="text-gray-500 text-sm p-4 text-center">
            No conversations yet
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`group relative w-full flex items-stretch rounded-md border transition-colors ${
                  currentConversationId === conversation.id
                    ? 'bg-violet-50 border-violet-600 text-violet-700 shadow-sm'
                    : 'bg-transparent border-transparent hover:bg-violet-50 text-gray-800'
                }`}
              >
                <button
                  onClick={() => onSwitchConversation(conversation.id)}
                  className="relative flex-1 text-left p-3 rounded-md overflow-hidden"
                >
                  <div className="text-sm font-medium truncate">{conversation.title}</div>
                  {!isCompact && conversation.summary && (
                    <div className="text-xs opacity-75 mt-1 truncate">{conversation.summary}</div>
                  )}
                  {/* Right fade overlay appears on hover to emphasize the delete button and hide right-side text */}
                  <div className="pointer-events-none hidden group-hover:block absolute top-0 right-0 h-full w-12 bg-gradient-to-l from-violet-50 to-transparent" />
                </button>
                <button
                  title="Delete conversation"
                  aria-label="Delete conversation"
                  onClick={(e) => { e.stopPropagation(); onDeleteConversation(conversation.id); }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 z-10 hidden group-hover:flex p-2 rounded text-violet-500 hover:bg-violet-100 hover:text-violet-700"
                >
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2h.293l.853 10.24A2 2 0 007.14 18h5.72a2 2 0 001.994-1.76L15.707 6H16a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zm-1 6a1 1 0 112 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 112 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Profile footer */}
      <div className="border-t border-gray-200 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <ProfileMenu />
        </div>
      </div>

      {/* Middle collapse handle */}
      {!hideCollapseHandle && (
        <button
          type="button"
          onClick={onCollapse}
          title="Collapse sidebar"
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 inline-flex items-center justify-center rounded-full border border-gray-300 text-gray-600 bg-white/90 hover:bg-white shadow"
        >
          <span className="text-base">&lt;</span>
        </button>
      )}
    </div>
  );
};

export default Sidebar;
