export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { invalidJsonResponse, readJsonObject } from '@/app/api/_lib/body';
import { setAccountUsageServer } from '@/lib/firebase/accounts-server';

export async function PATCH(req: Request, context: { params: Promise<{ accountId: string }> }) {
  try {
    // Verify auth (returns uid or throws)
    const { uid } = await getUserFromReqOrThrow(req);

    // Next.js 15: await params
    const { accountId } = await context.params;

    const body = await readJsonObject(req);
    if (!body) return invalidJsonResponse();
    const { usageType, businessUsePercent } = body;
    const usageTypes = ['business', 'personal', 'mixed', 'unknown'] as const;
    const isUsageType = (value: unknown): value is typeof usageTypes[number] => usageTypes.includes(value as typeof usageTypes[number]);

    if (!isUsageType(usageType)) {
      return NextResponse.json({ error: 'invalid usageType' }, { status: 400 });
    }
    if (businessUsePercent != null && (typeof businessUsePercent !== 'number' || !Number.isFinite(businessUsePercent) || businessUsePercent < 0 || businessUsePercent > 100)) {
      return NextResponse.json({ error: 'businessUsePercent must be a number from 0 to 100' }, { status: 400 });
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
