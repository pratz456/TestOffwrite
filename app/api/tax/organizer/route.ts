export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { encryptOrganizerIdentifiers, restoreOrganizerFreeText, toOrganizerClientView, withoutRetiredOrganizerIdentifiers, withoutUneditedMaskedText } from '@/lib/tax-organizer/identifiers';
import { readOrganizerDocument } from '@/lib/tax-organizer/organizer-server';
import { readEligibilityFacts } from '@/lib/tax-rules/eligibility';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

function taxInputValue(value: unknown): string | number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

/** Other income and dependents only. The full organizer stays on the default GET. */
function organizerTaxInput(data: Record<string, unknown> | undefined) {
  return {
    amountOtherIncome: taxInputValue(data?.amountOtherIncome),
    dependents: taxInputValue(data?.dependents),
  };
}

function validYear(value: unknown): number | null {
  if (value === undefined || value === null) return new Date().getFullYear();
  const year = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(year) && year >= 2015 && year <= new Date().getFullYear() + 1 ? year : null;
}

export async function GET(request: NextRequest) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const year = validYear(request.nextUrl.searchParams.get('year'));
  if (!year) return NextResponse.json({ error: 'Invalid tax year' }, { status: 400 });
  try {
    const snap = await adminDb.collection('tax_organizers').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get();
    if (request.nextUrl.searchParams.get('view') === 'tax-input') {
      const data = snap.empty ? undefined : snap.docs[0].data() as Record<string, unknown>;
      return NextResponse.json(organizerTaxInput(data), { headers: privateHeaders });
    }
    if (snap.empty) return NextResponse.json({ organizer: null, taxYear: year }, { headers: privateHeaders });
    const doc = snap.docs[0];
    // Return the owner's editable values. This read does not write.
    const organizer = toOrganizerClientView(await readOrganizerDocument(doc));
    return NextResponse.json({ organizer: { ...organizer, id: doc.id }, taxYear: year }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: 'Unable to load your organizer. Please try again.' }, { status: 503, headers: privateHeaders });
  }
}

export async function POST(request: NextRequest) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid organizer' }, { status: 400 });
  if (body.userId && body.userId !== user.uid) return NextResponse.json({ error: 'Cannot change organizer owner' }, { status: 403 });
  const { taxYear, userId: _owner, id: _id, createdAt: _created, updatedAt: _updated, ...answers } = body;
  const year = validYear(taxYear);
  if (!year) return NextResponse.json({ error: 'Invalid tax year' }, { status: 400 });
  if (Object.values(answers).some(value => typeof value !== 'string' || value.length > 5000) || Object.keys(answers).length > 80) {
    return NextResponse.json({ error: 'Organizer answers must be text of at most 5,000 characters' }, { status: 400 });
  }
  try {
    const facts = readEligibilityFacts(answers.adjustmentEligibilityFacts);
    if (facts && facts.taxYear !== year) return NextResponse.json({ error: 'Eligibility answers must match the organizer tax year' }, { status: 400 });
  } catch { return NextResponse.json({ error: 'Invalid deduction eligibility answers; review the structured questions and save again' }, { status: 400 }); }
  try {
    const snap = await adminDb.collection('tax_organizers').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get();
    const previous = snap.empty ? {} : snap.docs[0].data();
    const restored = restoreOrganizerFreeText(withoutRetiredOrganizerIdentifiers(answers as Record<string, string>), previous);
    if ('error' in restored) return NextResponse.json({ error: restored.error }, { status: 400, headers: privateHeaders });
    const kept = withoutUneditedMaskedText(restored.answers, previous);
    // On an update, blank defaults for fields that were never stored are not edits.
    const writable = snap.empty ? kept : Object.fromEntries(Object.entries(kept).filter(([field, value]) => {
      if (value !== '') return true;
      const stored = previous[field];
      return typeof stored === 'string' && stored !== '';
    }));
    const encrypted = encryptOrganizerIdentifiers(writable, previous);
    if ('error' in encrypted) return NextResponse.json({ error: encrypted.error }, { status: 400 });
    if (snap.empty) {
      const data = { ...encrypted.answers, userId: user.uid, taxYear: year, updatedAt: new Date(), createdAt: new Date() };
      const ref = await adminDb.collection('tax_organizers').add(data);
      return NextResponse.json({ success: true, id: ref.id }, { status: 201, headers: privateHeaders });
    }
    // Unchanged masked read: do not merge a new timestamp over the stored bytes.
    if (Object.keys(encrypted.answers).length === 0) {
      return NextResponse.json({ success: true, id: snap.docs[0].id }, { headers: privateHeaders });
    }
    const data = { ...encrypted.answers, userId: user.uid, taxYear: year, updatedAt: new Date() };
    await snap.docs[0].ref.set(data, { merge: true });
    return NextResponse.json({ success: true, id: snap.docs[0].id }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: 'Unable to save your organizer. Please try again.' }, { status: 503, headers: privateHeaders });
  }
}
