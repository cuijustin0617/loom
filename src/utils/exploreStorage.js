import { db, auth } from '../services/firebase';
import { collection, doc, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';

const LS_KEYS = {
  prefs: 'explore_prefs',
  saved: 'explore_saved',
  mutes: 'explore_mutes',
  logs: 'explore_logs',
  sessions: 'explore_sessions',
  feed: 'explore_feed',
  // Bump version to avoid stale cached sessions with old formats
  session_cache: 'explore_session_cache_v2',
};

export function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.prefs) || '{}'); } catch { return {}; }
}
export function savePrefs(prefs) {
  try { localStorage.setItem(LS_KEYS.prefs, JSON.stringify(prefs || {})); } catch {}
  syncDoc('prefs', prefs).catch(() => {});
}

export function loadSaved() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.saved) || '[]'); } catch { return []; }
}
export function saveSaved(list) {
  try { localStorage.setItem(LS_KEYS.saved, JSON.stringify(list || [])); } catch {}
}

export function loadMutes() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.mutes) || '{}'); } catch { return {}; }
}
export function saveMutes(map) {
  try { localStorage.setItem(LS_KEYS.mutes, JSON.stringify(map || {})); } catch {}
}

export function appendLog(event) {
  try {
    const list = JSON.parse(localStorage.getItem(LS_KEYS.logs) || '[]');
    list.push({ ...event, ts: new Date().toISOString() });
    localStorage.setItem(LS_KEYS.logs, JSON.stringify(list.slice(-1000)));
  } catch {}
  syncAdd('logs', event).catch(() => {});
}

export function loadSessions() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.sessions) || '[]'); } catch { return []; }
}
export function saveSessions(list) {
  try { localStorage.setItem(LS_KEYS.sessions, JSON.stringify(list || [])); } catch {}
}

// Persist current Explore feed so it survives navigation
export function loadFeed() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.feed) || 'null'); } catch { return null; }
}
export function saveFeed(feed) {
  try { localStorage.setItem(LS_KEYS.feed, JSON.stringify(feed || null)); } catch {}
}

// Lightweight session content cache keyed by card id
export function getCachedSession(cardId) {
  if (!cardId) return null;
  try {
    const map = JSON.parse(localStorage.getItem(LS_KEYS.session_cache) || '{}');
    return map[cardId] || null;
  } catch {
    return null;
  }
}
export function setCachedSession(cardId, text) {
  if (!cardId || !text) return;
  try {
    const map = JSON.parse(localStorage.getItem(LS_KEYS.session_cache) || '{}');
    map[cardId] = text;
    // Keep cache bounded
    const entries = Object.entries(map);
    if (entries.length > 60) {
      // Drop oldest by insertion order approximation
      const trimmed = Object.fromEntries(entries.slice(-60));
      localStorage.setItem(LS_KEYS.session_cache, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(LS_KEYS.session_cache, JSON.stringify(map));
    }
  } catch {}
}

// Clear all cached session content (used when user explicitly refreshes Explore)
export function clearSessionCache() {
  try { localStorage.removeItem(LS_KEYS.session_cache); } catch {}
}

async function syncDoc(kind, data) {
  if (!db || !auth || !auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const ref = doc(db, 'users', uid, 'explore', kind);
  await setDoc(ref, { data, updatedAt: serverTimestamp() }, { merge: true });
}

async function syncAdd(kind, data) {
  if (!db || !auth || !auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const col = collection(db, 'users', uid, 'explore', kind, 'items');
  await addDoc(col, { ...data, createdAt: serverTimestamp() });
}
