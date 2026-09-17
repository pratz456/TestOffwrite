export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { disconnectPlaidItem } from '@/lib/plaid/delete-item';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { listPlaidConnectionSummaries } from '@/lib/plaid/connections';
export async function DELETE(request: NextRequest) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(request)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  const result = await disconnectPlaidItem(uid);
  return NextResponse.json(result.success ? result : { error: result.error?.message || 'Unable to disconnect bank' }, { status: result.success ? 200 : 409 });
}
export async function GET(request: NextRequest) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(request)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
    const items = await listPlaidConnectionSummaries(uid);
    const active = items.filter(item => item.status === 'active');
    return NextResponse.json({ items, hasConnection: active.length > 0, itemId: items.length === 1 ? items[0].itemId : null,
      relinkRequired: items.some(item => item.relinkRequired), last_sync: active.reduce((latest, item) => Math.max(latest, item.lastSync ?? 0), 0) || null,
      needsReconnectForFullHistory: false }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Unable to load bank connections' }, { status: 503 }); }
}
