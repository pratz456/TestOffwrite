export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { adminDb } from '@/lib/firebase/admin';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { listPlaidConnections, withPlaidConnection } from '@/lib/plaid/connections';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';
export async function POST(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  const limit = await enforceRateLimit({ ...RATE_LIMITS.plaidSync, key: uid });
  if (!limit.allowed) return rateLimitResponse(limit, { error: 'Too many balance refreshes. Please wait a few minutes and try again.' });
  try {
    const connections = await listPlaidConnections(uid);
    if (!connections.length) return NextResponse.json({ error: 'No active bank connection found' }, { status: 404 });
    let updated = 0;
    for (const connection of connections) await withPlaidConnection(uid, connection.itemId, async current => {
      const response = await plaidClient.accountsGet({ access_token: current.accessToken });
      for (const account of response.data.accounts) {
        if (!current.accountIds.includes(account.account_id)) continue;
        const ref = adminDb.doc(`user_profiles/${uid}/accounts/${account.account_id}`);
        if ((await ref.get()).data()?.plaid_item_id !== current.itemId) throw new Error('Bank account mismatch');
        const balances = account.balances;
        const balance = account.type === 'credit'
          ? balances.available ?? (balances.limit != null && balances.current != null ? Math.max(0, balances.limit - Math.abs(balances.current)) : null)
          : balances.available ?? balances.current ?? null;
        await ref.update({ balance, available_balance: balances.available, current_balance: balances.current, limit: balances.limit,
          iso_currency_code: balances.iso_currency_code ?? null, unofficial_currency_code: balances.unofficial_currency_code ?? null,
          balance_last_updated: new Date().toISOString(), updated_at: new Date() });
        updated++;
      }
    });
    return NextResponse.json({ success: true, updated });
  } catch { return NextResponse.json({ error: 'Unable to refresh bank balances' }, { status: 503 }); }
}
