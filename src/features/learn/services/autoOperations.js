/**
 * Auto Operations Service
 * 
 * Handles automatic background operations:
 * - Auto-refresh suggested feed when new chat summary is ready
 * - Auto-regroup when pending courses exceed threshold
 */

import { useLearnStore } from '../store/learnStore';
import { useChatStore } from '../../chat/store/chatStore';
import { useSettingsStore } from '../../../shared/store/settingsStore';
import { generateLearnProposals, regroupAllCompleted } from './learnApi';

/**
 * Auto-refresh suggested feed
 * Triggered when a new chat summary is generated
 * Uses gemini-2.5-flash for fast generation
 */
export async function autoRefreshSuggestedFeed() {
  const learnStore = useLearnStore.getState();
  const chatStore = useChatStore.getState();
  const settingsStore = useSettingsStore.getState();
  
  // Don't auto-refresh if user is on Learn page
  if (settingsStore.currentMode === 'learn') {
    console.log('[AutoOps] User is on Learn page, skipping auto-refresh');
    return;
  }
  
  // Check if already refreshing
  if (learnStore.isAutoRefreshing) {
    console.log('[AutoOps] Auto-refresh already in progress, skipping');
    return;
  }
  
  console.log('[AutoOps] Starting auto-refresh of suggested feed');
  learnStore.setAutoRefreshing(true);
  
  try {
    // Build conversations data
    const conversations = Object.values(chatStore.conversations);
    const allMessages = Object.values(chatStore.messages);
    
    const conversationsData = conversations.map(conv => {
      const messages = allMessages
        .filter(m => m.conversationId === conv.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      
      return {
        id: conv.id,
        messages,
        ...conv
      };
    });
    
    // Filter to only conversations with messages
    const conversationsWithMessages = conversationsData.filter(c => c.messages.length > 0);
    
    if (conversationsWithMessages.length === 0) {
      console.log('[AutoOps] No conversations with messages, skipping auto-refresh');
      return;
    }
    
    console.log('[AutoOps] Generating suggestions for', conversationsWithMessages.length, 'conversations');
    
    // Clear old suggestions first
    await learnStore.clearSuggestedOutlines();
    
    // Generate new suggestions using fast model (gemini-2.5-flash)
    const result = await generateLearnProposals({
      conversations: conversationsWithMessages,
      model: 'gemini-2.5-flash'
    });
    
    // Add new outlines to store
    if (result.outlines && Array.isArray(result.outlines)) {
      console.log('[AutoOps] Adding', result.outlines.length, 'new outlines');
      await learnStore.addOutlinesBatch(result.outlines);
    }
    
    console.log('[AutoOps] Auto-refresh complete');
  } catch (error) {
    console.error('[AutoOps] Auto-refresh failed:', error);
    // Don't throw - this is a background operation
  } finally {
    learnStore.setAutoRefreshing(false);
  }
}

/**
 * Auto-regroup pending courses
 * Triggered when a new course is added to pending AND there are more than 2 pending courses
 */
export async function autoRegroupPendingCourses() {
  const learnStore = useLearnStore.getState();
  
  // Check if already regrouping
  if (learnStore.isAutoRegrouping) {
    console.log('[AutoOps] Auto-regroup already in progress, skipping');
    return;
  }
  
  // Check if there are enough pending courses to regroup
  const pendingCount = learnStore.getPendingCoursesCount();
  
  if (pendingCount < 2) {
    console.log('[AutoOps] Not enough pending courses to regroup (need at least 2, have', pendingCount, ')');
    return;
  }
  
  console.log('[AutoOps] Starting auto-regroup for', pendingCount, 'pending courses');
  learnStore.setAutoRegrouping(true);
  
  try {
    const result = await regroupAllCompleted();
    console.log('[AutoOps] Auto-regroup complete:', result);
  } catch (error) {
    console.error('[AutoOps] Auto-regroup failed:', error);
    // Don't throw - this is a background operation
  } finally {
    learnStore.setAutoRegrouping(false);
  }
}

/**
 * Check if auto-regroup should be triggered
 * @returns {boolean}
 */
export function shouldTriggerAutoRegroup() {
  const learnStore = useLearnStore.getState();
  const pendingCount = learnStore.getPendingCoursesCount();
  return pendingCount >= 2 && !learnStore.isAutoRegrouping;
}






