import { NextRequest, NextResponse } from 'next/server';
import { syncUserTransactions, syncUserTransactionsIncremental } from '../../../../lib/plaid/sync-helper';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';


export async function POST(req: Request) {
  try {
    console.log('🔄 [Plaid Sync] Starting transaction sync...');

    // Get the authenticated user
    const { uid } = await getUserFromReqOrThrow(req);
    console.log('✅ [Plaid Sync] User authenticated:', uid);

    const body = await req.json().catch(() => ({}));
    const { userId = uid, import_timeframe = '2years', incremental = false } = body;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Verify the authenticated user matches the requested userId
    if (uid !== userId) {
      console.error('❌ [Plaid Sync] User ID mismatch:', { uid, userId });
      return NextResponse.json({ error: 'Unauthorized access to user data' }, { status: 403 });
    }

    const syncResult = incremental
      ? await syncUserTransactionsIncremental(uid)
      : await syncUserTransactions(uid, import_timeframe);

    if (incremental) {
      console.log(`🔄 [Plaid Sync] Incremental sync for user ${uid}`);
    } else {
      console.log(`🔄 [Plaid Sync] Full sync for user ${uid} with timeframe: ${import_timeframe}`);
    }

    if (syncResult.success) {
      console.log(`✅ [Plaid Sync] Successfully synced ${syncResult.transactionsSaved} transactions for user ${uid}`);
      return NextResponse.json({
        success: true,
        accounts_processed: 1,
        transactions_saved: syncResult.transactionsSaved,
        message: `Successfully synced ${syncResult.transactionsSaved} transactions`
      });
    } else {
      console.error(`❌ [Plaid Sync] Failed to sync transactions for user ${uid}:`, syncResult.error);
      return NextResponse.json({
        success: false,
        error: syncResult.error || 'Failed to sync transactions'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('❌ [Plaid Sync] Error syncing transactions:', error);

    // More detailed error logging
    if (error instanceof Error) {
      console.error('❌ [Plaid Sync] Error details:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
    }

    return NextResponse.json(
      {
        error: 'Failed to sync transactions. Please try again.',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}