export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { assertPlaidTokenEncryptionConfigured, savePlaidConnection } from '@/lib/plaid/connections';
import { syncUserTransactionsIncremental } from '@/lib/plaid/sync-helper';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { invalidJsonResponse, readJsonObject } from '@/app/api/_lib/body';
import { ACCOUNT_DELETION_IN_PROGRESS, beginPlaidLinkOperation, retainPlaidLinkRecovery, finishPlaidLinkOperation,
  markPlaidLinkOperationUnresolved, existingPlaidLinkOwner, quarantinePlaidLinkRecovery } from '@/lib/plaid/link-operations';

export async function POST(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  let operationId: string | undefined;
  let created: { access_token: string; item_id: string } | undefined;
  let saved = false;
  let recoverySaved = false;
  const body = await readJsonObject(req);
  if (!body) return invalidJsonResponse();
  const { public_token } = body;
  if (typeof public_token !== 'string' || !public_token || public_token.length > 2048) return NextResponse.json({ error: 'Missing public_token' }, { status: 400 });
  try {
    assertPlaidTokenEncryptionConfigured();
    operationId = await beginPlaidLinkOperation(uid);
    const exchanged = await plaidClient.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = exchanged.data;
    created = { access_token, item_id };
    await retainPlaidLinkRecovery(uid, operationId, item_id, access_token);
    recoverySaved = true;
    const response = await plaidClient.accountsGet({ access_token });
    if (response.data.item.item_id !== item_id) throw new Error('Bank item mismatch');
    const accounts = response.data.accounts;
    if (!accounts.length) throw new Error('No accounts returned by bank');
    await savePlaidConnection({ uid, itemId: item_id, accessToken: access_token, accountIds: accounts.map(account => account.account_id),
      accounts, institutionId: response.data.item.institution_id ?? null });
    saved = true;
    await finishPlaidLinkOperation(uid, operationId);
    operationId = undefined;
    // Initialize Transactions Sync even when initial data is not ready. Subsequent
    // signed initial/historical webhooks retry this same item's cursor safely.
    const sync = await syncUserTransactionsIncremental(uid, item_id);
    return NextResponse.json({ ok: true, itemId: item_id, item_id, accountId: accounts[0].account_id,
      accounts: accounts.map(account => ({ ...account, plaid_item_id: item_id })), accountsProcessed: accounts.length,
      imported: sync.transactionsSaved, successfulWrites: sync.transactionsSaved, failedWrites: 0,
      importStatus: sync.success ? 'ready' : 'pending', message: sync.success ? 'Bank connected.' : 'Bank connected. Transactions are still syncing.' });
  } catch (error) {
    if (operationId) {
      try {
        if (saved) await finishPlaidLinkOperation(uid, operationId);
        else if (created) {
          const owner = await existingPlaidLinkOwner(uid, created.item_id, created.access_token);
          if (owner === 'owner') await finishPlaidLinkOperation(uid, operationId);
          else if (owner === 'conflict' || (error instanceof Error && error.message === 'BANK_ALREADY_CONNECTED')) {
            await quarantinePlaidLinkRecovery(uid, operationId);
          } else {
            // A failed save must not leave a newly created bank outside deletion's reach.
            await markPlaidLinkOperationUnresolved(uid, operationId, recoverySaved);
            try { await plaidClient.itemRemove({ access_token: created.access_token }); }
            catch (removeError) {
              const code = (removeError as { response?: { data?: { error_code?: string } } }).response?.data?.error_code;
              if (!['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN'].includes(code ?? '')) {
                if (!recoverySaved) {
                  await retainPlaidLinkRecovery(uid, operationId, created.item_id, created.access_token);
                  await markPlaidLinkOperationUnresolved(uid, operationId, true);
                }
                throw new Error('Bank revocation requires a retry');
              }
            }
            await finishPlaidLinkOperation(uid, operationId);
          }
        } else {
          const providerCode = (error as { response?: { data?: { error_code?: string } } }).response?.data?.error_code;
          if (providerCode === 'INVALID_PUBLIC_TOKEN') await finishPlaidLinkOperation(uid, operationId);
          else await markPlaidLinkOperationUnresolved(uid, operationId, false);
        }
      } catch { /* The durable operation/recovery stays private and blocks destructive deletion. */ }
    }
    const deleting = error instanceof Error && error.message === ACCOUNT_DELETION_IN_PROGRESS;
    if (deleting) return NextResponse.json({ code: ACCOUNT_DELETION_IN_PROGRESS, error: 'Account deletion is in progress. Bank connections cannot be added.' }, { status: 409 });
    const duplicate = error instanceof Error && error.message === 'BANK_ALREADY_CONNECTED';
    return NextResponse.json({ error: duplicate ? 'BANK_ALREADY_CONNECTED' : 'Unable to connect bank. Please retry.',
      ...(duplicate ? { message: 'This bank connection is already saved.' } : {}) }, { status: duplicate ? 409 : 502 });
  }
}
