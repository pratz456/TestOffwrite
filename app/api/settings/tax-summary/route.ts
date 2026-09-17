import { getTaxSummarySettings } from '@/lib/firebase/settings-server';
export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data, error } = await getTaxSummarySettings(user.uid);
    if (error?.code === 'NOT_FOUND') return NextResponse.json({ success: true, data: null });
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
import { invalidJsonResponse, readJsonObject } from '@/app/api/_lib/body';

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

    const body = await readJsonObject(request);
    if (!body) return invalidJsonResponse();
    // Only the three summary fields are stored; anything else in the body is ignored.
    const settings: { scheduleCNetProfit: number; taxYear?: number; adjustments?: number } = { scheduleCNetProfit: NaN };

    // Validate required fields
    if (body.scheduleCNetProfit === undefined || body.scheduleCNetProfit === null) {
      return NextResponse.json(
        { error: 'Schedule C net profit is required' },
        { status: 400 }
      );
    }

    if (typeof body.scheduleCNetProfit !== 'number' || !Number.isFinite(body.scheduleCNetProfit) || body.scheduleCNetProfit < 0) {
      return NextResponse.json(
        { error: 'Schedule C net profit cannot be negative' },
        { status: 400 }
      );
    }
    settings.scheduleCNetProfit = body.scheduleCNetProfit;

    if (body.taxYear !== undefined && body.taxYear !== null) {
      if (typeof body.taxYear !== 'number' || !Number.isInteger(body.taxYear) || body.taxYear < 2020 || body.taxYear > new Date().getFullYear() + 1) {
        return NextResponse.json(
          { error: 'Tax year must be between 2020 and next year' },
          { status: 400 }
        );
      }
      settings.taxYear = body.taxYear;
    }

    if (body.adjustments !== undefined && body.adjustments !== null) {
      if (typeof body.adjustments !== 'number' || !Number.isFinite(body.adjustments) || body.adjustments < 0) {
        return NextResponse.json(
          { error: 'Adjustments cannot be negative' },
          { status: 400 }
        );
      }
      settings.adjustments = body.adjustments;
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
