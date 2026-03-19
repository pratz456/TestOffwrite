import { NextResponse } from 'next/server';
import { syncUserTransactions, syncUserTransactionsIncremental } from '../../../../lib/plaid/sync-helper';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';

export async function POST(req: Request) {
  try {
    console.log('🔄 [Plaid Sync] Starting transaction sync...');

    // Get the authenticated user
    const { uid } = await getUserFromReqOrThrow(req);
    console.log('✅ [Plaid Sync] User authenticated:', uid);

    const body = await req.json().catch(() => ({}));
    // import_timeframe is display/filter only; fetch length is always 730 days.
    const { userId = uid, import_timeframe = '2years', incremental = false } = body;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Verify the authenticated user matches the requested userId
    if (uid !== userId) {
      console.error('❌ [Plaid Sync] User ID mismatch:', { uid, userId });
      return NextResponse.json({ error: 'Unauthorized access to user data' }, { status: 403 });
    }

    // Full sync: check/set import lock; incremental does not set lock
    if (!incremental) {
      const profileDoc = await adminDb.doc(`user_profiles/${uid}`).get();
      const profileData = profileDoc.data();
      const inProgress = profileData?.plaid_import_in_progress === true;
      const startedAt = profileData?.plaid_import_started_at;
      const startedAtMs = startedAt?.toMillis?.() ?? startedAt?.toDate?.()?.getTime?.() ?? (typeof startedAt === 'number' ? startedAt : 0);
      const nowMs = Date.now();
      const LOCK_WINDOW_MS = 15 * 60 * 1000;
      const STUCK_MS = 20 * 60 * 1000;
      if (inProgress && startedAtMs) {
        if (nowMs - startedAtMs < LOCK_WINDOW_MS) {
          console.log('[Plaid Sync] Import already in progress, returning already_running');
          return NextResponse.json({ success: true, status: 'already_running' }, { status: 200 });
        }
        if (nowMs - startedAtMs > STUCK_MS) {
          await adminDb.doc(`user_profiles/${uid}`).update({ plaid_import_in_progress: false, plaid_import_started_at: null });
          console.log('[Plaid Sync] Cleared stuck import lock');
        }
      }
      await adminDb.doc(`user_profiles/${uid}`).set(
        { plaid_import_in_progress: true, plaid_import_started_at: new Date() },
        { merge: true }
      );
      console.log('[Plaid Sync] Full sync import started');
    }

    let syncResult;
    try {
      syncResult = incremental
        ? await syncUserTransactionsIncremental(uid)
        : await syncUserTransactions(uid, import_timeframe);
    } finally {
      if (!incremental) {
        try {
          await adminDb.doc(`user_profiles/${uid}`).set(
            { plaid_import_in_progress: false, plaid_import_started_at: null },
            { merge: true }
          );
          console.log('[Plaid Sync] Full sync import completed');
        } catch (_) {}
      }
    }

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