import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { deleteUserData } from '@/lib/firebase/delete-user-data';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';

// DELETE /api/user/delete
export async function DELETE(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Deletion is destructive and retryable; bound retries durably and refuse
    // when the limiter store is unreachable (the deletion gate needs it anyway).
    const limit = await enforceRateLimit({ ...RATE_LIMITS.userDelete, key: user.uid });
    if (!limit.allowed) return rateLimitResponse(limit, { error: 'Too many deletion attempts. Please wait before retrying or contact support.' });

    // Delete all user data (profile, transactions, etc.)
    const { error } = await deleteUserData(user.uid);
    if (error) {
      return NextResponse.json({ error: 'Account deletion could not finish', details: error.message,
        code: error.code, retryable: error.retryable }, { status: error.status });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Account deletion could not finish. Please retry or contact support.',
      code: 'ACCOUNT_CLEANUP_FAILED', retryable: true }, { status: 503 });
  }
}
