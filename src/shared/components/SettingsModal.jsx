import { useEffect, useState } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { onAuthChanged, db } from '../../services/firebase';
import { collection, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import { decryptJSON, encryptJSON } from '../utils/crypto';

const API_KEY_MAX_AGE_DAYS = 90;

const SettingsModal = ({ open, onClose }) => {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);

  // Passphrase change state
  const [user, setUser] = useState(null);
  const [hasExistingPass, setHasExistingPass] = useState(false);
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [migrateTotal, setMigrateTotal] = useState(0);
  const [migrateDone, setMigrateDone] = useState(0);
  const [migrateError, setMigrateError] = useState('');

  useEffect(() => {
    if (!open) return;
    const apiKey = useSettingsStore.getState().apiKey || '';
    const passphrase = useSettingsStore.getState().e2eePassphrase || '';
    setKey(apiKey);
    setHasExistingPass(!!passphrase.trim());
  }, [open]);

  useEffect(() => {
    const unsub = onAuthChanged(setUser);
    return () => unsub && unsub();
  }, []);

  const save = async () => {
    setSaving(true);
    // Update API key in store
    await useSettingsStore.getState().setApiKey(key);
    setSaving(false);
    onClose?.();
  };

  const reencryptAll = async () => {
    setMigrateError('');
    if (!newPass || newPass !== confirmPass) {
      setMigrateError('New passphrases do not match.');
      return;
    }
    if (!currentPass && hasExistingPass) {
      setMigrateError('Enter your current passphrase.');
      return;
    }
    // If not signed in or db missing, we can only update local passphrase
    if (!user || !db) {
      await useSettingsStore.getState().setE2EEPassphrase(newPass);
      setHasExistingPass(true);
      setCurrentPass(''); setNewPass(''); setConfirmPass('');
      onClose?.();
      return;
    }

    try {
      setMigrating(true);
      setMigrateTotal(0);
      setMigrateDone(0);
      // 1) List conversations
      const convsRef = collection(db, 'users', user.uid, 'conversations');
      const convsSnap = await getDocs(convsRef);

      // First pass: count total messages and verify current pass using first payload
      let firstPayload = null;
      let total = 0;
      for (const conv of convsSnap.docs) {
        const msgsRef = collection(db, 'users', user.uid, 'conversations', conv.id, 'messages');
        const msgsSnap = await getDocs(msgsRef);
        total += msgsSnap.size;
        if (!firstPayload) {
          const d = msgsSnap.docs[0];
          firstPayload = d?.data()?.contentCiphertext || null;
        }
      }
      setMigrateTotal(total);

      if (hasExistingPass && firstPayload) {
        // Verify current pass quickly
        try { await decryptJSON(currentPass, firstPayload); }
        catch { throw new Error('Current passphrase is incorrect.'); }
      }

      // 2) Re-encrypt each message
      let done = 0;
      for (const conv of convsSnap.docs) {
        const msgsRef = collection(db, 'users', user.uid, 'conversations', conv.id, 'messages');
        const msgsSnap = await getDocs(msgsRef);
        for (const m of msgsSnap.docs) {
          const data = m.data() || {};
          const payload = data.contentCiphertext;
          if (!payload) { done += 1; setMigrateDone(done); continue; }
          let decrypted;
          try {
            if (hasExistingPass) {
              decrypted = await decryptJSON(currentPass, payload);
            } else {
              // No old passphrase in use; skip this message (it may be local-only)
              done += 1; setMigrateDone(done); continue;
            }
          } catch {
            throw new Error('Failed to decrypt a message. Current passphrase may be incorrect.');
          }
          const newPayload = await encryptJSON(newPass, decrypted);
          await updateDoc(m.ref, {
            contentCiphertext: newPayload,
            updatedAt: serverTimestamp(),
          });
          done += 1;
          setMigrateDone(done);
        }
      }

      // 3) Save the new pass locally
      await useSettingsStore.getState().setE2EEPassphrase(newPass);
      setHasExistingPass(true);
      setCurrentPass(''); setNewPass(''); setConfirmPass('');
      setMigrating(false);
      onClose?.();
    } catch (e) {
      setMigrating(false);
      setMigrateError(e?.message || 'Re-encryption failed.');
    }
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

        <div className="mt-4 space-y-6">
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
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">End‑to‑end encryption</label>
              {migrating && (
                <span className="text-xs text-gray-500">{migrateDone}/{migrateTotal}</span>
              )}
            </div>
            {hasExistingPass ? (
              <div className="mt-2 space-y-2">
                <input
                  type="password"
                  value={currentPass}
                  onChange={(e) => setCurrentPass(e.target.value)}
                  placeholder="Current passphrase"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <input
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  placeholder="New passphrase"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <input
                  type="password"
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  placeholder="Confirm new passphrase"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                {migrateError && <div className="text-sm text-red-600">{migrateError}</div>}
                <button
                  onClick={reencryptAll}
                  disabled={migrating}
                  className="w-full rounded-md bg-violet-600 text-white px-3 py-2 hover:bg-violet-700 disabled:opacity-50"
                >
                  {migrating ? 'Re‑encrypting…' : 'Re‑encrypt and save'}
                </button>
                <p className="text-xs text-gray-500">We will decrypt all your cloud-synced messages with your current passphrase and re-encrypt them with the new one. Keep the new passphrase safe; we can’t recover it.</p>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <input
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  placeholder="Set a passphrase to enable encrypted sync"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                {migrateError && <div className="text-sm text-red-600">{migrateError}</div>}
                <button
                  onClick={reencryptAll}
                  className="w-full rounded-md bg-violet-600 text-white px-3 py-2 hover:bg-violet-700"
                >
                  Save passphrase
                </button>
                <p className="text-xs text-gray-500">Cloud messages created after setting a passphrase will be encrypted on your device before syncing.</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-md border border-gray-300 bg-white hover:bg-gray-50">Close</button>
          <button onClick={save} disabled={saving} className="px-3 py-2 rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">Save key</button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
