import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getFederalTaxRules, SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { currentCalendarYear, shouldHoldYear } from '@/lib/schedule-c/filed-year';
import { loadFiledYearState, readTaxYearConfirmation, startExportDeadline } from '@/lib/schedule-c/export-record';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const yearParam = request.nextUrl.searchParams.get('year');
  try {
    if (yearParam === null) {
      const confirmations: Record<string, string> = {};
      for (const year of SUPPORTED_TAX_YEARS) {
        const confirmation = await readTaxYearConfirmation(user.uid, year);
        if (confirmation) confirmations[String(year)] = confirmation.rulesVersion;
      }
      return NextResponse.json({ confirmations }, { headers });
    }
    if (!/^\d{4}$/.test(yearParam)) {
      return NextResponse.json({ error: 'Choose a supported tax year.' }, { status: 400, headers });
    }
    const year = Number(yearParam);
    try { getFederalTaxRules(year); } catch {
      return NextResponse.json({ error: 'Choose a supported tax year.' }, { status: 400, headers });
    }
    if (year >= currentCalendarYear()) {
      const confirmation = await readTaxYearConfirmation(user.uid, year);
      return NextResponse.json({
        prior: null,
        latestExportUnrecorded: false,
        confirmedRulesVersion: confirmation?.rulesVersion ?? null,
      }, { headers });
    }
    const filed = await loadFiledYearState(user.uid, year, startExportDeadline());
    if (filed.readFailed && shouldHoldYear(user.uid, year)) {
      return NextResponse.json({ error: 'Could not load all export records. Please retry.' }, { status: 503, headers });
    }
    return NextResponse.json({
      prior: filed.latestExportUnrecorded ? null : filed.stored,
      latestExportUnrecorded: filed.latestExportUnrecorded,
      confirmedRulesVersion: filed.confirmedRulesVersion,
    }, { headers });
  } catch {
    return NextResponse.json({ error: 'Could not load all export records. Please retry.' }, { status: 503, headers });
  }
}
