const LS_KEY = 'learn_debug_v1';

export function loadDebugLogs() {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v ? JSON.parse(v) : [];
  } catch {
    return [];
  }
}

export function clearDebugLogs() {
  try { localStorage.removeItem(LS_KEY); } catch {}
}

export function appendDebugLog(entry) {
  try {
    const list = loadDebugLogs();
    const now = new Date().toISOString();
    const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const item = { id, ts: now, ...sanitizeEntry(entry) };
    const next = [...list, item].slice(-200);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    return item;
  } catch {
    return null;
  }
}

function ensureString(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  try { return JSON.stringify(x, null, 2); } catch { return String(x); }
}

function sanitizeEntry(e) {
  const out = { ...e };
  if ('prompt' in out) out.prompt = ensureString(out.prompt);
  if ('response' in out) out.response = ensureString(out.response);
  if ('error' in out) out.error = ensureString(out.error);
  if ('messages' in out) out.messages = ensureString(out.messages);
  return out;
}

