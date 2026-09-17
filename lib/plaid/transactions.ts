import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
/** Browser compatibility wrappers; the authenticated server resolves all credentials. */
export async function fetchTransactions(_userId: string) {
  try {
    const response = await makeAuthenticatedRequest('/api/plaid/sync-transactions', { method: 'POST', body: JSON.stringify({ incremental: true }) });
    const data = await response.json();
    return { success: response.ok, count: data.transactions_saved ?? 0, ...(response.ok ? {} : { error: data.error }) };
  } catch { return { success: false, error: 'Unable to sync transactions' }; }
}
export async function getAccountBalances(_userId: string) {
  try {
    const response = await makeAuthenticatedRequest('/api/plaid/accounts');
    const data = await response.json();
    return { success: response.ok, accounts: data.accounts ?? [], ...(response.ok ? {} : { error: data.error }) };
  } catch { return { success: false, error: 'Unable to load bank balances' }; }
}
export async function getInstitutionInfo(_userId: string) {
  try {
    const response = await makeAuthenticatedRequest('/api/plaid/items');
    const data = await response.json();
    return { success: response.ok, institutions: data.items ?? [], ...(response.ok ? {} : { error: data.error }) };
  } catch { return { success: false, error: 'Unable to load bank connections' }; }
}
