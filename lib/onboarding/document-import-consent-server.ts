import { adminDb } from '@/lib/firebase/admin';
import { hasDocumentImportConsent } from './consents';

/**
 * The stored profile record is the only authority for the §7216 document-image
 * consent; the request flag from the upload screen is never enough on its own.
 */
export async function documentImportConsentOnFile(uid: string): Promise<boolean> {
  const snapshot = await adminDb.collection('user_profiles').doc(uid).get();
  return snapshot.exists && hasDocumentImportConsent(snapshot.data()?.consents);
}
