import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence, GoogleAuthProvider, signInWithRedirect, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase App initialization using Vite env vars
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Check if Firebase config is available
const hasFirebaseConfig = firebaseConfig.apiKey && firebaseConfig.projectId;
if (!hasFirebaseConfig) {
  console.warn('Firebase config missing - running in local-only mode');
}

const app = hasFirebaseConfig ? initializeApp(firebaseConfig) : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;

// Persist sessions on this device (user preference: remember)
if (auth) {
  setPersistence(auth, browserLocalPersistence).catch(() => {});
}

// Offline persistence for Firestore (best effort; Safari private mode may fail)
if (db) {
  enableIndexedDbPersistence(db).catch(() => {});
}

export const provider = app ? new GoogleAuthProvider() : null;

export const signInWithGoogle = async () => {
  if (!auth || !provider) {
    alert('Firebase not configured. Add Firebase config to enable sign-in.');
    throw new Error('Firebase not configured');
  }
  try {
    // Prefer popup on desktop; redirect for iOS or if popup blocked
    const ua = navigator?.userAgent || '';
    const isIOS = /iP(ad|hone|od)/i.test(ua) || (navigator?.platform === 'MacIntel' && navigator?.maxTouchPoints > 1);
    if (!isIOS) {
      await signInWithPopup(auth, provider);
      return;
    }
  } catch (e) {
    // Fall back to redirect on any popup issue
  }
  await signInWithRedirect(auth, provider);
};

export const signOutUser = () => {
  if (!auth) return Promise.resolve();
  return signOut(auth);
};

export const onAuthChanged = (cb) => {
  if (!auth) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth, cb);
};

