import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { createLinkToken } from '@/lib/api';

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Always use the authenticated user's ID — never trust client-supplied userId
    const result = await createLinkToken(user.uid);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ linkToken: result.linkToken });
  } catch (error) {
    console.error('Error creating link token:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
