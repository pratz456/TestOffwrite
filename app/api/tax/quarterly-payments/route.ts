import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb, FieldValue } from '@/lib/firebase/admin';
import { getRecordedQuarterlyPayments } from '@/lib/firebase/quarterly-payments-server';
import { getEstimatedTaxDeadline } from '@/lib/tax-provider/payment-deadlines';
import { holdPaymentEditForTests } from '@/lib/tax/payment-edit-hold';
import { appliedOverpaymentCreditDate, assignInstallmentPeriod } from '@/lib/tax-provider/quarterly-planner';
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
  editRecordId: string | null;
  editAmount: number | null;
  editPaidDate: string | null;
  editVersion: number | null;
  penalty?: null;
}

function getDocId(quarter: number, year: number): string {
  return `Q${quarter}_${year}`;
}

const LEGACY_DOC_ID = /^Q([1-4])_(\d{4})$/;
const CLIENT_PAYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const EDIT_ALREADY_SAVED = 'Another edit already saved this payment. Your change wasn\'t saved.';

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

function liveRecordId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (LEGACY_DOC_ID.test(value)) return value;
  return clientPaymentId(value);
}

function present(value: unknown): boolean {
  return !(value === undefined || value === null || value === '');
}

function storedVersion(data: Record<string, unknown> | undefined): number {
  const version = data?.version;
  return typeof version === 'number' && Number.isInteger(version) && version >= 0 ? version : 0;
}

function requestedBaseVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function getDeadlineForQuarter(quarter: number, year: number): Date {
  return getEstimatedTaxDeadline(year, quarter);
}

