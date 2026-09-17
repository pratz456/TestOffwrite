export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { listPlaidConnections } from '@/lib/plaid/connections';
import { syncUserTransactions } from '@/lib/plaid/sync-helper';
export async function POST(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
    const body = await req.json();
    // Credentials are never accepted from a browser, including legacy requests.
    if ('access_token' in body) return NextResponse.json({ error: 'Client bank credentials are not accepted' }, { status: 400 });
    if (typeof body.account_id !== 'string' || !body.account_id || body.account_id.includes('/')) return NextResponse.json({ error: 'Account ID required' }, { status: 400 });
    const connection = (await listPlaidConnections(uid)).find(item => item.accountIds.includes(body.account_id));
    if (!connection) return NextResponse.json({ error: 'Bank account not found' }, { status: 403 });
    const result = await syncUserTransactions(uid, 'current-plan', connection.itemId, body.account_id);
    return NextResponse.json({ ok: result.success, imported: result.transactionsSaved, error: result.error }, { status: result.success ? 200 : 503 });
  } catch { return NextResponse.json({ error: 'Unable to import bank transactions' }, { status: 503 }); }
}
