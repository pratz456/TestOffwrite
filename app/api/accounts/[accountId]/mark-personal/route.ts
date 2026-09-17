export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';

export async function POST(_req: Request, context: { params: Promise<{ accountId: string }> }) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(_req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
    const { accountId } = await context.params;

    const txColPath = `user_profiles/${uid}/accounts/${accountId}/transactions`;
    const snap = await adminDb.collection(txColPath).get();

    const batch = adminDb.batch();
    snap.forEach(docSnap => {
      const ref = docSnap.ref;
      batch.set(ref, {
        userLabel: 'personal',
        is_deductible: false,
        analysis: { status: 'skipped', reason: 'personal-account' },
        updatedAt: Date.now(),
      }, { merge: true });
    });
    await batch.commit();

    return NextResponse.json({ ok: true, count: snap.size });
  } catch (e) {
    console.error('mark-personal failed:', e);
    return NextResponse.json({ error: 'Could not update the account. Please retry.' }, { status: 500 });
  }
}
