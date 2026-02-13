import { NextRequest, NextResponse } from 'next/server';
import { syncUserTransactionsIncremental, findUserByPlaidItemId } from '../../../../lib/plaid/sync-helper';
import { adminDb } from '../../../../lib/firebase/admin';
import { createHash } from 'crypto';

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
 * Verifies the webhook signature from Plaid
 */
function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  try {
    // Plaid webhook verification logic
    // For now, we'll implement basic verification
    // In production, you should use Plaid's official webhook verification library

    if (!signature || !payload) {
      return false;
    }

    // Basic verification - in production use Plaid's official method
    const expectedSignature = createHash('sha256')
      .update(payload + secret)
      .digest('hex');

    return signature === expectedSignature;
  } catch (error) {
    console.error('❌ [Webhook] Signature verification failed:', error);
    return false;
  }
}

/**
 * Handles Plaid webhook notifications for transaction updates
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🔔 [Webhook] Received Plaid webhook');

    // Get the webhook signature for verification
    const signature = request.headers.get('plaid-verification') || request.headers.get('x-plaid-verification');

    // Get the raw body for signature verification
    const body = await request.text();
    const payload: PlaidWebhookPayload = JSON.parse(body);

    console.log('📊 [Webhook] Webhook payload:', {
      webhook_type: payload.webhook_type,
      webhook_code: payload.webhook_code,
      item_id: payload.item_id,
      webhook_id: payload.webhook_id,
      new_transactions: payload.new_transactions,
      removed_transactions: payload.removed_transactions?.length || 0
    });

    // Verify webhook signature if provided
    if (signature && process.env.PLAID_WEBHOOK_SECRET) {
      if (!verifyWebhookSignature(body, signature, process.env.PLAID_WEBHOOK_SECRET)) {
        console.error('❌ [Webhook] Invalid webhook signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
      console.log('✅ [Webhook] Signature verified');
    } else {
      console.warn('⚠️ [Webhook] No signature verification (development mode)');
    }

    // Handle different webhook types
    if (payload.webhook_type === 'TRANSACTIONS') {
      if (payload.webhook_code === 'SYNC_UPDATES_AVAILABLE' || payload.webhook_code === 'DEFAULT_UPDATE') {
        console.log(`🔄 [Webhook] Processing ${payload.webhook_code} for item ${payload.item_id}`);

        // Find the user associated with this Plaid item
        const userId = await findUserByPlaidItemId(payload.item_id);

        if (!userId) {
          console.error(`❌ [Webhook] No user found for Plaid item ${payload.item_id}`);
          return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        console.log(`✅ [Webhook] Found user ${userId} for item ${payload.item_id}`);

        // Check for duplicate webhook processing using webhook_id
        if (payload.webhook_id) {
          const processedWebhookRef = adminDb.doc(`processed_webhooks/${payload.webhook_id}`);
          const existingWebhook = await processedWebhookRef.get();

          if (existingWebhook.exists) {
            console.log(`🔄 [Webhook] Webhook ${payload.webhook_id} already processed, skipping`);
            return NextResponse.json({ success: true, message: 'Already processed' });
          }

          // Mark webhook as processed
          await processedWebhookRef.set({
            processed_at: Date.now(),
            item_id: payload.item_id,
            user_id: userId,
            webhook_code: payload.webhook_code
          });
        }

        // Sync transactions for the user (incremental, cursor-based)
        const syncResult = await syncUserTransactionsIncremental(userId);

        if (syncResult.success) {
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
      } else if (payload.webhook_code === 'INITIAL_UPDATE') {
        console.log(`ℹ️ [Webhook] Received INITIAL_UPDATE for item ${payload.item_id} - no action needed`);
        return NextResponse.json({ success: true, message: 'Initial update received' });
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
