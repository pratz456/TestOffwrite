export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { disconnectPlaidItem } from '@/lib/plaid/delete-item';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';

/**
 * DELETE /api/plaid/items
 * Disconnect the current Plaid Item (no itemId needed)
 */
export async function DELETE(request: NextRequest) {
  try {
    console.log('🔄 [Plaid Items API] Starting DELETE request (current item)...');

    const { uid } = await getUserFromReqOrThrow(request);

    console.log(`✅ [Plaid Items API] User authenticated: ${uid}`);

    const result = await disconnectPlaidItem(uid);

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

/**
 * GET /api/plaid/items
 * Get information about connected Plaid items
 */
export async function GET(request: NextRequest) {
  try {
    console.log('🔄 [Plaid Items API] Starting GET request...');

    const { uid } = await getUserFromReqOrThrow(request);

    const { data: userProfile, error: profileError } = await getUserProfileServer(uid);

    if (profileError || !userProfile) {
      return NextResponse.json(
        { error: 'Failed to get user profile' },
        { status: 500 }
      );
    }

    const userProfileData = userProfile as any;
    const hasPlaidConnection = !!(userProfileData.plaid_token || userProfileData.plaid_item_id);

    return NextResponse.json({
      hasConnection: hasPlaidConnection,
      itemId: userProfileData.plaid_item_id || null,
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

