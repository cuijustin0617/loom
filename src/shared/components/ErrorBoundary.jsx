/**
 * Error Boundary
 * 
 * Catches React errors and provides recovery options.
 */

import { Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleResetApiKey = async () => {
    // Clear API key and reload
    try {
      const { useSettingsStore } = await import('../store/settingsStore');
      await useSettingsStore.getState().setApiKey('');
      window.location.reload();
    } catch (err) {
      console.error('Failed to reset API key:', err);
      window.location.reload();
    }
  };

  isApiKeyError = () => {
    const errorMessage = this.state.error?.message || '';
    return /api[_\s]?key|credential|authorization|authentication|invalid.*key|missing.*key/i.test(errorMessage);
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
          <div className="max-w-md w-full">
            <div className="bg-white rounded-lg shadow-lg p-6 border border-red-200">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
                  <p className="text-sm text-gray-600">The app encountered an unexpected error</p>
                </div>
              </div>
              
              {this.state.error && (
                <div className="mb-4 p-3 bg-gray-50 rounded-md border border-gray-200">
                  <p className="text-sm font-mono text-red-600 break-all">
                    {this.state.error.toString()}
                  </p>
                </div>
              )}
              
              <div className="flex gap-3">
                {this.isApiKeyError() ? (
                  <>
                    <button
                      onClick={this.handleResetApiKey}
                      className="flex-1 px-4 py-2 bg-violet-600 text-white rounded-md hover:bg-violet-700 transition-colors"
                    >
                      Re-enter API Key
                    </button>
                    <button
                      onClick={() => window.location.reload()}
                      className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      Reload App
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={this.handleReset}
                      className="flex-1 px-4 py-2 bg-violet-600 text-white rounded-md hover:bg-violet-700 transition-colors"
                    >
                      Try Again
                    </button>
                    <button
                      onClick={() => window.location.reload()}
                      className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      Reload App
                    </button>
                  </>
                )}
              </div>
              
              {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
                <details className="mt-4">
                  <summary className="text-sm text-gray-600 cursor-pointer">
                    Stack Trace (Development Only)
                  </summary>
                  <pre className="mt-2 p-3 bg-gray-900 text-gray-100 rounded-md text-xs overflow-auto max-h-48">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

