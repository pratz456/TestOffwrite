/**
 * Tax Organizer API — stores the structured intake answers used to build a complete return.
 * GET ?year=2025  — fetch organizer for year
 * POST           — upsert organizer answers
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { encryptSensitive, sanitizeString } from '@/lib/security/utils';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const year = parseInt(request.nextUrl.searchParams.get('year') || String(new Date().getFullYear()), 10);
  const snap = await adminDb.collection('tax_organizers').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get();
  if (snap.empty) return NextResponse.json({ organizer: null, taxYear: year });
  const doc = snap.docs[0];
  return NextResponse.json({ organizer: { id: doc.id, ...doc.data() }, taxYear: year });
}

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json();
  const { taxYear, ...answers } = body;
  const year = taxYear ? parseInt(String(taxYear), 10) : new Date().getFullYear();
  // Upsert
  const snap = await adminDb.collection('tax_organizers').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get();
  // Encrypt sensitive fields before Firestore storage
  const encryptedAnswers = { ...answers };
  if (answers.taxpayerSSN && answers.taxpayerSSN.length === 9) {
    encryptedAnswers.taxpayerSSN = encryptSensitive(answers.taxpayerSSN);
  }
  if (answers.spouseSSN && answers.spouseSSN.length === 9) {
    encryptedAnswers.spouseSSN = encryptSensitive(answers.spouseSSN);
  }
  if (answers.bankAccount && answers.bankAccount.length > 3) {
    encryptedAnswers.bankAccount = encryptSensitive(answers.bankAccount);
  }
  // Sanitize text fields
  if (answers.dependentDetails) {
    encryptedAnswers.dependentDetails = sanitizeString(answers.dependentDetails, 2000);
  }
  const data = { userId: user.uid, taxYear: year, ...encryptedAnswers, updatedAt: new Date() };
  if (snap.empty) {
    const ref = await adminDb.collection('tax_organizers').add({ ...data, createdAt: new Date() });
    return NextResponse.json({ success: true, id: ref.id }, { status: 201 });
  } else {
    await snap.docs[0].ref.set(data, { merge: true });
    return NextResponse.json({ success: true, id: snap.docs[0].id });
  }
}
