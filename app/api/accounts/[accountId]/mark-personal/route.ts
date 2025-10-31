export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';

export async function POST(_req: Request, context: { params: Promise<{ accountId: string }> }) {
  try {
    const { uid } = await getUserFromReqOrThrow(_req);
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
  } catch (e: any) {
    const msg = e?.message || 'Internal server error';
    const status = /token|auth|credential|unauthor/i.test(msg) ? 401 : 500;
    console.error('mark-personal failed:', msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
