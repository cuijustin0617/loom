const te = new TextEncoder();
const td = new TextDecoder();

const toUint8 = (arr) => (arr instanceof Uint8Array ? arr : new Uint8Array(arr));

export async function deriveKeyFromPassphrase(passphrase, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    te.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toUint8(salt), iterations: 120000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJSON(passphrase, object) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKeyFromPassphrase(passphrase, salt);
  const plaintext = te.encode(JSON.stringify(object));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    salt: Array.from(salt),
    iv: Array.from(iv),
    ct: Array.from(new Uint8Array(ciphertext)),
  };
}

export async function decryptJSON(passphrase, payload) {
  const { salt, iv, ct } = payload || {};
  if (!salt || !iv || !ct) throw new Error('Invalid ciphertext payload');
  const key = await deriveKeyFromPassphrase(passphrase, new Uint8Array(salt));
  const buf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    new Uint8Array(ct)
  );
  return JSON.parse(td.decode(buf));
}


