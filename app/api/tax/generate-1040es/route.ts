import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getFederalTaxRules } from '@/lib/tax-rules/federal-year-rules';
import { QUARTERLY_REVIEW_MESSAGE } from '@/lib/tax-provider/regular-estimated-payments';
import { readJsonBody } from '@/lib/http/json-body';
const headers = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers });

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return json({ error: 'Unauthorized' }, 401);
  const denied = await requireFeatureAccess(user.uid, 'exports');
  if (denied) return denied;
  const body = await readJsonBody(request);
  if (body instanceof NextResponse) return body.status === 413 ? body : json({ error: 'Quarter and tax year are required.' }, 400);
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as { quarter?: unknown; taxYear?: unknown; year?: unknown } : null;
  if (!record || !Number.isInteger(record.quarter) || (record.quarter as number) < 1 || (record.quarter as number) > 4) {
    return json({ error: 'Invalid quarter (must be 1–4).' }, 400);
  }
  const year = record.taxYear ?? record.year;
  try {
    if (!Number.isInteger(year) || (record.taxYear !== undefined && record.year !== undefined && record.taxYear !== record.year)) throw new Error('Invalid year');
    getFederalTaxRules(year as number);
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
