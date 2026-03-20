import { NextRequest, NextResponse } from 'next/server';
import { syncUserTransactionsIncremental, findUserByPlaidItemId } from '../../../../lib/plaid/sync-helper';
import { adminDb } from '../../../../lib/firebase/admin';
import { createHash, createVerify } from 'crypto';

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

// Cache Plaid's public verification keys to avoid fetching on every webhook
const keyCache = new Map<string, { key: string; fetchedAt: number }>();
const KEY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch Plaid's current webhook verification public key by key_id.
 * Keys rotate, so we cache with a 1-hour TTL.
 */
async function fetchPlaidVerificationKey(keyId: string): Promise<string | null> {
  const cached = keyCache.get(keyId);
  if (cached && Date.now() - cached.fetchedAt < KEY_CACHE_TTL_MS) {
    return cached.key;
  }
  try {
    const { plaidClientId, plaidSecret, plaidEnv } = getPlaidConfig();
    const env = plaidEnv === 'production' ? 'production' : 'sandbox';
    const res = await fetch(`https://${env}.plaid.com/webhook_verification_key/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: plaidClientId,
        secret: plaidSecret,
        key_id: keyId,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const publicKey: string = data?.key?.public_key;
    if (!publicKey) return null;
    keyCache.set(keyId, { key: publicKey, fetchedAt: Date.now() });
    return publicKey;
  } catch (err) {
    console.error('❌ [Webhook] Failed to fetch Plaid verification key:', err);
    return null;
  }
}

function getPlaidConfig() {
  return {
    plaidClientId: process.env.PLAID_CLIENT_ID || '',
    plaidSecret: process.env.PLAID_SECRET || '',
    plaidEnv: process.env.PLAID_ENV || 'sandbox',
  };
}

/**
 * Verify a Plaid webhook using their JWT-based signature scheme.
 * Plaid sends a signed_jwt header containing a JWT whose body includes
 * the SHA-256 hash of the raw request body. We fetch the rotating public
 * key by key_id from the JWT header, then verify the signature and body hash.
 */
async function verifyPlaidWebhook(rawBody: string, signedJwt: string): Promise<boolean> {
  try {
    if (!signedJwt || !rawBody) return false;

    // JWT is base64url-encoded header.payload.signature
    const parts = signedJwt.split('.');
    if (parts.length !== 3) return false;

    const headerJson = Buffer.from(parts[0], 'base64url').toString('utf8');
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const header = JSON.parse(headerJson);
    const jwtPayload = JSON.parse(payloadJson);

    const keyId: string = header.kid;
    if (!keyId) return false;

    // Verify the JWT hasn't expired
    const nowSecs = Math.floor(Date.now() / 1000);
    if (jwtPayload.iat && nowSecs - jwtPayload.iat > 300) {
      console.warn('⚠️ [Webhook] JWT is older than 5 minutes — replay attack?');
      return false;
    }

    // Verify the body hash matches
    const expectedBodyHash = createHash('sha256').update(rawBody, 'utf8').digest('hex');
    if (jwtPayload.request_body_sha256 !== expectedBodyHash) {
      console.error('❌ [Webhook] Body hash mismatch');
      return false;
    }

    // Fetch Plaid's public key and verify the JWT signature
    const publicKey = await fetchPlaidVerificationKey(keyId);
    if (!publicKey) {
      console.error('❌ [Webhook] Could not fetch Plaid public key for kid:', keyId);
      return false;
    }

    const signingInput = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2], 'base64url');
    const verifier = createVerify('SHA256');
    verifier.update(signingInput);
    const valid = verifier.verify(publicKey, signature);

    if (!valid) console.error('❌ [Webhook] JWT signature invalid');
    return valid;
  } catch (err) {
    console.error('❌ [Webhook] Verification error:', err);
    return false;
  }
}

/**
 * Handles Plaid webhook notifications for transaction updates
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🔔 [Webhook] Received Plaid webhook');

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

    // Verify webhook using Plaid's JWT-based signature scheme
    const signedJwt = request.headers.get('plaid-verification');
    if (signedJwt) {
      const valid = await verifyPlaidWebhook(body, signedJwt);
      if (!valid) {
        console.error('❌ [Webhook] Invalid Plaid JWT signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
      console.log('✅ [Webhook] Plaid JWT signature verified');
    } else if (process.env.NODE_ENV === 'production') {
      console.error('❌ [Webhook] Missing plaid-verification header in production');
      return NextResponse.json({ error: 'Webhook verification required' }, { status: 401 });
    } else {
      console.warn('⚠️ [Webhook] No signature header (development mode)');
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
