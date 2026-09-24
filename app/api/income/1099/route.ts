export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { invalidJsonResponse, readJsonObject } from '@/app/api/_lib/body';

const FORM_TYPES = [
  '1099-NEC',
  '1099-K',
  '1099-MISC',
  '1099-INT',
  '1099-DIV',
  '1099-B',
] as const;

export type Form1099Type = (typeof FORM_TYPES)[number];

export interface Form1099 {
  id: string;
  formType: Form1099Type;
  payerName: string;
  amount: number;
  taxYear: number;
  userId: string;
  createdAt?: string;
}

function isValidFormType(v: string): v is Form1099Type {
  return FORM_TYPES.includes(v as Form1099Type);
}

function requestedTaxYear(value: unknown, currentYear: number): number | null {
  if (value === undefined || value === null || value === '') return currentYear;
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d{4}$/.test(String(value))) return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= currentYear ? year : null;
}

/** GET - List all 1099 forms for the authenticated user */
export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const yearParam = request.nextUrl.searchParams.get('year');
    const currentYear = new Date().getFullYear();
    const requestedYear = requestedTaxYear(yearParam, currentYear);
    if (requestedYear === null) {
      return NextResponse.json({ error: `Tax year must be a four-digit year from 2000 through ${currentYear}` }, { status: 400 });
    }

    const snapshot = await adminDb
      .collection('income_1099')
      .where('userId', '==', user.uid)
      .get();

    const forms: Form1099[] = snapshot.docs
      .map((doc) => {
      const d = doc.data();
      const createdAt = d.createdAt?.toDate?.();
      return {
        id: doc.id,
        formType: d.formType || '1099-NEC',
        payerName: d.payerName || '',
        amount: typeof d.amount === 'number' ? d.amount : Number(d.amount) || 0,
        taxYear: d.taxYear || requestedYear,
        userId: d.userId || user.uid,
        createdAt: createdAt ? createdAt.toISOString() : undefined,
      };
    })
      .filter((f) => f.taxYear === requestedYear);

    return NextResponse.json({ forms });
  } catch (err) {
    console.error('[income/1099 GET]', err);
    return NextResponse.json(
      { error: 'Failed to fetch 1099 forms' },
      { status: 500 }
    );
  }
}

/** POST - Create a new 1099 form */
export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await readJsonObject(request);
    if (!body) return invalidJsonResponse();
    const formType = typeof body.formType === 'string' && body.formType ? body.formType : '1099-NEC';
    const payerName = typeof body.payerName === 'string' ? body.payerName.trim().slice(0, 200) : '';
    const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount) || 0;
    const currentYear = new Date().getFullYear();
    const taxYear = requestedTaxYear(body.taxYear, currentYear);

    if (!isValidFormType(formType)) {
      return NextResponse.json(
        { error: 'Invalid form type. Must be one of: ' + FORM_TYPES.join(', ') },
        { status: 400 }
      );
    }
    if (!payerName) {
      return NextResponse.json(
        { error: 'Payer name is required' },
        { status: 400 }
      );
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
      return NextResponse.json(
        { error: 'Amount must be greater than 0' },
        { status: 400 }
      );
    }
    if (taxYear === null) {
      return NextResponse.json(
        { error: `Tax year must be a four-digit year from 2000 through ${currentYear}` },
        { status: 400 },
      );
    }

    const docRef = await adminDb.collection('income_1099').add({
      userId: user.uid,
      formType,
      payerName,
      amount,
      taxYear,
      createdAt: new Date(),
    });

    const doc = await docRef.get();
    const d = doc.data()!;
    const created = d.createdAt?.toDate?.();

    return NextResponse.json({
      form: {
        id: doc.id,
        formType: d.formType,
        payerName: d.payerName,
        amount: d.amount,
        taxYear: d.taxYear,
        userId: d.userId,
        createdAt: created ? created.toISOString() : undefined,
      },
    });
  } catch (err) {
    console.error('[income/1099 POST]', err);
    return NextResponse.json(
      { error: 'Failed to create 1099 form' },
      { status: 500 }
    );
  }
}

/** DELETE - Remove a 1099 form by id */
export async function DELETE(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        { error: 'Missing id query parameter' },
        { status: 400 }
      );
    }

    const docRef = adminDb.collection('income_1099').doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    const data = doc.data();
    if (data?.userId !== user.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await docRef.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[income/1099 DELETE]', err);
    return NextResponse.json(
      { error: 'Failed to delete 1099 form' },
      { status: 500 }
    );
  }
}
