import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { plaidClient } from '@/lib/plaid/client';
import { listPlaidConnections, withPlaidConnection } from '@/lib/plaid/connections';
export async function POST(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
    const connections = await listPlaidConnections(uid);
    if (!connections.length) return NextResponse.json({ error: 'No active bank connection found' }, { status: 400 });
    let inflow_count = 0, outflow_count = 0;
    for (const connection of connections) await withPlaidConnection(uid, connection.itemId, async current => {
      let response;
      try { response = await plaidClient.transactionsRecurringGet({ access_token: current.accessToken }); }
      catch (error) {
        const code = (error as { response?: { data?: { error_code?: string } } }).response?.data?.error_code;
        if (['PRODUCTS_NOT_READY', 'PRODUCT_NOT_READY', 'PRODUCT_NOT_ENABLED'].includes(code ?? '')) return;
        throw error;
      }
      const inflow = response.data.inflow_streams || [], outflow = response.data.outflow_streams || [];
      const ref = adminDb.collection(`user_profiles/${uid}/recurring_transactions`);
      const existing = await ref.where('plaid_item_id', '==', current.itemId).get();
      // Cleanup is scoped to this item; unavailable banks keep their prior records.
      for (const record of existing.docs) await record.ref.delete();
      for (const stream of [...inflow, ...outflow]) {
        if (!current.accountIds.includes(stream.account_id)) throw new Error('Bank stream ownership mismatch');
        await ref.doc(stream.stream_id).set({ stream_id: stream.stream_id, account_id: stream.account_id, plaid_item_id: current.itemId,
          merchant_name: stream.merchant_name ?? null, description: stream.description, first_date: stream.first_date, last_date: stream.last_date,
          frequency: stream.frequency, average_amount: stream.average_amount?.amount ?? null, last_amount: stream.last_amount?.amount ?? null,
          is_active: stream.is_active, status: stream.status, category: stream.personal_finance_category ?? null,
          direction: inflow.includes(stream) ? 'inflow' : 'outflow', updated_at: new Date() });
      }
      inflow_count += inflow.length; outflow_count += outflow.length;
    });
    return NextResponse.json({ success: true, inflow_count, outflow_count });
  } catch { return NextResponse.json({ error: 'Unable to refresh recurring transactions' }, { status: 503 }); }
}
