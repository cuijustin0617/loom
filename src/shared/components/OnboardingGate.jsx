import { useEffect, useMemo, useState } from 'react';
import { auth, onAuthChanged, signInWithGoogle } from '../../services/firebase';
import { getRedirectResult } from 'firebase/auth';
import { useSettingsStore } from '../store/settingsStore';

const API_KEY_MAX_AGE_DAYS = 90;

const OnboardingGate = ({ onComplete }) => {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [redirectChecked, setRedirectChecked] = useState(false);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsub = onAuthChanged((u) => {
      setUser(u || null);
      setAuthReady(true);
    });
    // After redirect, some environments need getRedirectResult to finalize state.
    if (auth) {
      getRedirectResult(auth)
        .then((res) => { if (res?.user) setUser(res.user); })
        .catch(() => {})
        .finally(() => setRedirectChecked(true));
    } else {
      setRedirectChecked(true);
    }
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  useEffect(() => {
    setCheckingAuth(!(authReady && redirectChecked));
  }, [authReady, redirectChecked]);

  useEffect(() => {
    const apiKey = useSettingsStore.getState().apiKey || '';
    setKey(apiKey);
  }, []);

  const needsAuth = useMemo(() => !!auth && !user, [user]);
  const needsKey = useMemo(() => {
    const apiKey = useSettingsStore.getState().apiKey || '';
    return !apiKey.trim();
  }, [user]);

  const handleSaveKey = async () => {
    setError('');
    try {
      const trimmed = (key || '').trim();
      if (!trimmed) {
        setError('Please paste your Gemini API key.');
        return;
      }
      setSaving(true);
      await useSettingsStore.getState().setApiKey(trimmed);
      setSaving(false);
      if (typeof onComplete === 'function') onComplete();
    } catch (e) {
      setSaving(false);
      setError(e?.message || 'Failed to save key');
    }
  };

  useEffect(() => {
    if (!checkingAuth && !needsAuth && !needsKey) {
      if (typeof onComplete === 'function') onComplete();
    }
  }, [checkingAuth, needsAuth, needsKey, onComplete]);

  // Full-screen minimal onboarding UI
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-violet-50 via-white to-sky-50 p-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto h-14 w-14 rounded-xl border border-violet-300 bg-gradient-to-br from-violet-50 to-white flex items-center justify-center shadow-sm">
            <svg className="h-7 w-7 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l9-9 9 9"/><path d="M4 10v10a2 2 0 002 2h12a2 2 0 002-2V10"/><path d="M9 22V12h6v10"/>
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-gray-900">Welcome to Loom</h1>
          <p className="mt-1 text-gray-600">A fast, private AI chat with your own API key.</p>
        </div>

        {/* Step 1: Sign in */}
        {checkingAuth ? (
          <Card>
            <div className="animate-pulse h-6 bg-gray-200 rounded w-40" />
            <div className="mt-3 h-10 bg-gray-100 rounded" />
          </Card>
        ) : needsAuth ? (
          <Card>
            <h2 className="text-lg font-medium text-gray-900">Choose how to continue</h2>
            <p className="mt-1 text-sm text-gray-600">Sign in to sync your data across devices, or continue as guest.</p>
            <div className="mt-4 space-y-3">
              <button
                onClick={signInWithGoogle}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-800 hover:bg-gray-50 shadow-sm"
              >
                <svg className="w-5 h-5" viewBox="0 0 48 48">
                  <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.84 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
                  <path fill="#FF3D00" d="M6.306 14.691l6.571 4.814C14.655 15.108 18.961 12 24 12c3.059 0 5.84 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
                  <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.197l-6.191-5.238C29.211 35.091 26.715 36 24 36c-5.192 0-9.607-3.315-11.254-7.946l-6.54 5.036C9.5 39.556 16.227 44 24 44z"/>
                  <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.238-2.231 4.166-4.095 5.565l.003-.002 6.191 5.238C35.271 39.205 40 32.667 40 24c0-1.341-.138-2.65-.389-3.917z"/>
                </svg>
                Sign in with Google
              </button>
              
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-500">or</span>
                </div>
              </div>
              
              <button
                onClick={() => setUser({ isGuest: true })}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md border-2 border-gray-300 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50 font-medium"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
                Continue as Guest
              </button>
              
              <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
                <div className="flex gap-2">
                  <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 16v-4m0-4h.01"/>
                  </svg>
                  <div className="text-xs text-blue-800">
                    <p className="font-medium mb-1">Guest Mode:</p>
                    <ul className="list-disc list-inside space-y-0.5 ml-1">
                      <li>No account required</li>
                      <li>Data stored locally on this device only</li>
                      <li>Data will be lost if you clear browser data</li>
                      <li>Not synced across devices</li>
                    </ul>
                  </div>
                </div>
              </div>
              
              {!auth && (
                <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  Firebase is not configured; sign-in is disabled in this build.
                </p>
              )}
            </div>
          </Card>
        ) : (
          <Card>
            <h2 className="text-lg font-medium text-gray-900">Add your Gemini API key</h2>
            <p className="mt-1 text-sm text-gray-600">Paste your free key from Google AI Studio. We only store it on this device and won’t send it to our servers.</p>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700">API key</label>
              <input
                type="password"
                inputMode="text"
                autoComplete="off"
                placeholder="AIzza..."
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <a href="https://aistudio.google.com/app/api-keys" target="_blank" rel="noreferrer" className="text-violet-700 hover:underline">Get a free Gemini API key</a>
                <span className="text-xs text-gray-500">Remembered for {API_KEY_MAX_AGE_DAYS} days on this device</span>
              </div>
              {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
              <button
                onClick={handleSaveKey}
                disabled={saving}
                className="mt-4 w-full rounded-md bg-violet-600 text-white px-3 py-2 hover:bg-violet-700 disabled:opacity-50"
              >
                Save and continue
              </button>
            </div>
          </Card>
        )}

        <div className="mt-6 text-center text-xs text-gray-500">
          By using Loom you agree to the Terms and acknowledge your API usage is billed by the provider.
        </div>
      </div>
    </div>
  );
};

const Card = ({ children }) => (
  <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 sm:p-6">
    {children}
  </div>
);

export default OnboardingGate;
