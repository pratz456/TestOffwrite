import { NextRequest, NextResponse } from 'next/server';
import { getUserProfile, upsertUserProfile } from '@/lib/firebase/profiles';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Get user profile using Firebase
    const { data: profile, error } = await getUserProfile(userId);

    if (error) {
      if (error.code === 'PGRST116') {
        // No profile found
        return NextResponse.json({ 
          success: true, 
          profile: null 
        });
      }
      console.error('Error fetching profile:', error);
      return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      profile
    });
  } catch (error) {
    console.error('Error in profiles API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch profile' },
      { status: 500 }
    );
  }
}
