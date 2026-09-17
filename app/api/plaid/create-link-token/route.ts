export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { CountryCode, Products, type LinkTokenCreateRequest } from 'plaid';
import { plaidClient } from '@/lib/plaid/client';
import { getTransactionHistoryWindow } from '@/lib/subscriptions/history-window';
import { startFreeTrial } from '@/lib/subscriptions/trial-manager';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { getPlaidConnection } from '@/lib/plaid/connections';

function webhookUrl(): string | undefined {
  const source = process.env.PLAID_WEBHOOK_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL;
  if (!source) return undefined;
  const url = new URL(source.includes('://') ? source : `https://${source}`);
  if (url.protocol !== 'https:' || url.username || url.password) {
    if (process.env.PLAID_ENV === 'sandbox' && ['localhost', '127.0.0.1'].includes(url.hostname)) return undefined;
    throw new Error('A secure webhook URL is required');
  }
  return new URL('/api/plaid/webhook', url).toString();
}
export async function POST(request: NextRequest) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(request)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
    const body = await request.json().catch(() => ({}));
    if (body.itemId !== undefined && (typeof body.itemId !== 'string' || !body.itemId || body.itemId.includes('/'))) {
      return NextResponse.json({ error: 'Invalid bank connection' }, { status: 400 });
    }
    const connection = body.itemId ? await getPlaidConnection(uid, body.itemId) : null;
    if (body.itemId && !connection) return NextResponse.json({ code: 'BANK_RELINK_REQUIRED', error: 'Connect this bank again using the current bank provider.' }, { status: 409 });
    if (!connection) await startFreeTrial(uid);
    const webhook = webhookUrl();
    if (!webhook && process.env.PLAID_ENV === 'production') throw new Error('A secure webhook URL is required');
    const configs: LinkTokenCreateRequest = { user: { client_user_id: uid }, client_name: 'WriteOff', country_codes: [CountryCode.Us], language: 'en',
      ...(webhook ? { webhook } : {}),
      ...(connection ? { access_token: connection.accessToken } : { products: [Products.Transactions], transactions: { days_requested: (await getTransactionHistoryWindow(uid)).days } }) };
    const response = await plaidClient.linkTokenCreate(configs);
    return NextResponse.json({ link_token: response.data.link_token, mode: connection ? 'update' : 'create', ...(connection ? { itemId: connection.itemId } : {}) });
  } catch { return NextResponse.json({ error: 'Bank connection is unavailable. Please retry later.' }, { status: 503 }); }
}
