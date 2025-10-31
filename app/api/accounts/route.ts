export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAccountsServer } from '@/lib/firebase/accounts-server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await getAccountsServer(user.uid);
    
    if (result.error) {
      return NextResponse.json({ 
        error: 'Failed to fetch accounts',
        details: result.error.message || result.error
      }, { status: 500 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    console.error('Error in accounts API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

