import { NextRequest, NextResponse } from 'next/server';
import { syncUserTransactions } from '../../../../lib/plaid/sync-helper';
import { getAuthenticatedUser } from '../../../../lib/firebase/api-auth';


export async function POST(request: NextRequest) {
  try {
    console.log('🔄 [Plaid Sync] Starting manual transaction sync...');

    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      console.error('❌ [Plaid Sync] Authentication failed:', authError);
      return NextResponse.json({
        error: 'Authentication failed. Please log in again.',
        details: authError
      }, { status: 401 });
    }

    console.log('✅ [Plaid Sync] User authenticated:', user.uid);

    const { userId, import_timeframe = '1year' } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Verify the authenticated user matches the requested userId
    if (user.uid !== userId) {
      return NextResponse.json({ error: 'Unauthorized access to user data' }, { status: 403 });
    }

    // Use the sync helper function
    const syncResult = await syncUserTransactions(user.uid, import_timeframe);

    if (syncResult.success) {
      console.log(`✅ [Plaid Sync] Successfully synced ${syncResult.transactionsSaved} transactions for user ${user.uid}`);
      return NextResponse.json({
        success: true,
        accounts_processed: 1,
        transactions_saved: syncResult.transactionsSaved,
      });
    } else {
      console.error(`❌ [Plaid Sync] Failed to sync transactions for user ${user.uid}:`, syncResult.error);
      return NextResponse.json({
        success: false,
        error: syncResult.error
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