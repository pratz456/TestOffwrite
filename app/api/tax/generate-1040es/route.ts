import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getFederalTaxRules } from '@/lib/tax-rules/federal-year-rules';
import { QUARTERLY_REVIEW_MESSAGE } from '@/lib/tax-provider/regular-estimated-payments';

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await requireFeatureAccess(user.uid, 'exports');
  if (denied) return denied;
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Quarter and tax year are required.' }, { status: 400 });
  }
  if (!Number.isInteger(body?.quarter) || body.quarter < 1 || body.quarter > 4) {
    return NextResponse.json({ error: 'Invalid quarter (must be 1–4).' }, { status: 400 });
  }
  try { getFederalTaxRules(body.taxYear ?? body.year ?? new Date().getFullYear()); } catch {
    return NextResponse.json({ error: 'Select a supported tax year: 2024, 2025 or 2026.' }, { status: 400 });
  }
  // A submitted calculation object is not reviewed payment eligibility. The old
  // generated document was not an official IRS voucher and must not imply it is.
  return NextResponse.json({ error: QUARTERLY_REVIEW_MESSAGE, code: 'QUARTERLY_REVIEW_REQUIRED', officialFormUrl: 'https://www.irs.gov/pub/irs-pdf/f1040es.pdf' }, { status: 422 });
}
