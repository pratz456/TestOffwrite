export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { checkHistoricalAccess } from '@/lib/subscriptions/historical-access';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { adminDb } from '@/lib/firebase/admin';
import { buildColumnTaxPayload } from '@/lib/column-tax/adapter';
import { initializeTaxFiling } from '@/lib/column-tax/client';

export async function POST(request: NextRequest) {
  try {
    let uid: string | null = null;
    try {
      const { uid: headerUid } = await getUserFromReqOrThrow(request);
      uid = headerUid;
    } catch {
      const { user, error: authError } = await getAuthenticatedUser(request);
      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      uid = user.uid;
    }

    const access = await checkHistoricalAccess(uid);
    if (!access.hasAccess) {
      return NextResponse.json(
        {
          error: 'Subscription required',
          requiresSubscription: true,
          message:
            'An active subscription is required to file taxes. Please subscribe to access this feature.',
        },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { year } = body;
    if (!year) {
      return NextResponse.json(
        { error: 'Tax year is required' },
        { status: 400 },
      );
    }

    const [{ data: profile }, { data: transactions = [] }] = await Promise.all([
      getUserProfileServer(uid),
      getTransactionsServer(uid),
    ]);

    if (!profile) {
      return NextResponse.json(
        { error: 'User profile not found. Please complete your profile first.' },
        { status: 400 },
      );
    }

    const nameParts = (profile.name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const { payload, aggregation } = buildColumnTaxPayload({
      uid,
      email: profile.email,
      firstName,
      lastName,
      occupation: profile.profession || undefined,
      state: profile.state || undefined,
      transactions: transactions || [],
      taxYear: String(year),
      businessDescription: profile.business_purpose || profile.profession || 'Self-employed',
      businessName: profile.profession || undefined,
      ein: profile.ein || undefined,
      naicsCode: profile.naics_code || undefined,
      accountingMethod: 'cash',
      homeOfficeSqft: profile.home_office_details?.sqft || profile.home_office_sqft || undefined,
      homeOfficeSettings:
        profile.home_office_details &&
        profile.home_office_details.total_home_sqft &&
        profile.home_office_details.sqft
          ? {
              totalHomeSqFt: profile.home_office_details.total_home_sqft,
              officeSqFt: profile.home_office_details.sqft,
              rentOrMortgageInterest: 0,
              utilities: 0,
              insurance: 0,
              repairsMaintenance: 0,
              propertyTax: 0,
              other: 0,
            }
          : null,
    });

    const result = await initializeTaxFiling(payload);

    if (result.error || !result.data) {
      console.error('[Column Tax] initializeTaxFiling failed:', result.error);
      return NextResponse.json(
        { error: `Column Tax error: ${result.error || 'Unknown error'}` },
        { status: 502 },
      );
    }

    await adminDb
      .collection('user_profiles')
      .doc(uid)
      .update({
        columnTaxTaxpayerId: result.data.user_identifier,
        columnTaxFilingYear: parseInt(String(year), 10),
        columnTaxFilingStatus: 'draft',
        columnTaxLastSyncedAt: new Date(),
      });

    return NextResponse.json({
      success: true,
      userUrl: result.data.user_url,
      userIdentifier: result.data.user_identifier,
      dataErrors: result.data.data_errors || [],
      summary: {
        totalExpenses: aggregation.totalExpenses,
        totalDeductible: aggregation.totalDeductible,
        lineItemCount: aggregation.lineItemsArray.length,
        transactionCount: aggregation.counts.deductible,
      },
    });
  } catch (error) {
    console.error('[Column Tax] start-filing error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to start tax filing',
      },
      { status: 500 },
    );
  }
}
