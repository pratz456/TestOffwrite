export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';

/**
 * GET /api/plaid/import-status
 * Returns current Plaid transaction import status from user profile.
 * Used to show "Importing..." and to disable Re-sync when import is running.
 */
export async function GET(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);

    const profileDoc = await adminDb.doc(`user_profiles/${uid}`).get();
    const data = profileDoc.data();

    const hasConnection = !!(data?.plaid_token || data?.plaid_item_id);
    if (!hasConnection) {
      return NextResponse.json({ status: 'idle' });
    }

    const inProgress = data?.plaid_import_in_progress === true;
    const startedAt = data?.plaid_import_started_at;
    const startedAtMs = startedAt?.toMillis?.() ?? startedAt?.toDate?.()?.getTime?.() ?? (typeof startedAt === 'number' ? startedAt : 0);
    const STUCK_MS = 20 * 60 * 1000;
    const nowMs = Date.now();

    if (inProgress && startedAtMs && nowMs - startedAtMs > STUCK_MS) {
      await adminDb.doc(`user_profiles/${uid}`).update({ plaid_import_in_progress: false, plaid_import_started_at: null });
    }

    const resolvedInProgress = data?.plaid_import_in_progress === true;
    if (resolvedInProgress) {
      return NextResponse.json({
        status: 'running',
        startedAt: startedAtMs || null,
      });
    }

    const count = data?.plaid_imported_count;
    const lastSync = data?.last_sync;
    const earliestDate = data?.plaid_earliest_returned_tx_date ?? null;
    const requestedStart = data?.plaid_requested_start_date ?? null;

    return NextResponse.json({
      status: count != null ? 'done' : 'idle',
      importedCount: count ?? undefined,
      earliestDate: earliestDate ?? undefined,
      latestDate: undefined,
      startedAt: undefined,
      completedAt: undefined,
      lastSync: lastSync ?? undefined,
    });
  } catch (err) {
    console.error('[import-status] Error:', err);
    return NextResponse.json({ status: 'idle' }, { status: 200 });
  }
}
