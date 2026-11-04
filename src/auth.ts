import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, sendPasswordResetEmail, signOut as fbSignOut, type User,
} from 'firebase/auth';
import { app } from './firebase';

// The same Firebase Auth users as the phone app (ADR-0042 decision 3).
// Accounts are made in the app or by Google sign-in; the web offers no sign-up form.

function auth() {
  if (!app) throw new Error('Firebase is not configured');
  return getAuth(app);
}

export function watchUser(cb: (u: User | null) => void): void {
  onAuthStateChanged(auth(), cb);
}

export async function signInGoogle(): Promise<void> {
  await signInWithPopup(auth(), new GoogleAuthProvider());
}

export async function signInEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth(), email, password);
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth(), email);
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth());
}

/** A sentence a person can act on, from a Firebase error. */
export function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password do not match an account.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was canceled.';
    case 'auth/popup-blocked':
      return 'The browser blocked the sign-in window. Allow pop-ups for this site and try again.';
    case 'auth/unauthorized-domain':
      return 'This site is not on the Firebase list of authorized domains.';
    case 'auth/network-request-failed':
      return 'No connection to the sign-in service.';
    default:
      return (e as Error)?.message ?? String(e);
  }
}
