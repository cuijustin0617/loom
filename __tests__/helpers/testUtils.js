/**
 * Test Utilities
 * 
 * Helper functions for setting up and tearing down tests
 */

import { act } from '@testing-library/react';
import db, { generateId, now } from '../../src/lib/db/database';
import { useChatStore, initializeChat } from '../../src/features/chat/store/chatStore';
import { useLearnStore, initializeLearn } from '../../src/features/learn/store/learnStore';
import { useSettingsStore, initializeSettings } from '../../src/shared/store/settingsStore';

/**
 * Reset all IndexedDB databases
 */
export async function resetDatabase() {
  // Close all connections
  if (db.isOpen()) {
    db.close();
  }
  
  // Delete the database
  await db.delete();
  
  // Reopen with fresh instance
  await db.open();
}

/**
 * Reset all Zustand stores
 */
export function resetStores() {
  // Reset chat store
  useChatStore.setState({
    conversations: {},
    messages: {},
    isLoading: false,
  });
  
  // Reset learn store
  useLearnStore.setState({
    courses: {},
    modules: {},
    goals: {},
    outlines: {},
    goalCourses: {},
    activeCourseId: null,
    generatingCourseIds: {},
  });
  
  // Reset settings store
  useSettingsStore.setState({
    apiKey: '',
    openaiApiKey: '',
    selectedModel: 'gemini-2.5-flash-lite',
    learnModel: 'gemini-2.5-flash-lite',
    currentConversationId: null,
    useE2EE: false,
    passphrase: null,
    isLoaded: false,
  });
}

/**
 * Initialize all stores (simulates app startup)
 */
export async function initializeStores() {
  await act(async () => {
    await Promise.all([
      initializeSettings(),
      initializeChat(),
      initializeLearn()
    ]);
  });
}

/**
 * Simulate app reload - clear stores but keep database
 */
export async function reloadApp() {
  await act(async () => {
    resetStores();
  });
  await initializeStores();
}

/**
 * Full cleanup - clear stores only (for simulating reload in tests)
 * NOTE: This does NOT clear the database - use fullReset() for that
 */
export async function fullCleanup() {
  await act(async () => {
    resetStores();
  });
}

/**
 * Full reset - clear everything including database (for test setup)
 */
export async function fullReset() {
  await act(async () => {
    resetStores();
    await resetDatabase();
  });
}

/**
 * Setup test environment with API key
 */
export async function setupTestEnvironment(apiKey = process.env.VITE_GEMINI_API_KEY) {
  await fullReset();
  
  // Set API key and models in settings
  if (apiKey) {
    const settingsStore = useSettingsStore.getState();
    await settingsStore.setApiKey(apiKey);
    await settingsStore.setSelectedModel('gemini-2.5-flash-lite');
    await settingsStore.setLearnModel('gemini-2.5-flash-lite');
  }
  
  await initializeStores();
}

/**
 * Create a test conversation with messages
 */
export async function createTestConversation(messageCount = 3) {
  const chatStore = useChatStore.getState();
  const conversationId = await chatStore.createConversation();
  
  // Add test messages
  for (let i = 0; i < messageCount; i++) {
    await chatStore.addMessage(conversationId, {
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Test message ${i + 1}`,
    });
  }
  
  return conversationId;
}

/**
 * Create a test outline
 */
export async function createTestOutline(overrides = {}) {
  const outline = {
    id: generateId('outline'),
    courseId: generateId('course'),
    title: 'Test Course',
    goal: 'Test Goal',
    status: 'suggested',
    summary: 'Test course summary',
    questions: ['Q1', 'Q2', 'Q3'],
    moduleSummary: [
      { title: 'Module 1', estMinutes: 5 },
      { title: 'Module 2', estMinutes: 5 },
    ],
    createdAt: now(),
    ...overrides
  };
  
  await useLearnStore.getState().addOutline(outline);
  return outline;
}

/**
 * Create a test course with modules
 */
export async function createTestCourse(overrides = {}) {
  const courseId = generateId('course');
  const moduleIds = [generateId('mod'), generateId('mod')];
  
  const course = {
    id: courseId,
    title: 'Test Course',
    goal: 'Test Goal',
    questionIds: ['Q1', 'Q2'],
    moduleIds,
    whereToGoNext: 'Next steps here',
    status: 'started',
    progressByModule: {},
    completedVia: null,
    createdAt: now(),
    completedAt: null,
    ...overrides
  };
  
  const modules = [
    {
      id: moduleIds[0],
      courseId,
      idx: 0,
      title: 'Module 1',
      estMinutes: 5,
      lesson: '# Module 1 Content',
      microTask: 'Complete task 1',
      quiz: [
        {
          question: 'Test question 1?',
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 0,
          explanation: 'A is correct'
        }
      ],
      refs: []
    },
    {
      id: moduleIds[1],
      courseId,
      idx: 1,
      title: 'Module 2',
      estMinutes: 5,
      lesson: '# Module 2 Content',
      microTask: 'Complete task 2',
      quiz: [],
      refs: []
    }
  ];
  
  await useLearnStore.getState().saveCourse({ ...course, modules });
  return { course, modules };
}

/**
 * Wait for async operations to complete
 */
export async function waitFor(condition, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timeout waiting for condition');
}

/**
 * Generate mock conversation data for Learn mode
 */
export function generateMockConversations(count = 2) {
  return Array.from({ length: count }, (_, i) => ({
    id: generateId('conv'),
    title: `Conversation ${i + 1}`,
    summary: `This is a test conversation about topic ${i + 1}`,
    messages: [
      {
        role: 'user',
        content: `Tell me about topic ${i + 1}`,
        createdAt: now()
      },
      {
        role: 'assistant',
        content: `Here's information about topic ${i + 1}...`,
        createdAt: now()
      }
    ],
    createdAt: now(),
    updatedAt: now()
  }));
}

export { generateId, now };

