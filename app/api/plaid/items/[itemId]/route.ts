export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { disconnectPlaidItem } from '@/lib/plaid/delete-item';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';

/**
 * DELETE /api/plaid/items/[itemId]
 * Disconnect a Plaid Item and delete all related data
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { itemId: string } }
) {
  try {
    console.log('🔄 [Plaid Items API] Starting DELETE request...');

    const { uid } = await getUserFromReqOrThrow(request);
    const { itemId } = params;

    if (!itemId) {
      return NextResponse.json(
        { error: 'Item ID is required' },
        { status: 400 }
      );
    }

    console.log(`✅ [Plaid Items API] User authenticated: ${uid}, deleting item: ${itemId}`);

    const result = await disconnectPlaidItem(uid, itemId);

    if (!result.success) {
      console.error('❌ [Plaid Items API] Failed to disconnect item:', result.error);
      return NextResponse.json(
        {
          error: 'Failed to disconnect Plaid item',
          details: result.error?.message || 'Unknown error'
        },
        { status: 500 }
      );
    }

    console.log('✅ [Plaid Items API] Successfully disconnected item');
    return NextResponse.json({
      success: true,
      deletedCounts: result.deletedCounts,
      plaidRemoved: result.plaidRemoved,
    });
  } catch (error) {
    console.error('❌ [Plaid Items API] Unexpected error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

