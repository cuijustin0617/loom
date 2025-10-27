/**
 * React Query Configuration
 * 
 * Manages async state (API calls, background refetch, caching).
 * Limited retries to surface issues quickly.
 */

import { QueryClient } from '@tanstack/react-query';

/**
 * Query Client with custom defaults
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Caching
      staleTime: 2 * 60 * 1000, // Data fresh for 2 minutes
      gcTime: 5 * 60 * 1000,    // Keep in cache for 5 minutes (renamed from cacheTime)
      
      // Retries (limited to surface issues)
      retry: 1, // Only retry once (not 3 times)
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 3000),
      
      // Refetch behavior
      refetchOnWindowFocus: false, // Don't refetch when window regains focus
      refetchOnReconnect: true,    // Refetch when internet reconnects
      refetchOnMount: true,        // Refetch on component mount if stale
      
      // Error handling
      throwOnError: false, // Don't throw errors to Error Boundary by default
    },
    mutations: {
      // Mutations (POST/PUT/DELETE operations)
      retry: 0, // Never retry mutations automatically
      throwOnError: false,
      
      // Optimistic updates
      onError: (error, variables, context) => {
        console.error('[Mutation Error]', error);
        
        // Rollback handled by mutation-specific onError
        if (context?.rollback) {
          context.rollback();
        }
      }
    }
  }
});

/**
 * Query keys for cache invalidation
 */
export const queryKeys = {
  // Chat
  conversations: ['conversations'],
  conversation: (id) => ['conversation', id],
  messages: (conversationId) => ['messages', conversationId],
  
  // Learn
  learnSuggestions: ['learn', 'suggestions'],
  learnCourses: ['learn', 'courses'],
  learnCourse: (id) => ['learn', 'course', id],
  learnGoals: ['learn', 'goals'],
  learnOutlines: ['learn', 'outlines'],
  
  // Settings
  settings: ['settings']
};

/**
 * Error handler for queries/mutations
 * @param {Error} error - Error object
 * @returns {string} User-friendly error message
 */
export function handleQueryError(error) {
  console.error('[Query Error]', error);
  
  // Extract meaningful message
  if (error.message) {
    // Gemini API errors
    if (error.message.includes('API key')) {
      return 'Invalid API key. Please check your settings.';
    }
    if (error.message.includes('quota')) {
      return 'API quota exceeded. Please try again later.';
    }
    if (error.message.includes('permission') || error.message.includes('not allowed')) {
      return 'API access denied. Check your API key permissions.';
    }
    
    return error.message;
  }
  
  return 'An unexpected error occurred. Please try again.';
}

export default queryClient;

