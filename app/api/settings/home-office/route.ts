import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getHomeOfficeSettings, saveHomeOfficeSettings } from '@/lib/firebase/settings-server';
import { validateHomeOfficePayload } from '@/lib/settings/home-office-payload';

export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data, error } = await getHomeOfficeSettings(user.uid);
    if (error?.code === 'NOT_FOUND') return NextResponse.json({ success: true, data: null });
    if (error) {
      return NextResponse.json({ error: 'Failed to load home office settings' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json({ error: 'Failed to load home office settings' }, { status: 500 });
  }
}

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

    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Send the home office settings as JSON.' }, { status: 400 }); }
    const { settings, errors } = validateHomeOfficePayload(body);
    if (errors.length) return NextResponse.json({ error: errors.join(' '), code: 'INVALID_HOME_OFFICE_INPUT' }, { status: 400 });
    if (!Object.keys(settings).length) return NextResponse.json({ error: 'Provide at least one home office setting to save.' }, { status: 400 });

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
        error: 'Failed to save home office settings'
      },
      { status: 500 }
    );
  }
}
