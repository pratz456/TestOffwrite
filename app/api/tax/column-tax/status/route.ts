export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';

/**
 * Returns the Column Tax filing status stored in Firestore.
 *
 * Column Tax does not expose a "get filing status" REST endpoint —
 * status updates arrive via webhooks (see webhook/route.ts) which
 * write to the user_profiles document. This route simply reads
 * the latest cached status from Firestore.
 */
export async function GET(request: NextRequest) {
  try {
    let uid: string | null = null;
    try {
      const { uid: headerUid } = await getUserFromReqOrThrow(request);
      uid = headerUid;
    } catch {
      const { user, error: authError } = await getAuthenticatedUser(request);
      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      uid = user.uid;
    }

    const { data: profile } = await getUserProfileServer(uid);
    if (!profile?.columnTaxTaxpayerId) {
      return NextResponse.json({
        success: true,
        filingStatus: null,
        message: 'No Column Tax filing found for this user.',
      });
    }

    return NextResponse.json({
      success: true,
      filingStatus: profile.columnTaxFilingStatus || 'draft',
      filingYear: profile.columnTaxFilingYear,
      lastSyncedAt: profile.columnTaxLastSyncedAt
        ? new Date(
            typeof profile.columnTaxLastSyncedAt.toDate === 'function'
              ? profile.columnTaxLastSyncedAt.toDate()
              : profile.columnTaxLastSyncedAt,
          ).toISOString()
        : null,
    });
  } catch (error) {
    console.error('[Column Tax] status error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to check filing status',
      },
      { status: 500 },
    );
  }
}
