/**
 * Gross Receipts API — manual income entries that flow to Schedule C Line 1.
 * Stores per-user income records in Firestore under:
 *   gross_receipts/{docId}  (fields: userId, taxYear, amount, source, description, date, type)
 *
 * GET  ?year=2025        — list all entries for user + year
 * POST                   — create new entry
 * DELETE ?id=xxx         — delete entry by id
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { validateGrossReceipt, sanitizeString, sanitizeAmount } from '@/lib/security/utils';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

export type IncomeType =
  | 'freelance'
  | 'consulting'
  | 'product_sales'
  | 'rental'
  | 'interest_dividends'
  | 'other';

export interface GrossReceiptEntry {
  id: string;
  userId: string;
  taxYear: number;
  amount: number;
  source: string;          // payer / client name
  description?: string;
  date: string;            // YYYY-MM-DD
  type: IncomeType;
  createdAt?: string;
}

function isValidYear(y: number) {
  return Number.isFinite(y) && y >= 2000 && y <= new Date().getFullYear() + 1;
}

// GET — list entries
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const yearParam = request.nextUrl.searchParams.get('year');
    const currentYear = new Date().getFullYear();
    const taxYear = yearParam ? parseInt(yearParam, 10) : currentYear;
    const year = isValidYear(taxYear) ? taxYear : currentYear;

    const snap = await adminDb
      .collection('gross_receipts')
      .where('userId', '==', user.uid)
      .where('taxYear', '==', year)
      .get();

    const entries: GrossReceiptEntry[] = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        userId: d.userId,
        taxYear: d.taxYear,
        amount: d.amount,
        source: d.source,
        description: d.description || '',
        date: d.date,
        type: d.type || 'other',
        createdAt: d.createdAt?.toDate?.()?.toISOString?.() || '',
      };
    });

    // Sort in JS to avoid composite index requirement
    entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const totalGrossReceipts = entries.reduce((s, e) => s + e.amount, 0);
    return NextResponse.json({ entries, totalGrossReceipts, taxYear: year });
  } catch (err) {
    console.error('[gross-receipts GET]', err);
    return NextResponse.json({ error: 'Failed to load income entries' }, { status: 500 });
  }
}

// POST — create entry
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { amount, source, description, date, type, taxYear } = body;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });
    }
    if (!source?.trim()) {
      return NextResponse.json({ error: 'Source / payer name is required' }, { status: 400 });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Date must be YYYY-MM-DD format' }, { status: 400 });
    }

    const year = taxYear ? parseInt(String(taxYear), 10) : parseInt(date.slice(0, 4), 10);
    if (!isValidYear(year)) {
      return NextResponse.json({ error: 'Invalid tax year' }, { status: 400 });
    }

    const docRef = await adminDb.collection('gross_receipts').add({
      userId: user.uid,
      taxYear: year,
      amount: Number(amount),
      source: source.trim(),
      description: description?.trim() || '',
      date,
      type: type || 'freelance',
      createdAt: new Date(),
    });

    return NextResponse.json({ success: true, id: docRef.id }, { status: 201 });
  } catch (err) {
    console.error('[gross-receipts POST]', err);
    return NextResponse.json({ error: 'Failed to save income entry' }, { status: 500 });
  }
}

// DELETE ?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const doc = await adminDb.collection('gross_receipts').doc(id).get();
    if (!doc.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (doc.data()?.userId !== user.uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    await adminDb.collection('gross_receipts').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[gross-receipts DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete income entry' }, { status: 500 });
  }
}
