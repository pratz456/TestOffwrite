export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

    // Infer if Item was created with < 730 days_requested (Plaid requires new Item to increase)
    let needsReconnectForFullHistory = false;
    const plaidRequestedStart = userProfileData.plaid_requested_start_date ?? null;
    const plaidConnectedAt = userProfileData.plaid_connected_at ?? null;
    if (plaidRequestedStart && plaidConnectedAt) {
      const connectedDate = typeof plaidConnectedAt?.toDate === 'function' ? plaidConnectedAt.toDate() : new Date(plaidConnectedAt);
      const startDate = new Date(plaidRequestedStart + 'T12:00:00');
      const requestedDaysAtConnect = Math.ceil((connectedDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      needsReconnectForFullHistory = requestedDaysAtConnect < 730;
    }

    return NextResponse.json({
      hasConnection: hasPlaidConnection,
      itemId: userProfileData.plaid_item_id || null,
      plaid_connected_at: userProfileData.plaid_connected_at ?? null,
      plaid_requested_start_date: plaidRequestedStart,
      plaid_earliest_returned_tx_date: userProfileData.plaid_earliest_returned_tx_date ?? null,
      plaid_imported_count: userProfileData.plaid_imported_count ?? null,
      needsReconnectForFullHistory,
      last_sync: userProfileData.last_sync ?? null,
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

