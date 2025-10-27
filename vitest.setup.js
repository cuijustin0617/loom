/**
 * Vitest Setup File
 * 
 * Global test configuration and setup
 */

import { expect, afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Global test environment setup
beforeEach(() => {
  // Reset any global state if needed
});

// Extend matchers
expect.extend({});

// Mock window.matchMedia (not available in jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Suppress console errors during tests (unless needed for debugging)
const originalError = console.error;
beforeEach(() => {
  console.error = (...args) => {
    // Filter out known harmless errors
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Not implemented: HTMLFormElement.prototype.submit') ||
       args[0].includes('Could not parse CSS stylesheet'))
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterEach(() => {
  console.error = originalError;
});

