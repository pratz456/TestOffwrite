import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb, FieldValue } from '@/lib/firebase/admin';
import { getRecordedQuarterlyPayments } from '@/lib/firebase/quarterly-payments-server';
import { getEstimatedTaxDeadline } from '@/lib/tax-provider/payment-deadlines';
import { getInstallmentDueDates } from '@/lib/tax-provider/quarterly-planner';
import { invalidJsonResponse, readJsonObject } from '@/app/api/_lib/body';

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
  designatedTaxYear: number | null;
  paymentType: 'estimated' | 'prior_year_overpayment' | null;
  confirmationNumber: string | null;
  paymentMethod: string | null;
  status: PaymentStatus;
  notes: string;
  penalty?: null;
}

function getDocId(quarter: number, year: number): string {
  return `Q${quarter}_${year}`;
}

const LEGACY_DOC_ID = /^Q([1-4])_(\d{4})$/;
const CLIENT_PAYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function designatedYear(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2000 && value <= 2100 ? value : null;
}

function clientPaymentId(value: unknown): string | null {
  if (typeof value !== 'string' || !CLIENT_PAYMENT_ID.test(value) || LEGACY_DOC_ID.test(value)) return null;
  return value;
}

function present(value: unknown): boolean {
  return !(value === undefined || value === null || value === '');
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
    designatedTaxYear: null,
    paymentType: null,
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

    const recorded = await getRecordedQuarterlyPayments(user.uid, year);
    const docIds = QUARTER_DEADLINES.map((q) => getDocId(q.quarter, year));
    const payments: QuarterlyPaymentRecord[] = [];

    for (const docId of docIds) {
      const [q, y] = docId.replace('Q', '').split('_').map(Number);
      const docSnap = await collectionRef.doc(docId).get();
      const counted = recorded.filter(payment => payment.quarter === q);
      const paidAmount = roundMoney(counted.reduce((sum, payment) => sum + Math.round(payment.paidAmount * 100), 0) / 100);
      const paidDates = counted
        .map(payment => payment.record?.paidDate)
        .filter((date): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
        .sort();

      let record: Omit<QuarterlyPaymentRecord, 'penalty'>;

      if (docSnap.exists) {
        const data = docSnap.data()!;
        record = {
          quarter: data.quarter ?? q,
          year: data.year ?? y,
          deadline: getDeadlineForQuarter(q, y).toISOString(),
          estimatedAmount: data.estimatedAmount ?? 0,
          paidAmount,
          paidDate: paidDates.at(-1) ?? null,
          designatedTaxYear: Number.isInteger(data.designatedTaxYear) ? data.designatedTaxYear : null,
          paymentType: data.paymentType === 'prior_year_overpayment' ? 'prior_year_overpayment' : null,
          confirmationNumber: data.confirmationNumber ?? null,
          paymentMethod: data.paymentMethod ?? null,
          status: paidAmount > 0 ? 'recorded' : 'no_record',
          notes: data.notes ?? '',
        };
      } else {
        record = { ...createDefaultPayment(q, y), paidAmount, paidDate: paidDates.at(-1) ?? null };
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

    const body = await readJsonObject(request);
    if (!body) return invalidJsonResponse();
    const {
      quarter,
      year,
      paidAmount,
      paidDate,
      confirmationNumber,
      paymentMethod,
      notes,
      designatedTaxYear,
      paymentType,
      priorReturnFiled,
      paymentId: rawPaymentId,
      recordId: rawRecordId,
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

    const applied = paymentType === 'prior_year_overpayment';
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
    if (applied && priorReturnFiled !== true) {
      const existing = await docRef.get();
      const current = existing.exists ? existing.data()! : createDefaultPayment(q, y);
      return NextResponse.json({ ...current, penalty: null });
    }
    const effectiveDateFor = (taxYear: number) => applied ? getInstallmentDueDates(taxYear)[0].dueDate : paidDate;
    const hasPaymentId = present(rawPaymentId);
    const paymentId = hasPaymentId ? clientPaymentId(rawPaymentId) : null;
    if (hasPaymentId && !paymentId) {
      return NextResponse.json({ error: 'Invalid payment id' }, { status: 400 });
    }
    const hasRecordId = present(rawRecordId);
    const recordId = hasRecordId && typeof rawRecordId === 'string' && LEGACY_DOC_ID.test(rawRecordId) ? rawRecordId : null;
    if (hasRecordId && !recordId) {
      return NextResponse.json({ error: 'Invalid payment record' }, { status: 400 });
    }
    const storedDesignation = designatedYear(designatedTaxYear);
    const taxYearFor = storedDesignation ?? y;

    if (paymentId) {
      const paymentRef = collectionRef.doc(paymentId);
      const legacyRef = recordId ? collectionRef.doc(recordId) : null;
      const saved = await adminDb.runTransaction(async transaction => {
        const snapshot = await transaction.get(paymentRef);
        const priorPaid = snapshot.exists ? roundMoney(Number(snapshot.data()?.paidAmount) || 0) : 0;
        if (snapshot.exists) {
          return { missing: false, record: snapshot.data()! };
        }
        if (legacyRef) {
          const legacy = await transaction.get(legacyRef);
          if (!legacy.exists) return { missing: true, record: null };
        }
        const paidAmount = roundMoney(priorPaid + amount);
        const record = {
          ...createDefaultPayment(q, taxYearFor),
          quarter: q, year: taxYearFor, paidAmount, paidDate: effectiveDateFor(taxYearFor),
          designatedTaxYear: storedDesignation,
          paymentType: applied ? 'prior_year_overpayment' as const : null,
          confirmationNumber: typeof confirmationNumber === 'string' ? confirmationNumber.slice(0, 200) : null,
          paymentMethod: typeof paymentMethod === 'string' ? paymentMethod.slice(0, 100) : null,
          notes: typeof notes === 'string' ? notes.slice(0, 2000) : '',
          status: paidAmount > 0 ? 'recorded' : 'no_record',
          penalty: null,
        };
        transaction.set(paymentRef, { ...record, updatedAt: FieldValue.serverTimestamp() });
        if (legacyRef) {
          transaction.set(legacyRef, { supersededBy: paymentId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        return { missing: false, record };
      });
      if (saved.missing || !saved.record) {
        return NextResponse.json({ error: 'Payment record not found' }, { status: 404 });
      }
      return NextResponse.json({ ...saved.record, penalty: null });
    }

    const updatedPayment = await adminDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(docRef);
      const prior = snapshot.exists ? snapshot.data()! : createDefaultPayment(q, y);
      const estimatedAmount = Number(prior.estimatedAmount) || 0;
      const paidAmount = (Math.round((Number(prior.paidAmount) || 0) * 100) + Math.round(amount * 100)) / 100;
      const record = {
        ...createDefaultPayment(q, y),
        estimatedAmount, paidAmount, paidDate: effectiveDateFor(y),
        designatedTaxYear: storedDesignation,
        paymentType: applied ? 'prior_year_overpayment' as const : null,
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

    const body = await readJsonObject(request);
    if (!body) return invalidJsonResponse();
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
