/**
 * Tax Year Lock API
 * Locks a tax year to prevent data changes after filing.
 * Statuses: 'open' | 'authorized' | 'filed' | 'accepted' | 'rejected'
 *
 * GET  ?year=2025 — get lock status for year
 * POST            — create/update lock (admin/system use for filing status updates)
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

export type TaxYearStatus = 'open' | 'authorized' | 'submitted' | 'accepted' | 'rejected';

export interface TaxYearLock {
  userId: string;
  taxYear: number;
  status: TaxYearStatus;
  // Timestamps for each status transition
  authorizedAt?: string;
  submittedAt?: string;
  acceptedAt?: string;
  rejectedAt?: string;
  // IRS acknowledgment
  confirmationNumber?: string;
  rejectionCode?: string;
  rejectionMessage?: string;
  // Filing metadata
  form8879Id?: string;
  totalTaxFiled?: number;
  refundFiled?: number;
  amountOwedFiled?: number;
}

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const year = parseInt(request.nextUrl.searchParams.get('year') || String(new Date().getFullYear()), 10);
  const docId = `${user.uid}_${year}`;
  const doc = await adminDb.collection('tax_year_locks').doc(docId).get();

  if (!doc.exists) {
    return NextResponse.json({ lock: null, status: 'open', taxYear: year, isLocked: false });
  }

  const d = doc.data()!;
  const isLocked = ['submitted', 'accepted'].includes(d.status);

  return NextResponse.json({
    lock: {
      id: doc.id,
      ...d,
      authorizedAt: d.authorizedAt?.toDate?.()?.toISOString?.() || d.authorizedAt,
      submittedAt: d.submittedAt?.toDate?.()?.toISOString?.() || d.submittedAt,
      acceptedAt: d.acceptedAt?.toDate?.()?.toISOString?.() || d.acceptedAt,
    },
    status: d.status || 'open',
    taxYear: year,
    isLocked,
  });
}

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { taxYear, status, confirmationNumber, rejectionCode, rejectionMessage, totalTaxFiled, refundFiled, amountOwedFiled } = body;

  const year = taxYear ? parseInt(String(taxYear), 10) : new Date().getFullYear();
  const docId = `${user.uid}_${year}`;

  // Only allow progression, not regression (can't go from filed back to open)
  const statusOrder: TaxYearStatus[] = ['open', 'authorized', 'submitted', 'accepted', 'rejected'];
  const doc = await adminDb.collection('tax_year_locks').doc(docId).get();
  const currentStatus = (doc.exists ? doc.data()!.status : 'open') as TaxYearStatus;

  const currentIdx = statusOrder.indexOf(currentStatus);
  const newIdx = statusOrder.indexOf(status as TaxYearStatus);

  if (newIdx < currentIdx && status !== 'rejected') {
    return NextResponse.json({
      error: `Cannot move from '${currentStatus}' back to '${status}'`,
    }, { status: 400 });
  }

  const update: Record<string, any> = {
    userId: user.uid,
    taxYear: year,
    status,
    updatedAt: new Date(),
  };

  if (status === 'submitted') update.submittedAt = new Date();
  if (status === 'accepted') {
    update.acceptedAt = new Date();
    if (confirmationNumber) update.confirmationNumber = confirmationNumber;
    if (totalTaxFiled !== undefined) update.totalTaxFiled = totalTaxFiled;
    if (refundFiled !== undefined) update.refundFiled = refundFiled;
    if (amountOwedFiled !== undefined) update.amountOwedFiled = amountOwedFiled;
  }
  if (status === 'rejected') {
    update.rejectedAt = new Date();
    if (rejectionCode) update.rejectionCode = rejectionCode;
    if (rejectionMessage) update.rejectionMessage = rejectionMessage;
  }

  await adminDb.collection('tax_year_locks').doc(docId).set(update, { merge: true });

  return NextResponse.json({ success: true, status, taxYear: year });
}
