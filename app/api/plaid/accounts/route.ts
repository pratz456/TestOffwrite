import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { plaidClient } from '@/lib/plaid/client';
import { listPlaidConnections } from '@/lib/plaid/connections';
export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const connections = await listPlaidConnections(user.uid);
    const accounts = [];
    for (const connection of connections) {
      const response = await plaidClient.accountsGet({ access_token: connection.accessToken });
      accounts.push(...response.data.accounts.filter(account => connection.accountIds.includes(account.account_id))
        .map(account => ({ ...account, plaid_item_id: connection.itemId })));
    }
    return NextResponse.json({ accounts }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Unable to load bank accounts' }, { status: 503 }); }
}
