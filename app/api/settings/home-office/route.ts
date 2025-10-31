import { getHomeOfficeSettings } from '@/lib/firebase/settings-server';
export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data, error } = await getHomeOfficeSettings(user.uid);
    if (error) {
      return NextResponse.json({ error: error.message || 'Failed to load home office settings' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load home office settings', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { saveHomeOfficeSettings } from '@/lib/firebase/settings-server';

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 [Home Office Settings API] Starting request...');
    
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Home Office Settings API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ [Home Office Settings API] User authenticated:', user.uid);

    const settings = await request.json();

    // Validate required fields
    if (!settings.totalHomeSqFt || !settings.officeSqFt) {
      return NextResponse.json(
        { error: 'Total home square footage and office square footage are required' },
        { status: 400 }
      );
    }

    if (settings.officeSqFt >= settings.totalHomeSqFt) {
      return NextResponse.json(
        { error: 'Office square footage must be less than total home square footage' },
        { status: 400 }
      );
    }

    // Save settings
    const { data, error } = await saveHomeOfficeSettings(user.uid, settings);

    if (error) {
      console.error('❌ [Home Office Settings API] Failed to save settings:', error);
      return NextResponse.json(
        { error: 'Failed to save home office settings' },
        { status: 500 }
      );
    }

    console.log('✅ [Home Office Settings API] Successfully saved home office settings');

    return NextResponse.json({
      success: true,
      data
    });

  } catch (error) {
    console.error('❌ [Home Office Settings API] Unexpected error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to save home office settings',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