function createDefaultPayment(quarter: number, year: number): Omit<QuarterlyPaymentRecord, 'penalty' | 'editRecordId' | 'editAmount' | 'editPaidDate' | 'editVersion'> {
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
      const latestPaidDate = paidDates.at(-1) ?? null;
      const current = counted.find(payment => payment.record?.paidDate === latestPaidDate) ?? counted.at(-1);
      const detail = current?.record;
      const rawVersion = detail?.version;
      const editVersion = current
        ? (typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion >= 0 ? rawVersion : 0)
        : null;

      let record: Omit<QuarterlyPaymentRecord, 'penalty' | 'editRecordId' | 'editAmount' | 'editPaidDate' | 'editVersion'>;

      if (docSnap.exists) {
        const data = docSnap.data()!;
        const legacySuperseded = typeof data.supersededBy === 'string' && data.supersededBy.length > 0;
        const source = detail ?? (legacySuperseded ? null : data);
        const rawDesignated = source?.designatedTaxYear;
        record = {
          quarter: data.quarter ?? q,
          year: data.year ?? y,
          deadline: getDeadlineForQuarter(q, y).toISOString(),
          estimatedAmount: data.estimatedAmount ?? 0,
          paidAmount,
          paidDate: latestPaidDate,
          designatedTaxYear: typeof rawDesignated === 'number' && Number.isInteger(rawDesignated) ? rawDesignated : null,
          paymentType: source?.paymentType === 'prior_year_overpayment' ? 'prior_year_overpayment' : null,
          confirmationNumber: typeof source?.confirmationNumber === 'string' ? source.confirmationNumber : null,
          paymentMethod: typeof source?.paymentMethod === 'string' ? source.paymentMethod : null,
          status: paidAmount > 0 ? 'recorded' : 'no_record',
          notes: typeof source?.notes === 'string' ? source.notes : '',
        };
      } else {
        const rawDesignated = detail?.designatedTaxYear;
        record = {
          ...createDefaultPayment(q, y),
          paidAmount,
          paidDate: latestPaidDate,
          designatedTaxYear: typeof rawDesignated === 'number' && Number.isInteger(rawDesignated) ? rawDesignated : null,
          paymentType: detail?.paymentType === 'prior_year_overpayment' ? 'prior_year_overpayment' : null,
          confirmationNumber: typeof detail?.confirmationNumber === 'string' ? detail.confirmationNumber : null,
          paymentMethod: typeof detail?.paymentMethod === 'string' ? detail.paymentMethod : null,
          notes: typeof detail?.notes === 'string' ? detail.notes : '',
        };
        // A read must not create records or race a payment being saved.
      }

      payments.push({
        ...record,
        status: record.paidAmount > 0 ? 'recorded' : 'no_record',
        editRecordId: current?.id ?? null,
        editAmount: current ? current.paidAmount : null,
        editPaidDate: typeof detail?.paidDate === 'string' ? detail.paidDate : null,
        editVersion,
      });
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
      expectedLiveId: rawExpectedLiveId,
      baseVersion: rawBaseVersion,
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
    const effectiveDateFor = (taxYear: number) => applied ? appliedOverpaymentCreditDate(taxYear) : paidDate;
    const hasPaymentId = present(rawPaymentId);
    const paymentId = hasPaymentId ? clientPaymentId(rawPaymentId) : null;
    if (hasPaymentId && !paymentId) {
      return NextResponse.json({ error: 'Invalid payment id' }, { status: 400 });
    }
    const hasRecordId = present(rawRecordId);
    const legacyRecordId = hasRecordId && typeof rawRecordId === 'string' && LEGACY_DOC_ID.test(rawRecordId) ? rawRecordId : null;
    const clientRecordId = hasRecordId && typeof rawRecordId === 'string' ? clientPaymentId(rawRecordId) : null;
    const recordId = legacyRecordId ?? clientRecordId;
    if (hasRecordId && !recordId) {
      return NextResponse.json({ error: 'Invalid payment record' }, { status: 400 });
    }
    const hasExpectedLiveId = present(rawExpectedLiveId);
    const expectedLiveId = hasExpectedLiveId ? liveRecordId(rawExpectedLiveId) : null;
    if (hasExpectedLiveId && !expectedLiveId) {
      return NextResponse.json({ error: 'Invalid payment record' }, { status: 400 });
    }
    const storedDesignation = designatedYear(designatedTaxYear);
    const taxYearFor = storedDesignation ?? y;
    const baseVersion = requestedBaseVersion(rawBaseVersion);

    if (paymentId) {
      const paymentRef = collectionRef.doc(paymentId);
      const saved = await adminDb.runTransaction(async transaction => {
        const snapshot = await transaction.get(paymentRef);
        const paidOn = effectiveDateFor(taxYearFor);
        const quarterForDate = assignInstallmentPeriod(paidOn, taxYearFor).quarter;
        const nextAmount = roundMoney(amount);
        const sameSavedPayment = (data: Record<string, unknown> | undefined) => {
          if (!data) return false;
          const sameAmount = roundMoney(Number(data.paidAmount) || 0) === nextAmount;
          const sameDate = data.paidDate === paidOn;
          const sameYear = designatedYear(data.designatedTaxYear) === storedDesignation;
          const sameType = (data.paymentType === 'prior_year_overpayment') === applied;
          return sameAmount && sameDate && sameYear && sameType;
        };
        const buildRecord = (version: number) => ({
          ...createDefaultPayment(quarterForDate, taxYearFor),
          quarter: quarterForDate, year: taxYearFor, paidAmount: nextAmount, paidDate: paidOn,
          designatedTaxYear: storedDesignation,
          paymentType: applied ? 'prior_year_overpayment' as const : null,
          confirmationNumber: typeof confirmationNumber === 'string' ? confirmationNumber.slice(0, 200) : null,
          paymentMethod: typeof paymentMethod === 'string' ? paymentMethod.slice(0, 100) : null,
          notes: typeof notes === 'string' ? notes.slice(0, 2000) : '',
          status: nextAmount > 0 ? 'recorded' as const : 'no_record' as const,
          penalty: null,
          version,
        });
        const writePayment = (version: number) => {
          const record = buildRecord(version);
          transaction.set(paymentRef, { ...record, updatedAt: FieldValue.serverTimestamp() });
          return record;
        };

        // A replace compares the live record inside this transaction. A retry uses the same comparison.
        if (expectedLiveId) {
          const anchorId = recordId ?? expectedLiveId;
          const anchor = await transaction.get(collectionRef.doc(anchorId));
          if (!anchor.exists) return { missing: true, conflict: false, record: null };
          let liveId = anchorId;
          let liveExists = true;
          let liveData: Record<string, unknown> | undefined = anchor.data();
          let cursor: unknown = liveData?.supersededBy;
          for (let guard = 0; typeof cursor === 'string' && cursor.length > 0 && guard < 8; guard += 1) {
            liveId = cursor;
            const live = await transaction.get(collectionRef.doc(cursor));
            liveExists = live.exists;
            liveData = live.exists ? live.data() : undefined;
            const next: unknown = liveData?.supersededBy;
            if (typeof next === 'string' && next.length > 0 && next !== cursor) {
              cursor = next;
              continue;
            }
            break;
          }
          if (!liveExists) return { missing: true, conflict: false, record: null };
          const alreadyLive = snapshot.exists && sameSavedPayment(snapshot.data()) && liveId === paymentId;
          if (alreadyLive) return { missing: false, conflict: false, record: snapshot.data()! };
          if (liveId !== expectedLiveId) return { missing: false, conflict: true, record: null };
          await holdPaymentEditForTests();
          const liveVersion = storedVersion(liveData);
          if (baseVersion !== null && baseVersion !== liveVersion) {
            return { missing: false, conflict: true, record: null };
          }
          const record = writePayment(liveVersion + 1);
          const stamp = { supersededBy: paymentId, updatedAt: FieldValue.serverTimestamp() };
          if (liveId !== paymentId) transaction.set(collectionRef.doc(liveId), stamp, { merge: true });
          if (recordId && recordId !== liveId && recordId !== paymentId) {
            transaction.set(collectionRef.doc(recordId), stamp, { merge: true });
          }
          return { missing: false, conflict: false, record };
        }

        if (snapshot.exists) {
          if (sameSavedPayment(snapshot.data())) return { missing: false, conflict: false, record: snapshot.data()! };
          const liveVersion = storedVersion(snapshot.data());
          if (baseVersion !== null && baseVersion !== liveVersion) return { missing: false, conflict: true, record: null };
          return { missing: false, conflict: false, record: writePayment(liveVersion + 1) };
        }
        return { missing: false, conflict: false, record: writePayment(1) };
      });
      if (saved.conflict) {
        return NextResponse.json({ error: EDIT_ALREADY_SAVED }, { status: 409 });
      }
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
