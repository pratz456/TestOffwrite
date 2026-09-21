export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { disconnectPlaidItem } from '@/lib/plaid/delete-item';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';

/**
 * DELETE /api/plaid/items/[itemId]
 * Disconnect one Plaid Item; imported records are retained.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(request)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
    const { itemId } = await params;

    if (!itemId || typeof itemId !== 'string' || itemId.length > 256 || /[\/\\\x00-\x1f\x7f]/.test(itemId)) {
      return NextResponse.json(
        { error: 'Item ID is required' },
        { status: 400 }
      );
    }

    const result = await disconnectPlaidItem(uid, itemId);

    if (!result.success) {
      console.error('❌ [Plaid Items API] Failed to disconnect item:', result.error);
      return NextResponse.json(
        { error: result.error?.message ?? 'Unable to disconnect bank' },
        { status: result.error?.status ?? 503 }
      );
    }

    return NextResponse.json({
      success: true,
      deletedCounts: result.deletedCounts,
      plaidRemoved: result.plaidRemoved,
    });
  } catch (error) {
    console.error('❌ [Plaid Items API] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Unable to disconnect bank' },
      { status: 503 }
    );
  }
}
