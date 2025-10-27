/**
 * Learn Operations Hook
 * 
 * Wraps Learn operations with React Query for caching and error handling.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLearnStore } from '../store/learnStore';
import { useChatStore } from '../../chat/store/chatStore';
import { useSettingsStore } from '../../../shared/store/settingsStore';
import { queryKeys } from '../../../lib/queryClient';
import { 
  generateLearnProposals, 
  generateFullCourse,
  regroupAllCompleted,
  markOutlineStatus
} from '../services/learnApi';

export function useLearnOperations() {
  const queryClient = useQueryClient();
  
  const addOutline = useLearnStore(state => state.addOutline);
  const addOutlinesBatch = useLearnStore(state => state.addOutlinesBatch);
  const updateOutlineStatus = useLearnStore(state => state.updateOutlineStatus);
  const startCourse = useLearnStore(state => state.startCourse);
  const saveCourse = useLearnStore(state => state.saveCourse);
  const updateCourseStatus = useLearnStore(state => state.updateCourseStatus);
  const setGenerating = useLearnStore(state => state.setGenerating);
  const isGenerating = useLearnStore(state => state.isGenerating);
  
  const conversations = useChatStore(state => state.conversations);
  const allMessages = useChatStore(state => state.messages);
  
  // Compute conversation IDs (no longer a getter in store)
  const conversationIds = Object.values(conversations)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(c => c.id);
  
  // Helper to get messages for a conversation
  const getConversationMessages = (conversationId) => {
    const msgs = Object.values(allMessages);
    return msgs
      .filter(m => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  };
  
  const learnModel = useSettingsStore(state => state.learnModel);
  
  /**
   * Generate suggestions query
   */
  const {
    data: suggestions,
    isLoading,
    isFetching,
    refetch: refetchSuggestions,
    error: suggestionsError
  } = useQuery({
    queryKey: queryKeys.learnSuggestions,
    queryFn: async () => {
      console.log('[LearnOperations] Query function called!');
      
      // Clear old suggestions first (while in loading state)
      const clearSuggestedOutlines = useLearnStore.getState().clearSuggestedOutlines;
      await clearSuggestedOutlines();
      console.log('[LearnOperations] Cleared old suggestions');
      
      // Build conversations data
      const conversationsData = conversationIds.map(id => {
        const messages = getConversationMessages(id);
        console.log('[LearnOperations] Conversation', id, 'has', messages.length, 'messages');
        return {
          id,
          messages,
          ...conversations[id]
        };
      });
      
      console.log('[LearnOperations] Built conversations data:', conversationsData.length, 'conversations');
      console.log('[LearnOperations] Total messages across all conversations:', 
        conversationsData.reduce((sum, c) => sum + c.messages.length, 0));
      console.log('[LearnOperations] Calling generateLearnProposals...');
      
      const result = await generateLearnProposals({ 
        conversations: conversationsData,
        model: learnModel
      });
      
      console.log('[LearnOperations] Got result:', result);
      
      // Add outlines to store
      if (result.outlines && Array.isArray(result.outlines)) {
        console.log('[LearnOperations] Adding', result.outlines.length, 'outlines to store');
        for (const outline of result.outlines) {
          await addOutline(outline);
        }
        console.log('[LearnOperations] All outlines added, current store state:',
          Object.keys(useLearnStore.getState().outlines).length, 'outlines');
      } else {
        console.log('[LearnOperations] No outlines in result');
      }
      
      return result;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: false // Only run when explicitly called
  });
  
  /**
   * Start course mutation
   */
  const startCourseMutation = useMutation({
    mutationFn: async ({ outlineId }) => {
      // Check if already generating
      const outline = useLearnStore.getState().outlines[outlineId];
      if (!outline) throw new Error('Outline not found');
      
      const courseId = outline.courseId;
      if (isGenerating(courseId)) {
        throw new Error('Course is already being generated');
      }
      
      // Start course (atomic operation)
      const result = await startCourse(outlineId);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to start course');
      }
      
      // If needs generation, generate now
      if (result.needsGeneration) {
        setGenerating(courseId, true);
        
        try {
          // Build conversations data
          const conversationsData = conversationIds.map(id => ({
            id,
            messages: getConversationMessages(id),
            ...conversations[id]
          }));
          
          const courseData = await generateFullCourse({
            outline,
            conversations: conversationsData,
            model: learnModel
          });
          
          // Save course to store
          const saveResult = await saveCourse(courseData);
          if (!saveResult.success) {
            throw new Error(saveResult.error || 'Failed to save course');
          }
          
          return { courseId, generated: true };
        } catch (error) {
          // Rollback on error
          await updateOutlineStatus(outlineId, 'suggested');
          throw error;
        } finally {
          setGenerating(courseId, false);
        }
      }
      
      return { courseId: result.courseId, generated: false };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.learnCourses });
      queryClient.invalidateQueries({ queryKey: queryKeys.learnOutlines });
    },
    onError: (error) => {
      console.error('[Learn] Start course failed:', error);
    }
  });
  
  /**
   * Update outline status (save, dismiss, already know)
   */
  const updateOutlineMutation = useMutation({
    mutationFn: async ({ outlineId, status, action }) => {
      await markOutlineStatus(outlineId, status, action);
      return { outlineId, status };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.learnOutlines });
      queryClient.invalidateQueries({ queryKey: queryKeys.learnCourses }); // Needed when save/already_know creates courses
    }
  });
  
  /**
   * Regroup completed courses
   */
  const regroupMutation = useMutation({
    mutationFn: async () => {
      const result = await regroupAllCompleted();
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.learnGoals });
      queryClient.invalidateQueries({ queryKey: queryKeys.learnCourses });
    }
  });
  
  /**
   * Helper functions
   */
  const handleStartCourse = async (outlineId) => {
    return await startCourseMutation.mutateAsync({ outlineId });
  };
  
  const handleSaveOutline = async (outlineId) => {
    return await updateOutlineMutation.mutateAsync({ 
      outlineId, 
      status: 'saved',
      action: 'save'
    });
  };
  
  const handleDismissOutline = async (outlineId) => {
    return await updateOutlineMutation.mutateAsync({ 
      outlineId, 
      status: 'dismissed',
      action: 'dismiss'
    });
  };
  
  const handleAlreadyKnow = async (outlineId) => {
    return await updateOutlineMutation.mutateAsync({ 
      outlineId, 
      status: 'completed',
      action: 'already_know'
    });
  };
  
  const handleRegroup = async () => {
    return await regroupMutation.mutateAsync();
  };
  
  const handleRefreshSuggestions = async () => {
    // Prevent double-click
    if (isFetching || isLoading) {
      console.log('[LearnOperations] Already loading, ignoring refresh request');
      return;
    }
    
    console.log('[LearnOperations] Refreshing suggestions...');
    console.log('[LearnOperations] Conversations count:', conversationIds.length);
    
    // Refetch will clear old suggestions and generate new ones (inside queryFn)
    const result = await refetchSuggestions();
    console.log('[LearnOperations] Refresh complete');
    return result;
  };
  
  return {
    // Queries
    suggestions,
    isLoadingSuggestions: isLoading || isFetching,
    suggestionsError,
    
    // Mutations
    handleStartCourse,
    handleSaveOutline,
    handleDismissOutline,
    handleAlreadyKnow,
    handleRegroup,
    handleRefreshSuggestions,
    
    // Loading states
    isStartingCourse: startCourseMutation.isPending,
    isRegrouping: regroupMutation.isPending
  };
}

