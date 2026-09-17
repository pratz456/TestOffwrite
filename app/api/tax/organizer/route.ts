export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { DEPENDENT_IDENTIFIERS_REMOVED_WARNING, encryptOrganizerIdentifiers } from '@/lib/tax-organizer/identifiers';
import { readOrganizerDocument } from '@/lib/tax-organizer/organizer-server';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

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
    if (snap.empty) return NextResponse.json({ organizer: null, taxYear: year }, { headers: privateHeaders });
    const doc = snap.docs[0];
    // Return the owner's editable values; never show encryption bytes in form inputs.
    // Legacy plaintext identifiers are re-encrypted on this read.
    const organizer = await readOrganizerDocument(doc);
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
    const snap = await adminDb.collection('tax_organizers').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get();
    const previous = snap.empty ? {} : snap.docs[0].data();
    const encrypted = encryptOrganizerIdentifiers(answers as Record<string, string>, previous);
    if ('error' in encrypted) return NextResponse.json({ error: encrypted.error }, { status: 400 });
    const data = { ...encrypted.answers, userId: user.uid, taxYear: year, updatedAt: new Date() };
    // The client replaces its copy with the redacted text so the identifiers are not resent on the next save.
    const redaction = encrypted.redactedTextFields.length
      ? { warning: DEPENDENT_IDENTIFIERS_REMOVED_WARNING, redacted: Object.fromEntries(encrypted.redactedTextFields.map(field => [field, encrypted.answers[field]])) }
      : {};
    if (snap.empty) {
      const ref = await adminDb.collection('tax_organizers').add({ ...data, createdAt: new Date() });
      return NextResponse.json({ success: true, id: ref.id, ...redaction }, { status: 201, headers: privateHeaders });
    }
    await snap.docs[0].ref.set(data, { merge: true });
    return NextResponse.json({ success: true, id: snap.docs[0].id, ...redaction }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: 'Unable to save your organizer. Please try again.' }, { status: 503, headers: privateHeaders });
  }
}
