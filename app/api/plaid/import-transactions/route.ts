export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { invalidJsonResponse, readJsonObject } from '@/app/api/_lib/body';
import { listPlaidConnections } from '@/lib/plaid/connections';
import { syncUserTransactions } from '@/lib/plaid/sync-helper';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';
export async function POST(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  const body = await readJsonObject(req);
  if (!body) return invalidJsonResponse();
  try {
    // Credentials are never accepted from a browser, including legacy requests.
    if ('access_token' in body) return NextResponse.json({ error: 'Client bank credentials are not accepted' }, { status: 400 });
    const accountId = body.account_id;
    if (typeof accountId !== 'string' || !accountId || accountId.length > 256 || accountId.includes('/')) return NextResponse.json({ error: 'Account ID required' }, { status: 400 });
    const limit = await enforceRateLimit({ ...RATE_LIMITS.plaidSync, key: uid });
    if (!limit.allowed) return rateLimitResponse(limit, { error: 'Too many bank syncs. Please wait a few minutes and try again.' });
    const connection = (await listPlaidConnections(uid)).find(item => item.accountIds.includes(accountId));
    if (!connection) return NextResponse.json({ error: 'Bank account not found' }, { status: 403 });
    const result = await syncUserTransactions(uid, 'current-plan', connection.itemId, accountId);
    return NextResponse.json({ ok: result.success, imported: result.transactionsSaved, error: result.error }, { status: result.success ? 200 : 503 });
  } catch { return NextResponse.json({ error: 'Unable to import bank transactions' }, { status: 503 }); }
}
