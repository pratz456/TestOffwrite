import { NextRequest, NextResponse } from 'next/server';
import { syncUserTransactions } from '@/lib/plaid/sync-helper';

/**
 * Internal API endpoint for scheduled Cloud Function to sync transactions
 * This endpoint is authenticated via a shared secret, not user auth
 */
export async function POST(req: NextRequest) {
  try {
    console.log('🔄 [Internal Sync] Starting scheduled transaction sync...');

    // Verify the Cloud Function secret
    const cloudFunctionSecret = req.headers.get('x-cloud-function-secret');
    const expectedSecret = process.env.CLOUD_FUNCTION_SECRET;

    if (!expectedSecret) {
      console.error('❌ [Internal Sync] CLOUD_FUNCTION_SECRET not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    if (!cloudFunctionSecret || cloudFunctionSecret !== expectedSecret) {
      console.error('❌ [Internal Sync] Invalid or missing Cloud Function secret');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { userId, import_timeframe = '6months' } = await req.json();

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    console.log(`🔄 [Internal Sync] Syncing transactions for user ${userId} with timeframe: ${import_timeframe}`);

    // Use the sync helper function
    const syncResult = await syncUserTransactions(userId, import_timeframe);

    if (syncResult.success) {
      console.log(`✅ [Internal Sync] Successfully synced ${syncResult.transactionsSaved} transactions for user ${userId}`);
      return NextResponse.json({
        success: true,
        accounts_processed: 1,
        transactions_saved: syncResult.transactionsSaved,
        message: `Successfully synced ${syncResult.transactionsSaved} transactions`
      });
    } else {
      console.error(`❌ [Internal Sync] Failed to sync transactions for user ${userId}:`, syncResult.error);
      return NextResponse.json({
        success: false,
        error: syncResult.error || 'Failed to sync transactions'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('❌ [Internal Sync] Error syncing transactions:', error);

    return NextResponse.json(
      {
        error: 'Failed to sync transactions',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
