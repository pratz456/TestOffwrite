import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { deleteUserData } from '@/lib/firebase/delete-user-data';

// DELETE /api/user/delete
export async function DELETE(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
