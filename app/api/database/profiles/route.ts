import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserProfile, upsertUserProfile } from '@/lib/firebase/profiles';

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Users can only fetch their own profile
    const { data: profile, error } = await getUserProfile(user.uid);
    if (error) {
      console.error('Error fetching profile:', error);
      return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
    }
    return NextResponse.json({ success: true, profile });
  } catch (error) {
    console.error('Profile GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    // Strip any attempt to override userId
    const { userId: _ignored, ...safeFields } = body;
    
    const { error } = await upsertUserProfile(user.uid, safeFields);
    if (error) {
      console.error('Error upserting profile:', error);
      return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Profile POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
