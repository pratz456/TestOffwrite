import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
/** Browser compatibility wrappers: only public Link tokens cross the API boundary. */
export async function createLinkToken(_userId: string) {
  try {
    const response = await makeAuthenticatedRequest('/api/plaid/create-link-token', { method: 'POST', body: '{}' });
    const data = await response.json();
    return response.ok ? { success: true, linkToken: data.link_token } : { success: false, error: data.error };
  } catch { return { success: false, error: 'Unable to connect bank' }; }
}
export async function exchangePublicToken(publicToken: string, _userId: string) {
  try {
    const response = await makeAuthenticatedRequest('/api/plaid/exchange-public-token', { method: 'POST', body: JSON.stringify({ public_token: publicToken }) });
    const data = await response.json();
    return response.ok ? { success: true, itemId: data.itemId } : { success: false, error: data.error };
  } catch { return { success: false, error: 'Unable to connect bank' }; }
}
export async function removePlaidConnection(_userId: string, itemId?: string) {
  try {
    const response = await makeAuthenticatedRequest(itemId ? `/api/plaid/items/${encodeURIComponent(itemId)}` : '/api/plaid/items', { method: 'DELETE' });
    const data = await response.json();
    return { success: response.ok, ...(response.ok ? {} : { error: data.error }) };
  } catch { return { success: false, error: 'Unable to disconnect bank' }; }
}
