export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { assertPlaidTokenEncryptionConfigured, savePlaidConnection } from '@/lib/plaid/connections';
import { syncUserTransactionsIncremental } from '@/lib/plaid/sync-helper';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';

export async function POST(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
    const { public_token } = await req.json();
    if (typeof public_token !== 'string' || !public_token || public_token.length > 2048) return NextResponse.json({ error: 'Missing public_token' }, { status: 400 });
    assertPlaidTokenEncryptionConfigured();
    const exchanged = await plaidClient.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = exchanged.data;
    const response = await plaidClient.accountsGet({ access_token });
    if (response.data.item.item_id !== item_id) throw new Error('Bank item mismatch');
    const accounts = response.data.accounts;
    if (!accounts.length) return NextResponse.json({ error: 'No accounts returned by bank' }, { status: 502 });
    await savePlaidConnection({ uid, itemId: item_id, accessToken: access_token, accountIds: accounts.map(account => account.account_id),
      accounts, institutionId: response.data.item.institution_id ?? null });
    // Initialize Transactions Sync even when initial data is not ready. Subsequent
    // signed initial/historical webhooks retry this same item's cursor safely.
    const sync = await syncUserTransactionsIncremental(uid, item_id);
    return NextResponse.json({ ok: true, itemId: item_id, item_id, accountId: accounts[0].account_id,
      accounts: accounts.map(account => ({ ...account, plaid_item_id: item_id })), accountsProcessed: accounts.length,
      imported: sync.transactionsSaved, successfulWrites: sync.transactionsSaved, failedWrites: 0,
      importStatus: sync.success ? 'ready' : 'pending', message: sync.success ? 'Bank connected.' : 'Bank connected. Transactions are still syncing.' });
  } catch (error) {
    const duplicate = error instanceof Error && error.message === 'BANK_ALREADY_CONNECTED';
    return NextResponse.json({ error: duplicate ? 'BANK_ALREADY_CONNECTED' : 'Unable to connect bank. Please retry.',
      ...(duplicate ? { message: 'This bank connection is already saved.' } : {}) }, { status: duplicate ? 409 : 502 });
  }
}
