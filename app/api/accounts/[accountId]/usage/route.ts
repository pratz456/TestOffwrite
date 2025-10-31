export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { setAccountUsageServer } from '@/lib/firebase/accounts-server';

export async function PATCH(req: Request, context: { params: Promise<{ accountId: string }> }) {
  try {
    // Verify auth (returns uid or throws)
    const { uid } = await getUserFromReqOrThrow(req);

    // Next.js 15: await params
    const { accountId } = await context.params;

    const { usageType, businessUsePercent } = await req.json();

    if (!['business','personal','mixed','unknown'].includes(usageType)) {
      return NextResponse.json({ error: 'invalid usageType' }, { status: 400 });
    }

    await setAccountUsageServer(uid, accountId, usageType, businessUsePercent ?? null);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    // If your getUserFromReqOrThrow throws a known auth error, map to 401
    const msg = e?.message || 'failed';
    const status = /token|auth|credential|unauthor/i.test(msg) ? 401 : 500;
    console.error('usage PATCH failed:', msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
