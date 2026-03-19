import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb, FieldValue } from '@/lib/firebase/admin';

const QUARTER_DEADLINES: { quarter: number; month: number; day: number; nextYear?: boolean }[] = [
  { quarter: 1, month: 3, day: 15 },   // April 15
  { quarter: 2, month: 5, day: 15 },   // June 15
  { quarter: 3, month: 8, day: 15 },   // September 15
  { quarter: 4, month: 0, day: 15, nextYear: true }, // January 15 (next year)
];

type PaymentStatus = 'paid' | 'overdue' | 'due' | 'upcoming' | 'unpaid';

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
  penalty?: number;
}

function getDocId(quarter: number, year: number): string {
  return `Q${quarter}_${year}`;
}

function getDeadlineForQuarter(quarter: number, year: number): Date {
  const config = QUARTER_DEADLINES.find((q) => q.quarter === quarter);
  if (!config) throw new Error(`Invalid quarter: ${quarter}`);
  const targetYear = config.nextYear ? year + 1 : year;
  return new Date(targetYear, config.month, config.day);
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
    status: 'unpaid',
    notes: '',
  };
}

function computeStatusAndPenalty(
  record: Omit<QuarterlyPaymentRecord, 'penalty'>,
  now: Date
): { status: PaymentStatus; penalty?: number } {
  const deadline = new Date(record.deadline);
  const isPaid = record.paidAmount >= record.estimatedAmount;
  const daysOverdue = Math.floor((now.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24));
  const daysUntilDeadline = Math.floor((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (isPaid) {
    return { status: 'paid' };
  }

  if (daysOverdue > 0) {
    const unpaidAmount = Math.max(0, record.estimatedAmount - record.paidAmount);
    const penalty = unpaidAmount * 0.08 * (daysOverdue / 365);
    return { status: 'overdue', penalty };
  }

  if (daysUntilDeadline <= 14) {
    return { status: 'due' };
  }

  return { status: 'upcoming' };
}

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get('year');
    const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

    if (isNaN(year)) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    }

    console.log('💰 [Quarterly Payments] GET for user:', user.uid, 'year:', year);

    const collectionRef = adminDb
      .collection('user_profiles')
      .doc(user.uid)
      .collection('quarterly_payments');

    const docIds = QUARTER_DEADLINES.map((q) => getDocId(q.quarter, year));
    const payments: QuarterlyPaymentRecord[] = [];
    const now = new Date();

    for (const docId of docIds) {
      const [q, y] = docId.replace('Q', '').split('_').map(Number);
      const docSnap = await collectionRef.doc(docId).get();

      let record: Omit<QuarterlyPaymentRecord, 'penalty'>;

      if (docSnap.exists) {
        const data = docSnap.data()!;
        record = {
          quarter: data.quarter ?? q,
          year: data.year ?? y,
          deadline: data.deadline ?? getDeadlineForQuarter(q, y).toISOString(),
          estimatedAmount: data.estimatedAmount ?? 0,
          paidAmount: data.paidAmount ?? 0,
          paidDate: data.paidDate ?? null,
          confirmationNumber: data.confirmationNumber ?? null,
          paymentMethod: data.paymentMethod ?? null,
          status: data.status ?? 'unpaid',
          notes: data.notes ?? '',
        };
      } else {
        record = createDefaultPayment(q, y);
        await collectionRef.doc(docId).set({
          ...record,
          updatedAt: FieldValue.serverTimestamp(),
        });
        console.log('💰 [Quarterly Payments] Created default record:', docId);
      }

      const { status, penalty } = computeStatusAndPenalty(record, now);
      payments.push({
        ...record,
        status,
        ...(penalty !== undefined && { penalty }),
      });
    }

    payments.sort((a, b) => a.quarter - b.quarter);

    const totalEstimated = payments.reduce((s, p) => s + p.estimatedAmount, 0);
    const totalPaid = payments.reduce((s, p) => s + p.paidAmount, 0);
    const totalRemaining = Math.max(0, totalEstimated - totalPaid);
    const totalPenalty = payments.reduce((s, p) => s + (p.penalty ?? 0), 0);

    return NextResponse.json({
      payments,
      summary: {
        totalEstimated,
        totalPaid,
        totalRemaining,
        totalPenalty,
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

    if (isNaN(q) || isNaN(y) || isNaN(amount) || amount < 0) {
      return NextResponse.json({ error: 'Invalid quarter, year, or paidAmount' }, { status: 400 });
    }

    console.log('💰 [Quarterly Payments] POST record payment:', { quarter: q, year: y, paidAmount: amount });

    const docId = getDocId(q, y);
    const collectionRef = adminDb
      .collection('user_profiles')
      .doc(user.uid)
      .collection('quarterly_payments');

    const docRef = collectionRef.doc(docId);
    const docSnap = await docRef.get();

    let estimatedAmount = 0;
    let existingPaidAmount = 0;

    if (docSnap.exists) {
      const data = docSnap.data()!;
      estimatedAmount = data.estimatedAmount ?? 0;
      existingPaidAmount = data.paidAmount ?? 0;
    } else {
      const defaultRecord = createDefaultPayment(q, y);
      estimatedAmount = defaultRecord.estimatedAmount;
      await docRef.set({
        ...defaultRecord,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const newPaidAmount = existingPaidAmount + amount;
    const isPaid = newPaidAmount >= estimatedAmount;

    const updateData: Record<string, unknown> = {
      paidAmount: newPaidAmount,
      paidDate: paidDate,
      confirmationNumber: confirmationNumber ?? null,
      paymentMethod: paymentMethod ?? null,
      notes: notes ?? '',
      status: isPaid ? 'paid' : 'unpaid',
      updatedAt: FieldValue.serverTimestamp(),
    };

    await docRef.update(updateData);

    const deadline = getDeadlineForQuarter(q, y);
    const updatedPayment = {
      quarter: q,
      year: y,
      deadline: deadline.toISOString(),
      estimatedAmount,
      paidAmount: newPaidAmount,
      paidDate,
      confirmationNumber: confirmationNumber ?? null,
      paymentMethod: paymentMethod ?? null,
      status: isPaid ? 'paid' : 'unpaid',
      notes: notes ?? '',
    };

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

    if (isNaN(q) || isNaN(y) || isNaN(amount) || amount < 0) {
      return NextResponse.json({ error: 'Invalid quarter, year, or estimatedAmount' }, { status: 400 });
    }

    console.log('💰 [Quarterly Payments] PUT update estimated:', { quarter: q, year: y, estimatedAmount: amount });

    const docId = getDocId(q, y);
    const collectionRef = adminDb
      .collection('user_profiles')
      .doc(user.uid)
      .collection('quarterly_payments');

    const docRef = collectionRef.doc(docId);
    const docSnap = await docRef.get();

    let record: Omit<QuarterlyPaymentRecord, 'penalty'>;

    if (docSnap.exists) {
      const data = docSnap.data()!;
      record = {
        quarter: data.quarter ?? q,
        year: data.year ?? y,
        deadline: data.deadline ?? getDeadlineForQuarter(q, y).toISOString(),
        estimatedAmount: amount,
        paidAmount: data.paidAmount ?? 0,
        paidDate: data.paidDate ?? null,
        confirmationNumber: data.confirmationNumber ?? null,
        paymentMethod: data.paymentMethod ?? null,
        status: (data.paidAmount ?? 0) >= amount ? 'paid' : (data.status ?? 'unpaid'),
        notes: data.notes ?? '',
      };
    } else {
      record = {
        ...createDefaultPayment(q, y),
        estimatedAmount: amount,
      };
    }

    const isPaid = record.paidAmount >= amount;
    await docRef.set(
      {
        ...record,
        status: isPaid ? 'paid' : record.status,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({
      ...record,
      status: isPaid ? 'paid' : record.status,
    });
  } catch (error) {
    console.error('💰 [Quarterly Payments] PUT error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
