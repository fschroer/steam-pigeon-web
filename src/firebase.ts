import { initializeApp, type FirebaseApp } from 'firebase/app';

// The web config comes from .env.local (see .env.example), never from git:
// its apiKey begins "AIza", which the project's pre-commit secret scan flags.
// It is not a secret, because the Storage rules guard the data (ADR-0042 decision 7).
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const configured = Boolean(config.apiKey && config.projectId && config.storageBucket);

export const app: FirebaseApp | null = configured ? initializeApp(config) : null;
