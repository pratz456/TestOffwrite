import { adminAuth, adminDb } from './admin';

/**
 * Delete all user data from Firestore and Firebase Auth.
 * @param {string} uid - The user's UID.
 * @returns {Promise<{ error?: any }>}
 */
export async function deleteUserData(uid: string): Promise<{ error?: any }> {
  try {
    // Delete user profile
    await adminDb.collection('profiles').doc(uid).delete();
    // Delete user transactions
    const transactionsSnap = await adminDb.collection('transactions').where('userId', '==', uid).get();
    const batch = adminDb.batch();
    transactionsSnap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    // Delete user from Firebase Auth
    await adminAuth.deleteUser(uid);
    return {};
  } catch (error) {
    return { error };
  }
}
