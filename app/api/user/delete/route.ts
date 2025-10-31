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
      return NextResponse.json({ error: 'Failed to delete user data', details: error.message || error }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete user data', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
