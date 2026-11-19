import dotenv from "dotenv";
import path from "path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

// This module is imported before src/index.ts executes, so load local
// configuration here as well. Existing process variables still take priority.
dotenv.config({ path: path.join(__dirname, "../../.env") });

const projectId =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  "project-351f7874-1aa0-446d-a21";

const storageBucket =
  process.env.FIREBASE_STORAGE_BUCKET ||
  `${projectId}.firebasestorage.app`;

// Cloud Run supplies Application Default Credentials. Local development can
// use the Firebase emulators or GOOGLE_APPLICATION_CREDENTIALS.
const firebaseApp =
  getApps()[0] ?? initializeApp({ projectId, storageBucket });

export const db = getFirestore(firebaseApp);
db.settings({ ignoreUndefinedProperties: true });

export const firebaseAuth = getAuth(firebaseApp);
export const publicImageBucket = getStorage(firebaseApp).bucket(storageBucket);
export { projectId, storageBucket };
