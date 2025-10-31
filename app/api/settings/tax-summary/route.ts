import { getTaxSummarySettings } from '@/lib/firebase/settings-server';
export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data, error } = await getTaxSummarySettings(user.uid);
    if (error) {
      return NextResponse.json({ error: error.message || 'Failed to load tax summary settings' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load tax summary settings', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { saveTaxSummarySettings } from '@/lib/firebase/settings-server';

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 [Tax Summary Settings API] Starting request...');
    
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Tax Summary Settings API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ [Tax Summary Settings API] User authenticated:', user.uid);

    const settings = await request.json();

    // Validate required fields
    if (settings.scheduleCNetProfit === undefined || settings.scheduleCNetProfit === null) {
      return NextResponse.json(
        { error: 'Schedule C net profit is required' },
        { status: 400 }
      );
    }

    if (settings.scheduleCNetProfit < 0) {
      return NextResponse.json(
        { error: 'Schedule C net profit cannot be negative' },
        { status: 400 }
      );
    }

    if (settings.taxYear && (settings.taxYear < 2020 || settings.taxYear > new Date().getFullYear() + 1)) {
      return NextResponse.json(
        { error: 'Tax year must be between 2020 and next year' },
        { status: 400 }
      );
    }

    if (settings.adjustments && settings.adjustments < 0) {
      return NextResponse.json(
        { error: 'Adjustments cannot be negative' },
        { status: 400 }
      );
    }

    // Save settings
    const { data, error } = await saveTaxSummarySettings(user.uid, settings);

    if (error) {
      console.error('❌ [Tax Summary Settings API] Failed to save settings:', error);
      return NextResponse.json(
        { error: 'Failed to save tax summary settings' },
        { status: 500 }
      );
    }

    console.log('✅ [Tax Summary Settings API] Successfully saved tax summary settings');

    return NextResponse.json({
      success: true,
      data
    });

  } catch (error) {
    console.error('❌ [Tax Summary Settings API] Unexpected error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to save tax summary settings',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
