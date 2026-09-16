/** Provider sandbox entrypoint. No tax return is transmitted by this route. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser, type AuthenticatedUser } from '@/lib/firebase/api-auth';
import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { filingSandboxConfig, isFilingSandboxIdentity } from '@/lib/tax-filing/config';
import { initializeColumnFiling, getColumnTaxReturn, validateColumnMetadata } from '@/lib/tax-filing/column-client';
const headers = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const identifier = (uid: string) => createHash('sha256').update(`writeoff-production-testing:column:sandbox:${uid}`).digest('hex');
function yearValue(value: unknown): number | null {
  const raw = String(value ?? '');
  return /^20\d{2}$/.test(raw) && [2024, 2025, 2026].includes(Number(raw)) ? Number(raw) : null;
}
async function metadataFor(user: AuthenticatedUser) {
  if (!Number.isSafeInteger(user.authTime)) return null;
  const record = await adminDb.doc(`filing_security_metadata/${user.uid}`).get();
  if (!record.exists) return null;
  const data = record.data();
  // Controlled fixtures only. Unknown history must not be converted to null/zero.
  if (data?.source !== 'controlled-sandbox-fixture' || data.authTime !== user.authTime) return null;
  const checkedAt = typeof data.checkedAt === 'string' ? Date.parse(data.checkedAt) : NaN;
  if (!Number.isFinite(checkedAt) || checkedAt > Date.now() || Date.now() - checkedAt > 300_000) return null;
  const metadata = validateColumnMetadata(data.metadata);
  if (metadata.passed_mfa_at_this_login !== (user.secondFactorVerified === true)) return null;
  return metadata;
}
export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return json({ error: 'Unauthorized' }, 401);
  const year = yearValue(request.nextUrl.searchParams.get('year'));
  if (!year) return json({ error: 'Choose a supported tax year.' }, 400);
  const config = filingSandboxConfig();
  const unavailable = { available: false, environment: null, taxYear: year, status: 'unavailable', message: 'In-app filing is not available yet. You can export records for a tax preparer.' };
  if (!config || !isFilingSandboxIdentity(user)) return json(unavailable);
  if (year !== config.taxYear) return json({ ...unavailable, message: `The filing sandbox is configured for ${config.taxYear}. No other year will be initialized.` });
  const denied = await requireFeatureAccess(user.uid, 'exports'); if (denied) return denied;
  try {
    if (!await metadataFor(user)) return json({ ...unavailable, message: 'The sandbox account needs fresh security verification before filing can open.' });
    const link = await adminDb.doc(`tax_filing_connections/${user.uid}`).get();
    const connection = link.data();
    const linked = connection?.provider === 'column' && connection.environment === 'sandbox' && connection.userIdentifier === identifier(user.uid)
      && connection.consentVersion === 'sandbox-identity-v1' && connection.taxYear === year;
    const taxReturn = linked ? await getColumnTaxReturn(config, identifier(user.uid), year) : null;
    return json({ available: true, environment: 'sandbox', taxYear: year, status: taxReturn?.status ?? (linked ? 'unknown' : 'not_started'),
      jurisdictions: taxReturn?.jurisdictions ?? [], message: 'Sandbox only. No IRS or state return is filed.' });
  } catch { return json({ error: 'Filing status could not be verified. Please retry.', code: 'FILING_STATUS_UNAVAILABLE' }, 503); }
}
export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return json({ error: 'Unauthorized' }, 401);
  const denied = await requireFeatureAccess(user.uid, 'exports'); if (denied) return denied;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['taxYear', 'consent'].includes(key))
    || !yearValue(body.taxYear) || body.consent !== true) return json({ error: 'Choose a supported year and confirm the stated data sharing.', code: 'FILING_CONSENT_REQUIRED' }, 400);
  const config = filingSandboxConfig();
  if (!config || !isFilingSandboxIdentity(user)) return json({ error: 'In-app filing is not available yet.', code: 'FILING_NOT_AVAILABLE' }, 503);
  if (body.taxYear !== config.taxYear) return json({ error: 'The selected year is not the provider-confirmed filing season.', code: 'FILING_YEAR_UNAVAILABLE' }, 409);
  try {
    const metadata = await metadataFor(user);
    if (!metadata) return json({ error: 'Fresh verified sandbox security information is required.', code: 'FILING_SECURITY_REVIEW_REQUIRED' }, 409);
    const userIdentifier = identifier(user.uid);
    const session = await initializeColumnFiling(config, { userIdentifier, email: user.email!, metadata });
    // initialize has no tax_year parameter. Verify the actual return year before opening.
    const taxReturn = await getColumnTaxReturn(config, userIdentifier, config.taxYear);
    if (!taxReturn) return json({ error: 'The provider did not return the selected tax year. No filing session was opened.', code: 'FILING_YEAR_UNAVAILABLE' }, 409);
    await adminDb.doc(`tax_filing_connections/${user.uid}`).set({ provider: 'column', environment: 'sandbox', userIdentifier,
      taxYear: config.taxYear, consentVersion: 'sandbox-identity-v1', consentedAt: new Date().toISOString() }, { merge: true });
    // Never persist or log the short-lived authenticated URL.
    return json({ environment: 'sandbox', taxYear: config.taxYear, userUrl: session.userUrl, status: taxReturn.status });
  } catch { return json({ error: 'The filing provider could not start a verified session. Please retry.', code: 'FILING_PROVIDER_UNAVAILABLE' }, 503); }
}
