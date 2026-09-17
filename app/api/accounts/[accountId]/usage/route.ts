export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { invalidJsonResponse, readJsonObject } from '@/app/api/_lib/body';
import { setAccountUsageServer } from '@/lib/firebase/accounts-server';

export async function PATCH(req: Request, context: { params: Promise<{ accountId: string }> }) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
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
  } catch (e) {
    console.error('usage PATCH failed:', e);
    return NextResponse.json({ error: 'Could not update the account. Please retry.' }, { status: 500 });
  }
}
