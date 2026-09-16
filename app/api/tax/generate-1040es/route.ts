import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getFederalTaxRules } from '@/lib/tax-rules/federal-year-rules';
import { QUARTERLY_REVIEW_MESSAGE } from '@/lib/tax-provider/regular-estimated-payments';
const headers = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers });

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return json({ error: 'Unauthorized' }, 401);
  const denied = await requireFeatureAccess(user.uid, 'exports');
  if (denied) return denied;
  let body;
  try { body = await request.json(); } catch {
    return json({ error: 'Quarter and tax year are required.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Number.isInteger(body.quarter) || body.quarter < 1 || body.quarter > 4) {
    return json({ error: 'Invalid quarter (must be 1–4).' }, 400);
  }
  const year = body.taxYear ?? body.year;
  try {
    if (!Number.isInteger(year) || (body.taxYear !== undefined && body.year !== undefined && body.taxYear !== body.year)) throw new Error('Invalid year');
    getFederalTaxRules(year);
  } catch {
    return json({ error: 'Select an explicit supported tax year: 2024, 2025 or 2026.' }, 400);
  }
  // A submitted calculation object is not reviewed payment eligibility. The old
  // generated document was not an official IRS voucher and must not imply it is.
  const officialFormUrl = year === 2026 ? 'https://www.irs.gov/pub/irs-pdf/f1040es.pdf' : `https://www.irs.gov/pub/irs-prior/f1040es--${year}.pdf`;
  return json({ error: QUARTERLY_REVIEW_MESSAGE, code: 'QUARTERLY_REVIEW_REQUIRED', taxYear: year,
    officialFormUrl, officialFormTaxYear: year, documentGenerated: false,
    officialFormNotice: 'IRS reference form only. WriteOff has not calculated a payment or generated a completed voucher. Confirm the form year and payment instructions with your preparer.' }, 422);
}
