import { adminDb } from '@/lib/firebase/admin';
import type { SavedTaxPosition } from './account-tools';

/** Only successful, supported calculations become baselines; a late response cannot move time backwards. */
export async function saveTaxPosition(current: SavedTaxPosition): Promise<SavedTaxPosition | null> {
  const ref = adminDb.doc(`user_profiles/${current.userId}/assistant_tax_snapshots/${current.taxYear}`);
  return adminDb.runTransaction(async tx => {
    const [saved, deletion] = await Promise.all([tx.get(ref), tx.get(adminDb.doc(`account_deletions/${current.userId}`))]);
    if (deletion.data()?.deletionRequested === true) throw new Error('Account deletion in progress');
    const previous = saved.exists ? saved.data() as SavedTaxPosition : null;
    if (!previous || typeof previous.checkedAt !== 'string' || previous.checkedAt < current.checkedAt) tx.set(ref, current);
    return previous;
  });
}
