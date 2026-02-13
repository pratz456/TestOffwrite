/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import {setGlobalOptions, defineString} from "firebase-functions/v2/options";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Define config parameters
const siteUrl = defineString("SITE_URL", {
  description: "The base URL of the site for API calls",
  default: "https://writeoffapp.com",
});

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
setGlobalOptions({maxInstances: 10});

/**
 * Scheduled function that syncs transactions for all users every 2 hours (incremental sync).
 * Webhooks are the primary trigger; this is a fallback for missed webhooks.
 */
export const syncAllUsersTransactions = onSchedule(
  {
    schedule: "every 2 hours",
    timeZone: "America/New_York",
    retryCount: 1,
    maxInstances: 1, // Only one instance to avoid rate limits
  },
  async (event) => {
    logger.info("🔄 [Scheduled Sync] Starting scheduled transaction sync for all users...");

    try {
      // Get all users with connected bank accounts (have plaid_token)
      const usersSnapshot = await db
        .collection("user_profiles")
        .where("plaid_token", "!=", null)
        .get();

      const totalUsers = usersSnapshot.size;
      logger.info(`📊 [Scheduled Sync] Found ${totalUsers} users with connected bank accounts`);

      if (totalUsers === 0) {
        logger.info("✅ [Scheduled Sync] No users to sync");
        return;
      }

      let successCount = 0;
      let errorCount = 0;
      const errors: {userId: string; error: string}[] = [];

      // Process users in batches to avoid rate limits
      // Plaid has rate limits, so we process users sequentially with delays
      const BATCH_SIZE = 5;
      const DELAY_BETWEEN_BATCHES_MS = 2000; // 2 seconds between batches
      const DELAY_BETWEEN_USERS_MS = 500; // 0.5 seconds between users

      const users = usersSnapshot.docs;

      for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);

        // Process batch sequentially
        for (const userDoc of batch) {
          const userId = userDoc.id;
          const userData = userDoc.data();

          // Skip if no plaid token or user hasn't synced in a while
          if (!userData.plaid_token) {
            continue;
          }

          try {
            // Update last_scheduled_sync timestamp
            await db.doc(`user_profiles/${userId}`).update({
              last_scheduled_sync: admin.firestore.FieldValue.serverTimestamp(),
              last_scheduled_sync_status: "in_progress",
            });

            // Call the sync transactions API endpoint
            // Note: For Cloud Functions, we make a server-to-server call
            // The actual sync logic is in the Next.js API
            const baseUrl = siteUrl.value();
            const response = await fetch(`${baseUrl}/api/plaid/sync-transactions-internal`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Cloud-Function-Secret": process.env.CLOUD_FUNCTION_SECRET || "",
              },
              body: JSON.stringify({
                userId: userId,
                import_timeframe: "6months",
              }),
            });

            if (response.ok) {
              const result = await response.json();
              successCount++;
              logger.info(`✅ [Scheduled Sync] User ${userId}: Synced ${result.transactions_saved || 0} transactions`);

              await db.doc(`user_profiles/${userId}`).update({
                last_scheduled_sync_status: "success",
                last_scheduled_sync_transactions: result.transactions_saved || 0,
              });
            } else {
              const errorText = await response.text();
              errorCount++;
              errors.push({userId, error: errorText});
              logger.error(`❌ [Scheduled Sync] User ${userId}: API error - ${errorText}`);

              await db.doc(`user_profiles/${userId}`).update({
                last_scheduled_sync_status: "error",
                last_scheduled_sync_error: errorText.substring(0, 500),
              });
            }
          } catch (userError) {
            errorCount++;
            const errorMessage = userError instanceof Error ? userError.message : "Unknown error";
            errors.push({userId, error: errorMessage});
            logger.error(`❌ [Scheduled Sync] User ${userId}: ${errorMessage}`);

            await db.doc(`user_profiles/${userId}`).update({
              last_scheduled_sync_status: "error",
              last_scheduled_sync_error: errorMessage.substring(0, 500),
            }).catch(() => {
              // Ignore update errors
            });
          }

          // Small delay between users to avoid rate limits
          await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_USERS_MS));
        }

        // Delay between batches
        if (i + BATCH_SIZE < users.length) {
          await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
        }
      }

      logger.info(`✅ [Scheduled Sync] Completed. Success: ${successCount}, Errors: ${errorCount}`);

      if (errors.length > 0) {
        logger.warn(`⚠️ [Scheduled Sync] Errors encountered:`, errors.slice(0, 10));
      }
    } catch (error) {
      logger.error("❌ [Scheduled Sync] Fatal error:", error);
      throw error;
    }
  }
);
