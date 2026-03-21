/**
 * Form 8879 — IRS e-file Signature Authorization API
 * Stores the taxpayer's PIN authorization and filing consent.
 * This is the legal prerequisite for e-filing on a user's behalf.
 *
 * GET  ?year=2025 — fetch existing authorization
 * POST            — create/update authorization (sign)
 * IRS Form 8879: https://www.irs.gov/forms-pubs/about-form-8879
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

export interface Form8879Record {
  id?: string;
  userId: string;
  taxYear: number;
  // Taxpayer info
  taxpayerName: string;
  // PIN authorization
  selfSelectPin: string;           // 5-digit PIN chosen by taxpayer
  // Return summary shown at time of signing
  adjustedGrossIncome: number;
  totalTax: number;
  federalIncomeTaxWithheld: number;
  refundAmount: number;
  amountOwed: number;
  // Consent flags
  consentToEFile: boolean;         // User authorized e-filing
  consentToDisclosure: boolean;    // User read the declaration
  // Metadata
  signedAt: string;                // ISO timestamp
  ipAddress?: string;
  userAgent?: string;
  status: 'signed' | 'pending' | 'revoked';
}

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const year = parseInt(request.nextUrl.searchParams.get('year') || String(new Date().getFullYear()), 10);
  const snap = await adminDb
    .collection('form_8879')
    .where('userId', '==', user.uid)
    .where('taxYear', '==', year)
    .orderBy('signedAt', 'desc')
    .limit(1)
    .get();

  if (snap.empty) return NextResponse.json({ authorization: null, taxYear: year });
  const doc = snap.docs[0];
  const d = doc.data();
  return NextResponse.json({
    authorization: {
      id: doc.id,
      ...d,
      // Never return the PIN itself — just confirm it was set
      selfSelectPin: d.selfSelectPin ? '•••••' : null,
      signedAt: d.signedAt?.toDate?.()?.toISOString?.() || d.signedAt,
    },
    taxYear: year,
  });
}

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const {
    taxYear,
    taxpayerName,
    selfSelectPin,
    adjustedGrossIncome,
    totalTax,
    federalIncomeTaxWithheld,
    refundAmount,
    amountOwed,
    consentToEFile,
    consentToDisclosure,
  } = body;

  // Validate PIN: must be 5 digits, not all zeros
  if (!selfSelectPin || !/^\d{5}$/.test(String(selfSelectPin)) || selfSelectPin === '00000') {
    return NextResponse.json({ error: 'PIN must be 5 digits and cannot be all zeros' }, { status: 400 });
  }

  if (!consentToEFile || !consentToDisclosure) {
    return NextResponse.json({ error: 'Both consent fields are required to authorize e-filing' }, { status: 400 });
  }

  if (!taxpayerName?.trim()) {
    return NextResponse.json({ error: 'Taxpayer name is required' }, { status: 400 });
  }

  const year = taxYear ? parseInt(String(taxYear), 10) : new Date().getFullYear();

  // Check if a tax year lock exists — cannot sign if already filed
  const lockSnap = await adminDb
    .collection('tax_year_locks')
    .where('userId', '==', user.uid)
    .where('taxYear', '==', year)
    .where('status', '==', 'filed')
    .limit(1)
    .get();

  if (!lockSnap.empty) {
    return NextResponse.json({ error: 'This tax year has already been filed and cannot be re-authorized' }, { status: 409 });
  }

  // Get client metadata for audit trail
  const forwardedFor = request.headers.get('x-forwarded-for');
  const userAgent = request.headers.get('user-agent') || '';
  const ipAddress = forwardedFor ? forwardedFor.split(',')[0].trim() : 'unknown';

  const record = {
    userId: user.uid,
    taxYear: year,
    taxpayerName: taxpayerName.trim(),
    selfSelectPin: String(selfSelectPin), // Store PIN (encrypt in production)
    adjustedGrossIncome: Number(adjustedGrossIncome) || 0,
    totalTax: Number(totalTax) || 0,
    federalIncomeTaxWithheld: Number(federalIncomeTaxWithheld) || 0,
    refundAmount: Number(refundAmount) || 0,
    amountOwed: Number(amountOwed) || 0,
    consentToEFile: true,
    consentToDisclosure: true,
    signedAt: new Date(),
    ipAddress,
    userAgent: userAgent.slice(0, 200),
    status: 'signed',
    updatedAt: new Date(),
  };

  // Upsert: one record per user per year
  const existing = await adminDb
    .collection('form_8879')
    .where('userId', '==', user.uid)
    .where('taxYear', '==', year)
    .limit(1)
    .get();

  let id: string;
  if (existing.empty) {
    const ref = await adminDb.collection('form_8879').add({ ...record, createdAt: new Date() });
    id = ref.id;
  } else {
    id = existing.docs[0].id;
    await adminDb.collection('form_8879').doc(id).set(record, { merge: true });
  }

  // Also update tax year lock to 'authorized' status
  await adminDb.collection('tax_year_locks').doc(`${user.uid}_${year}`).set({
    userId: user.uid,
    taxYear: year,
    status: 'authorized',
    authorizedAt: new Date(),
    form8879Id: id,
  }, { merge: true });

  return NextResponse.json({ success: true, id, status: 'signed', signedAt: new Date().toISOString() }, { status: 201 });
}
