import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";

const explicitConfig = process.env.NEXT_PUBLIC_FIREBASE_API_KEY
  ? {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      projectId:
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
        "project-351f7874-1aa0-446d-a21",
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    }
  : undefined;

// Firebase App Hosting injects FIREBASE_WEBAPP_CONFIG during the build, which
// lets initializeApp() work without a checked-in browser configuration.
export function getFirebaseAuth() {
  const firebaseApp = getApps()[0] ?? initializeApp(explicitConfig);
  const auth = getAuth(firebaseApp);

  if (
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" &&
    !auth.emulatorConfig
  ) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
  }

  return auth;
}
