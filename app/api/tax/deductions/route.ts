/**
 * Above-the-Line Deductions API — stores health insurance premiums,
 * retirement contributions, HSA contributions, prior year total tax,
 * and other Schedule 1 deductions that affect SE calculations and Form 1040.
 *
 * GET  ?year=2025 — get deductions for user + year
 * POST            — save/update deductions (upsert by userId + taxYear)
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { validateDeductionEntry } from '@/lib/security/utils';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

export interface TaxDeductions {
  userId: string;
  taxYear: number;
  // Schedule 1, Line 17 — self-employed health insurance
  healthInsurancePremiums: number;
  // Schedule 1, Line 16 — retirement contributions
  sepIraContribution: number;
  solo401kEmployeeContribution: number;
  solo401kEmployerContribution: number;
  simpleIraContribution: number;
  // Schedule 1, Line 13 — HSA contributions
  hsaContribution: number;
  // For safe harbor quarterly estimate calculation
  priorYearTotalTax: number;
  // Student loan interest — Schedule 1, Line 21
  studentLoanInterest: number;
  updatedAt?: string;
}

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

  const snap = await adminDb
    .collection('tax_deductions')
    .where('userId', '==', user.uid)
    .where('taxYear', '==', year)
    .limit(1)
    .get();

  if (snap.empty) {
    return NextResponse.json({
      deductions: null,
      taxYear: year,
      message: 'No deductions saved for this year yet'
    });
  }

  const d = snap.docs[0].data();
  return NextResponse.json({
    deductions: {
      id: snap.docs[0].id,
      ...d,
      updatedAt: d.updatedAt?.toDate?.()?.toISOString?.() || '',
    },
    taxYear: year,
  });
}

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const dedValidation = validateDeductionEntry(body);
  if (!dedValidation.valid) {
    return NextResponse.json({ error: dedValidation.errors.join(', ') }, { status: 400 });
  }
  const {
    taxYear,
    healthInsurancePremiums = 0,
    sepIraContribution = 0,
    solo401kEmployeeContribution = 0,
    solo401kEmployerContribution = 0,
    simpleIraContribution = 0,
    hsaContribution = 0,
    priorYearTotalTax = 0,
    studentLoanInterest = 0,
  } = body;

  const year = taxYear ? parseInt(String(taxYear), 10) : new Date().getFullYear();

  const data = {
    userId: user.uid,
    taxYear: year,
    healthInsurancePremiums: Number(healthInsurancePremiums),
    sepIraContribution: Number(sepIraContribution),
    solo401kEmployeeContribution: Number(solo401kEmployeeContribution),
    solo401kEmployerContribution: Number(solo401kEmployerContribution),
    simpleIraContribution: Number(simpleIraContribution),
    hsaContribution: Number(hsaContribution),
    priorYearTotalTax: Number(priorYearTotalTax),
    studentLoanInterest: Number(studentLoanInterest),
    updatedAt: new Date(),
  };

  // Upsert
  const existing = await adminDb
    .collection('tax_deductions')
    .where('userId', '==', user.uid)
    .where('taxYear', '==', year)
    .limit(1)
    .get();

  let id: string;
  if (existing.empty) {
    const ref = await adminDb.collection('tax_deductions').add(data);
    id = ref.id;
  } else {
    id = existing.docs[0].id;
    await adminDb.collection('tax_deductions').doc(id).set(data, { merge: true });
  }

  return NextResponse.json({ success: true, id });
}
