/**
 * App.jsx - Main Application Entry Point
 * 
 * Initializes database, runs migration, and manages app-level state.
 */

import { useEffect, useState, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import queryClient from './lib/queryClient';
import ErrorBoundary from './shared/components/ErrorBoundary';
import { runMigration, getMigrationStatus } from './lib/db/migration';
import { initializeSettings, useSettingsStore } from './shared/store/settingsStore';
import { initializeChat, useChatStore } from './features/chat/store/chatStore';
import { initializeLearn } from './features/learn/store/learnStore';
import OnboardingGate from './shared/components/OnboardingGate';
import ModeToggle from './shared/components/ModeToggle';

// Lazy load features for code splitting
import { lazy } from 'react';
const ChatView = lazy(() => import('./features/chat/components/ChatView'));
const LearnView = lazy(() => import('./features/learn/components/LearnView'));

/**
 * Loading spinner component
 */
function LoadingSpinner({ message = 'Loading...' }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="inline-block w-12 h-12 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin mb-4"></div>
        <p className="text-gray-600">{message}</p>
      </div>
    </div>
  );
}

/**
 * Main App Component
 */
function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(true);
  
  // Use mode from settings store as source of truth
  const mode = useSettingsStore(state => state.currentMode);
  const setCurrentMode = useSettingsStore(state => state.setCurrentMode);
  
  // Initialize on mount
  useEffect(() => {
    async function initialize() {
      try {
        console.log('[App] Starting initialization...');
        
        // Step 1: Run migration if needed
        const migrationStatus = getMigrationStatus();
        if (!migrationStatus.complete && migrationStatus.hasOldData) {
          console.log('[App] Running migration from localStorage...');
          const result = await runMigration();
          
          if (!result.success) {
            throw new Error(`Migration failed: ${result.error}`);
          }
          
          console.log('[App] Migration completed:', result.stats);
        } else if (migrationStatus.complete) {
          console.log('[App] Migration already completed, skipping');
        } else {
          console.log('[App] No old data found, skipping migration');
        }
        
        // Step 2: Initialize stores
        console.log('[App] Initializing stores...');
        await Promise.all([
          initializeSettings(),
          initializeChat(),
          initializeLearn()
        ]);
        
        console.log('[App] Initialization complete');
        setIsInitialized(true);
      } catch (error) {
        console.error('[App] Initialization failed:', error);
        setInitError(error.message || 'Failed to initialize app');
      }
    }
    
    initialize();
  }, []);
  
  // Check if onboarding is needed
  const apiKey = useSettingsStore(state => state.apiKey);
  const isSettingsLoaded = useSettingsStore(state => state.isLoaded);
  
  useEffect(() => {
    if (isSettingsLoaded) {
      // Auto-complete onboarding if API key exists
      if (apiKey && apiKey.trim()) {
        setNeedsOnboarding(false);
      }
    }
  }, [apiKey, isSettingsLoaded]);
  
  // Show loading during initialization
  if (!isInitialized) {
    if (initError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-white px-4">
          <div className="max-w-md w-full bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-900 mb-2">Initialization Failed</h2>
            <p className="text-sm text-red-700 mb-4">{initError}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    
    return <LoadingSpinner message="Initializing app..." />;
  }
  
  // Show onboarding gate if needed
  if (needsOnboarding) {
    return <OnboardingGate onComplete={() => setNeedsOnboarding(false)} />;
  }
  
  // Handler for mode changes
  const handleModeChange = (newMode) => {
    setCurrentMode(newMode);
  };
  
  // Main app UI
  return (
    <div className="h-screen w-screen overflow-hidden">
      {/* Global mode toggle - serves as title/brand */}
      <div className="fixed top-3 left-2 z-50">
        <ModeToggle 
          mode={mode} 
          onChange={handleModeChange}
        />
      </div>
      
      {/* Feature views */}
      <Suspense fallback={<LoadingSpinner message="Loading view..." />}>
        {mode === 'chat' ? <ChatView /> : <LearnView />}
      </Suspense>
    </div>
  );
}

/**
 * App wrapper with providers and error boundary
 */
function AppWrapper() {
  return (
    <ErrorBoundary onReset={() => queryClient.clear()}>
      <QueryClientProvider client={queryClient}>
        <App />
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default AppWrapper;

