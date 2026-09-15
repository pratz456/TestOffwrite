export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { encryptSensitive, decryptSensitive, isEncrypted, sanitizeString } from '@/lib/security/utils';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

const privateHeaders = { 'Cache-Control': 'private, no-store' };
const sensitiveFields = ['taxpayerSSN', 'spouseSSN', 'bankAccount'] as const;
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
    const data = doc.data();
    // Return the owner's editable values; never show encryption bytes in form inputs.
    for (const field of sensitiveFields) {
      if (typeof data[field] === 'string' && isEncrypted(data[field])) data[field] = decryptSensitive(data[field]);
    }
    return NextResponse.json({ organizer: { ...data, id: doc.id }, taxYear: year }, { headers: privateHeaders });
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
    const encryptedAnswers = { ...answers };
    for (const field of sensitiveFields) {
      const value = answers[field];
      if (!value) continue;
      // A tab opened before this update may still hold its existing encrypted value.
      if (isEncrypted(value) && value === previous[field]) continue;
      const pattern = field === 'bankAccount' ? /^\d{4,17}$/ : /^\d{9}$/;
      if (!pattern.test(value)) return NextResponse.json({ error: `Invalid ${field === 'bankAccount' ? 'bank account number' : 'Social Security number'}` }, { status: 400 });
      encryptedAnswers[field] = encryptSensitive(value);
    }
    if (answers.dependentDetails) encryptedAnswers.dependentDetails = sanitizeString(answers.dependentDetails, 2000);
    const data = { ...encryptedAnswers, userId: user.uid, taxYear: year, updatedAt: new Date() };
    if (snap.empty) {
      const ref = await adminDb.collection('tax_organizers').add({ ...data, createdAt: new Date() });
      return NextResponse.json({ success: true, id: ref.id }, { status: 201, headers: privateHeaders });
    }
    await snap.docs[0].ref.set(data, { merge: true });
    return NextResponse.json({ success: true, id: snap.docs[0].id }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: 'Unable to save your organizer. Please try again.' }, { status: 503, headers: privateHeaders });
  }
}
