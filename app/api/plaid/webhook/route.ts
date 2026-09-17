import { NextRequest, NextResponse } from 'next/server';
import { syncUserTransactionsIncremental, findUserByPlaidItemId } from '../../../../lib/plaid/sync-helper';
import { adminDb } from '../../../../lib/firebase/admin';
import { verifyPlaidWebhook } from '@/lib/plaid/webhook-verification';
import { createHash } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PlaidWebhookPayload {
  webhook_type: string;
  webhook_code: string;
  item_id: string;
  webhook_id?: string;
  error?: {
    error_type: string;
    error_code: string;
    error_message: string;
  };
  new_transactions?: number;
  removed_transactions?: string[];
}

/**
 * Handles Plaid webhook notifications for transaction updates
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🔔 [Webhook] Received Plaid webhook');

    // Get the raw body for signature verification
    const body = await request.text();
    const signedJwt = request.headers.get('plaid-verification');
    if (!await verifyPlaidWebhook(body, signedJwt)) {
      return NextResponse.json({ error: 'Invalid or missing webhook signature' }, { status: 401 });
    }
    const payload: PlaidWebhookPayload = JSON.parse(body);

    console.log('📊 [Webhook] Webhook payload:', {
      webhook_type: payload.webhook_type,
      webhook_code: payload.webhook_code,
      item_id: payload.item_id,
      webhook_id: payload.webhook_id,
      new_transactions: payload.new_transactions,
      removed_transactions: payload.removed_transactions?.length || 0
    });

    // Handle different webhook types
    if (payload.webhook_type === 'TRANSACTIONS') {
      if (['SYNC_UPDATES_AVAILABLE', 'DEFAULT_UPDATE', 'INITIAL_UPDATE', 'HISTORICAL_UPDATE'].includes(payload.webhook_code)) {
        if (typeof payload.item_id !== 'string' || !payload.item_id || payload.item_id.length > 256) {
          return NextResponse.json({ error: 'Invalid item' }, { status: 400 });
        }
        console.log(`🔄 [Webhook] Processing ${payload.webhook_code} for item ${payload.item_id}`);

        // Find the user associated with this Plaid item
        const userId = await findUserByPlaidItemId(payload.item_id);

        if (!userId) {
          console.error(`❌ [Webhook] No user found for Plaid item ${payload.item_id}`);
          return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        console.log(`✅ [Webhook] Found user ${userId} for item ${payload.item_id}`);

        // Plaid does not promise a webhook_id. Hash the authenticated delivery
        // when absent; a later newly signed update with the same body still syncs.
        // Never persist the access token, signature JWT, or raw bank payload.
        const delivery = typeof payload.webhook_id === 'string' && payload.webhook_id
          ? JSON.stringify([payload.item_id, payload.webhook_id]) : `${body}\0${signedJwt}`;
        const deliveryHash = createHash('sha256').update(delivery).digest('hex');
        const processedWebhookRef = adminDb.doc(`processed_webhooks/plaid_${deliveryHash}`);
        if ((await processedWebhookRef.get()).exists) {
          return NextResponse.json({ success: true, message: 'Already processed' });
        }

        // Sync transactions for the user (incremental, cursor-based)
        const syncResult = await syncUserTransactionsIncremental(userId, payload.item_id);

        if (syncResult.success) {
          // A failed sync must remain retryable; acknowledge only completed work.
          await processedWebhookRef.set({
            provider: 'plaid', signature_verified: true, processed_at: Date.now(),
            item_id: payload.item_id, user_id: userId, webhook_code: payload.webhook_code,
            transactions_saved: syncResult.transactionsSaved,
          });
          console.log(`✅ [Webhook] Successfully synced ${syncResult.transactionsSaved} transactions for user ${userId}`);
          return NextResponse.json({
            success: true,
            message: 'Transactions synced successfully',
            transactionsSaved: syncResult.transactionsSaved
          });
        } else {
          console.error(`❌ [Webhook] Failed to sync transactions for user ${userId}:`, syncResult.error);
          return NextResponse.json({
            success: false,
            error: syncResult.error
          }, { status: 500 });
        }
      } else {
        console.log(`ℹ️ [Webhook] Unhandled webhook code: ${payload.webhook_code}`);
        return NextResponse.json({ success: true, message: 'Webhook received but not processed' });
      }
    } else if (payload.webhook_type === 'ERROR') {
      console.error(`❌ [Webhook] Plaid error for item ${payload.item_id}:`, payload.error);
      return NextResponse.json({ success: true, message: 'Error webhook logged' });
    } else {
      console.log(`ℹ️ [Webhook] Unhandled webhook type: ${payload.webhook_type}`);
      return NextResponse.json({ success: true, message: 'Webhook type not processed' });
    }

  } catch (error) {
    console.error('❌ [Webhook] Error processing webhook:', error);
    return NextResponse.json(
      {
        error: 'Failed to process webhook',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Health check endpoint for webhook
 */
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    message: 'Plaid webhook endpoint is running'
  });
}
