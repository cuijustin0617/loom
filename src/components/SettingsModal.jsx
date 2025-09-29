import { useEffect, useState } from 'react';
import { loadSettings, saveSettings, API_KEY_MAX_AGE_DAYS } from '../utils/storage';

const SettingsModal = ({ open, onClose }) => {
  const [key, setKey] = useState('');
  const [pass, setPass] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const s = loadSettings() || {};
    setKey(s.byokGeminiKey || '');
    setPass(s.e2eePassphrase || '');
  }, [open]);

  const save = () => {
    setSaving(true);
    saveSettings({ byokGeminiKey: key, e2eePassphrase: pass });
    // Refresh freshness timestamp even if the key didn't change
    saveSettings({ byokGeminiKeyUpdatedAt: Date.now() });
    setSaving(false);
    onClose?.();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-xl p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Settings</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100" aria-label="Close settings">
            <svg className="w-5 h-5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Gemini API key</label>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste your key"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
              <a href="https://aistudio.google.com/app/api-keys" target="_blank" rel="noreferrer" className="text-violet-700 hover:underline">Get a free Gemini key</a>
              <span>Remembered for {API_KEY_MAX_AGE_DAYS} days on this device</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">End‑to‑end passphrase (optional)</label>
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="Set a passphrase to encrypt cloud sync"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="mt-1 text-xs text-gray-500">When set, messages you sync to the cloud are encrypted on your device with this passphrase. Keep it safe; we can’t recover it.</p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-md border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-3 py-2 rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">Save</button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
