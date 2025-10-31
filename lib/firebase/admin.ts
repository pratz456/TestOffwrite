import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK
const hasEnvCredentials = Boolean(
  process.env.FIREBASE_ADMIN_PROJECT_ID &&
  process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
  process.env.FIREBASE_ADMIN_PRIVATE_KEY
);

// Initialize the app only if it hasn't been initialized yet
const app = getApps().length === 0
  ? (() => {
      if (hasEnvCredentials) {
        const firebaseAdminConfig = {
          projectId: process.env.FIREBASE_ADMIN_PROJECT_ID!,
          clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
          privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, '\n'),
        } as const;
        return initializeApp({
          credential: cert(firebaseAdminConfig),
          projectId: firebaseAdminConfig.projectId,
        });
      }
      // Fallback: use Application Default Credentials (works on Firebase/Cloud Functions)
      return initializeApp();
    })()
  : getApps()[0];

// Export Firebase Admin services
export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
export const admin = { firestore: { FieldValue, Timestamp } };
export { FieldValue, Timestamp };

// Helper function to verify ID tokens
export async function verifyIdToken(idToken: string) {
  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    return { success: true, uid: decodedToken.uid, email: decodedToken.email };
  } catch (error) {
    console.error('Error verifying ID token:', error);
    return { success: false, error };
  }
}

// Helper function to get user by email
export async function getUserByEmail(email: string) {
  try {
    const userRecord = await adminAuth.getUserByEmail(email);
    return { success: true, user: userRecord };
  } catch (error) {
    console.error('Error getting user by email:', error);
    return { success: false, error };
  }
}

// Helper function to update user email verification status
export async function updateEmailVerified(uid: string, emailVerified: boolean) {
  try {
    await adminAuth.updateUser(uid, { emailVerified });
    return { success: true };
  } catch (error) {
    console.error('Error updating email verification:', error);
    return { success: false, error };
  }
}


