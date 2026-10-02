// ============================================================
// Auth Module
// Firebase Authentication: login, register, sign out,
// password reset, persistent session management
// ============================================================
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail,
  setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { ensureUserProfile } from "../firebase/firestore-service.js";

let _auth = null;

export function initAuth(app) {
  _auth = getAuth(app);
  // Ensure sessions persist across browser restarts
  setPersistence(_auth, browserLocalPersistence).catch(() => {});
  return _auth;
}

export function getAuthInstance() { return _auth; }

export function onAuthChange(callback) {
  if (!_auth) throw new Error("Auth not initialized. Call initAuth(app) first.");
  return onAuthStateChanged(_auth, callback);
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(_auth, email, password);
  return cred.user;
}

export async function register(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(_auth, email, password);
  await updateProfile(cred.user, { displayName });
  await ensureUserProfile(cred.user.uid, displayName, email);
  return cred.user;
}

export async function logout() {
  await signOut(_auth);
}

/**
 * Send a password reset email to the given address.
 * Throws if the address is not registered (Firebase will surface that error).
 */
export async function sendPasswordReset(email) {
  await sendPasswordResetEmail(_auth, email);
}

export function getCurrentUser() {
  return _auth?.currentUser ?? null;
}

/** Returns true when Firebase has finished rehydrating the auth state */
export function isAuthReady() {
  return _auth !== null;
}
