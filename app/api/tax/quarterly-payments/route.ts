import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb, FieldValue } from '@/lib/firebase/admin';
import { getEstimatedTaxDeadline } from '@/lib/tax-provider/payment-deadlines';

const QUARTER_DEADLINES: { quarter: number; month: number; day: number; nextYear?: boolean }[] = [
  { quarter: 1, month: 3, day: 15 },   // April 15
  { quarter: 2, month: 5, day: 15 },   // June 15
  { quarter: 3, month: 8, day: 15 },   // September 15
  { quarter: 4, month: 0, day: 15, nextYear: true }, // January 15 (next year)
];

type PaymentStatus = 'recorded' | 'no_record';

interface QuarterlyPaymentRecord {
  quarter: number;
  year: number;
  deadline: string;
  estimatedAmount: number;
  paidAmount: number;
  paidDate: string | null;
  confirmationNumber: string | null;
  paymentMethod: string | null;
  status: PaymentStatus;
  notes: string;
  penalty?: null;
}

function getDocId(quarter: number, year: number): string {
  return `Q${quarter}_${year}`;
}

function getDeadlineForQuarter(quarter: number, year: number): Date {
  return getEstimatedTaxDeadline(year, quarter);
}

function createDefaultPayment(quarter: number, year: number): Omit<QuarterlyPaymentRecord, 'penalty'> {
  const deadline = getDeadlineForQuarter(quarter, year);
  return {
    quarter,
    year,
    deadline: deadline.toISOString(),
    estimatedAmount: 0,
    paidAmount: 0,
    paidDate: null,
    confirmationNumber: null,
    paymentMethod: null,
    status: 'no_record',
    notes: '',
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get('year');
    const year = yearParam === null ? new Date().getFullYear() : Number(yearParam);

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    }

    console.log('💰 [Quarterly Payments] GET for user:', user.uid, 'year:', year);

    const collectionRef = adminDb
      .collection('user_profiles')
      .doc(user.uid)
      .collection('quarterly_payments');

    const docIds = QUARTER_DEADLINES.map((q) => getDocId(q.quarter, year));
    const payments: QuarterlyPaymentRecord[] = [];

    for (const docId of docIds) {
      const [q, y] = docId.replace('Q', '').split('_').map(Number);
      const docSnap = await collectionRef.doc(docId).get();

      let record: Omit<QuarterlyPaymentRecord, 'penalty'>;

      if (docSnap.exists) {
        const data = docSnap.data()!;
        record = {
          quarter: data.quarter ?? q,
          year: data.year ?? y,
          deadline: getDeadlineForQuarter(q, y).toISOString(),
          estimatedAmount: data.estimatedAmount ?? 0,
          paidAmount: data.paidAmount ?? 0,
          paidDate: data.paidDate ?? null,
          confirmationNumber: data.confirmationNumber ?? null,
          paymentMethod: data.paymentMethod ?? null,
          status: data.paidAmount > 0 ? 'recorded' : 'no_record',
          notes: data.notes ?? '',
        };
      } else {
        record = createDefaultPayment(q, y);
        // A read must not create records or race a payment being saved.
      }

      payments.push({ ...record, status: record.paidAmount > 0 ? 'recorded' : 'no_record' });
    }

    payments.sort((a, b) => a.quarter - b.quarter);

    const totalEstimated = payments.reduce((s, p) => s + p.estimatedAmount, 0);
    const totalPaid = payments.reduce((s, p) => s + p.paidAmount, 0);
    const totalRemaining = Math.max(0, totalEstimated - totalPaid);
    // User-entered targets and payment records do not establish tax penalties.

    return NextResponse.json({
      payments,
      summary: {
        totalEstimated,
        totalPaid,
        totalRemaining,
        totalPenalty: null,
        basis: 'user_entered_targets',
        reviewRequired: true,
      },
    });
  } catch (error) {
    console.error('💰 [Quarterly Payments] GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      quarter,
      year,
      paidAmount,
      paidDate,
      confirmationNumber,
      paymentMethod,
      notes,
    } = body;

    if (quarter == null || year == null || paidAmount == null || !paidDate) {
      return NextResponse.json(
        { error: 'Missing required fields: quarter, year, paidAmount, paidDate' },
        { status: 400 }
      );
    }

    const q = Number(quarter);
    const y = Number(year);
    const amount = Number(paidAmount);

    if (!Number.isInteger(q) || q < 1 || q > 4 || !Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: 'Invalid quarter, year, or paidAmount' }, { status: 400 });
    }

    console.log('💰 [Quarterly Payments] POST record payment:', { quarter: q, year: y, paidAmount: amount });

    const docId = getDocId(q, y);
    const collectionRef = adminDb
      .collection('user_profiles')
      .doc(user.uid)
      .collection('quarterly_payments');

    const docRef = collectionRef.doc(docId);
    if (typeof paidDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)
      || Number.isNaN(Date.parse(paidDate)) || new Date(paidDate).toISOString().slice(0, 10) !== paidDate) {
      return NextResponse.json({ error: 'Provide a valid payment date (YYYY-MM-DD).' }, { status: 400 });
    }
    const updatedPayment = await adminDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(docRef);
      const prior = snapshot.exists ? snapshot.data()! : createDefaultPayment(q, y);
      const estimatedAmount = Number(prior.estimatedAmount) || 0;
      const paidAmount = (Math.round((Number(prior.paidAmount) || 0) * 100) + Math.round(amount * 100)) / 100;
      const record = {
        ...createDefaultPayment(q, y),
        estimatedAmount, paidAmount, paidDate,
        confirmationNumber: typeof confirmationNumber === 'string' ? confirmationNumber.slice(0, 200) : null,
        paymentMethod: typeof paymentMethod === 'string' ? paymentMethod.slice(0, 100) : null,
        notes: typeof notes === 'string' ? notes.slice(0, 2000) : '',
        status: paidAmount > 0 ? 'recorded' : 'no_record',
        penalty: null,
      };
      transaction.set(docRef, { ...record, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return record;
    });

    return NextResponse.json(updatedPayment);
  } catch (error) {
    console.error('💰 [Quarterly Payments] POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { quarter, year, estimatedAmount } = body;

    if (quarter == null || year == null || estimatedAmount == null) {
      return NextResponse.json(
        { error: 'Missing required fields: quarter, year, estimatedAmount' },
        { status: 400 }
      );
    }

    const q = Number(quarter);
    const y = Number(year);
    const amount = Number(estimatedAmount);

    if (!Number.isInteger(q) || q < 1 || q > 4 || !Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: 'Invalid quarter, year, or estimatedAmount' }, { status: 400 });
    }

    console.log('💰 [Quarterly Payments] PUT update estimated:', { quarter: q, year: y, estimatedAmount: amount });

    const docId = getDocId(q, y);
    const collectionRef = adminDb
      .collection('user_profiles')
      .doc(user.uid)
      .collection('quarterly_payments');

    const docRef = collectionRef.doc(docId);
    const updatedRecord = await adminDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(docRef);
      const prior = snapshot.exists ? snapshot.data()! : createDefaultPayment(q, y);
      const paidAmount = Number(prior.paidAmount) || 0;
      const estimatedAmount = Math.round(amount * 100) / 100;
      const record = {
        ...createDefaultPayment(q, y), ...prior,
        quarter: q, year: y, deadline: getDeadlineForQuarter(q, y).toISOString(),
        estimatedAmount, paidAmount,
        status: paidAmount > 0 ? 'recorded' : 'no_record',
        penalty: null,
      };
      transaction.set(docRef, { ...record, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return record;
    });
    return NextResponse.json(updatedRecord);

  } catch (error) {
    console.error('💰 [Quarterly Payments] PUT error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
