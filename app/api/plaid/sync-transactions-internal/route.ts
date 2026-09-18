import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { syncUserTransactionsIncremental } from '@/lib/plaid/sync-helper';
import { invalidJsonResponse, readJsonObject } from '@/app/api/_lib/body';

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

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

    // A caller without a credential learns nothing about the deployment's configuration.
    if (!cloudFunctionSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!expectedSecret) {
      console.error('❌ [Internal Sync] CLOUD_FUNCTION_SECRET not configured');
      return NextResponse.json({ code: 'SYNC_UNAVAILABLE' }, { status: 503 });
    }

    if (!secretMatches(cloudFunctionSecret, expectedSecret)) {
      console.error('❌ [Internal Sync] Invalid Cloud Function secret');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await readJsonObject(req);
    if (!body) return invalidJsonResponse();
    const { userId, import_timeframe = '6months' } = body;

    // The UID becomes a Firestore document path segment.
    if (typeof userId !== 'string' || !userId || userId.length > 128 || /[\/\\\x00-\x1f\x7f]/.test(userId)) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    console.log(`🔄 [Internal Sync] Syncing transactions for user ${userId} with timeframe: ${import_timeframe}`);

    // Use incremental sync (cursor-based)
    const syncResult = await syncUserTransactionsIncremental(userId);

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
      // The scheduler only needs to know whether to retry; the detail stays in the log.
      return NextResponse.json({ success: false, error: 'Failed to sync transactions' }, { status: 500 });
    }

  } catch (error) {
    console.error('❌ [Internal Sync] Error syncing transactions:', error);

    return NextResponse.json({ error: 'Failed to sync transactions' }, { status: 500 });
  }
}
