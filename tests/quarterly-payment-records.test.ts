import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getEstimatedTaxDeadline } from '../lib/tax-provider/payment-deadlines';

const state = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), reads: [] as string[], writes: [] as string[], uid: 'owner-a' as string | null, transactions: 0 }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: state.uid ? { uid: state.uid } : null, error: state.uid ? null : 'Unauthorized' }) }));
vi.mock('@/lib/firebase/admin', () => {
  const snapshot = (path: string) => ({ exists: state.docs.has(path), data: () => state.docs.get(path) });
  const ref = (path: string): Record<string, unknown> => ({
    path,
    collection: (name: string) => ref(`${path}/${name}`),
    doc: (id: string) => ref(`${path}/${id}`),
    get: async () => {
      state.reads.push(path);
      const segments = path.split('/').filter(Boolean);
      if (segments.length % 2 === 1) {
        const prefix = `${path}/`;
        const docs = [...state.docs.keys()]
          .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .map(key => ({ id: key.slice(prefix.length), exists: true, data: () => state.docs.get(key) }));
        return { empty: docs.length === 0, docs, exists: false, data: () => undefined };
      }
      return snapshot(path);
    },
  });
  let queue = Promise.resolve();
  return {
    adminDb: {
      collection: (name: string) => ref(name),
      runTransaction: (callback: (transaction: unknown) => Promise<unknown>) => {
        state.transactions++;
        const result = queue.then(() => callback({
          get: async (document: { path: string }) => snapshot(document.path),
          set: (document: { path: string }, value: Record<string, unknown>, options?: { merge?: boolean }) => {
            state.writes.push(document.path);
            const prior = state.docs.get(document.path);
            state.docs.set(document.path, options?.merge ? { ...prior, ...value } : { ...value });
          },
        }));
        queue = result.then(() => undefined, () => undefined);
        return result;
      },
    },
    FieldValue: { serverTimestamp: () => 'synthetic-time' },
  };
});
import { GET, POST, PUT } from '../app/api/tax/quarterly-payments/route';
import { getRecordedQuarterlyPayments, totalRecordedPayments } from '../lib/firebase/quarterly-payments-server';
import { appliedOverpaymentCreditDate, buildQuarterlyPlan, matchPaymentsToPeriods, paymentsForInstallmentMatching } from '../lib/tax-provider/quarterly-planner';

const key = 'user_profiles/owner-a/quarterly_payments/Q1_2026';
function request(method: string, body?: unknown, year = '2026') {
  return new NextRequest(`http://localhost/api/tax/quarterly-payments?year=${year}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
beforeEach(() => { state.docs.clear(); state.reads.length = 0; state.writes.length = 0; state.uid = 'owner-a'; state.transactions = 0; vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('recorded quarterly payments', () => {
  it('reads only the authenticated owner/year path and the actual paidAmount field', async () => {
    state.docs.set(key, { paidAmount: 750.25, amount: 999999 });
    state.docs.set('user_profiles/owner-b/quarterly_payments/Q1_2026', { paidAmount: 900000 });
    state.docs.set('user_profiles/owner-a/quarterly_payments/Q1_2025', { paidAmount: 800000 });
    const payments = await getRecordedQuarterlyPayments('owner-a', 2026);
    expect(totalRecordedPayments(payments)).toBe(750.25);
    expect(state.reads.filter(path => /\/Q[1-4]_/.test(path))).toEqual([1, 2, 3, 4].map(q => `user_profiles/owner-a/quarterly_payments/Q${q}_2026`));
    expect(state.reads.some(path => path.includes('owner-b'))).toBe(false);
    expect(state.writes).toEqual([]);
  });

  it('returns unsaved default records on GET without creating paid or overdue zero-dollar obligations', async () => {
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.payments).toHaveLength(4);
    expect(data.payments.every((p: { paidAmount: number; status: string }) => p.paidAmount === 0 && p.status === 'no_record')).toBe(true);
    expect(state.docs.size).toBe(0);
    expect(state.writes).toEqual([]);
  });

  it('records concurrent payments atomically and keeps estimate updates from overwriting their total', async () => {
    state.docs.set(key, { paidAmount: 10.01, estimatedAmount: 500 });
    const [first, second] = await Promise.all([
      POST(request('POST', { quarter: 1, year: 2026, paidAmount: 100.02, paidDate: '2026-04-15' })),
      POST(request('POST', { quarter: 1, year: 2026, paidAmount: 200.03, paidDate: '2026-04-15' })),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(state.docs.get(key)?.paidAmount).toBe(310.06);
    const updated = await PUT(request('PUT', { quarter: 1, year: 2026, estimatedAmount: 300 }));
    expect(updated.status).toBe(200);
    expect(state.docs.get(key)?.paidAmount).toBe(310.06);
    expect(state.docs.get(key)?.estimatedAmount).toBe(300);
    expect(state.transactions).toBe(3);
    const result = await (await GET(request('GET'))).json();
    expect(result.payments[0].status).toBe('recorded');
    expect(result.payments[0]).not.toHaveProperty('penalty');
    expect(result.summary.totalPenalty).toBeNull();
  });

  it('does not fabricate an8% penalty or paid-in-full verdict from an expired manual target', async () => {
    state.docs.set(key, { quarter: 1, year: 2026, estimatedAmount: 99999, paidAmount: 1, status: 'overdue', penalty: 888 });
    const result = await (await GET(request('GET'))).json();
    expect(result.payments[0]).toMatchObject({ status: 'recorded', paidAmount: 1 });
    expect(result.payments[0]).not.toHaveProperty('penalty');
    expect(result.summary).toMatchObject({ totalPenalty: null, reviewRequired: true, basis: 'user_entered_targets' });
  });

  it.each([
    { quarter: 0, year: 2026, paidAmount: 100, paidDate: '2026-04-15' },
    { quarter: 1.5, year: 2026, paidAmount: 100, paidDate: '2026-04-15' },
    { quarter: 5, year: 2026, paidAmount: 100, paidDate: '2026-04-15' },
    { quarter: 1, year: 2026.5, paidAmount: 100, paidDate: '2026-04-15' },
    { quarter: 1, year: 2026, paidAmount: -1, paidDate: '2026-04-15' },
    { quarter: 1, year: 2026, paidAmount: 100, paidDate: '2026-02-30' },
  ])('rejects invalid payment data before a write %j', async body => {
    expect((await POST(request('POST', body))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });

  it('rejects unauthenticated read and write requests', async () => {
    state.uid = null;
    expect((await GET(request('GET'))).status).toBe(401);
    expect((await POST(request('POST', {}))).status).toBe(401);
    expect((await PUT(request('PUT', {}))).status).toBe(401);
    expect(state.reads).toEqual([]);
    expect(state.writes).toEqual([]);
  });

  const idA = '11111111-1111-4111-8111-111111111111';
  const idB = '22222222-2222-4222-8222-222222222222';
  const pathFor = (id: string) => `user_profiles/owner-a/quarterly_payments/${id}`;
  async function counted(year = 2026) {
    return totalRecordedPayments(await getRecordedQuarterlyPayments('owner-a', year));
  }

  it('counts one client payment id once when the same save is sent again', async () => {
    const body = { paymentId: idA, quarter: 1, year: 2026, paidAmount: 100, paidDate: '2026-04-15' };
    expect((await POST(request('POST', body))).status).toBe(200);
    const writesAfterFirst = state.writes.length;
    const retry = await POST(request('POST', body));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ paidAmount: 100, paidDate: '2026-04-15' });
    expect(state.docs.get(pathFor(idA))).toMatchObject({ paidAmount: 100, paidDate: '2026-04-15', year: 2026 });
    expect(state.writes.length).toBe(writesAfterFirst);
    expect(await counted()).toBe(100);
    expect(state.docs.has(key)).toBe(false);
  });

  it('counts two different client payment ids as two payments and keeps each date', async () => {
    expect((await POST(request('POST', {
      paymentId: idA, quarter: 1, year: 2026, paidAmount: 100, paidDate: '2026-04-15',
      paymentType: 'prior_year_overpayment', priorReturnFiled: true,
    }))).status).toBe(200);
    expect((await POST(request('POST', {
      paymentId: idB, quarter: 1, year: 2026, paidAmount: 40, paidDate: '2026-06-01',
    }))).status).toBe(200);
    expect(state.docs.get(pathFor(idA))).toMatchObject({ paidAmount: 100, paidDate: '2026-04-15', paymentType: 'prior_year_overpayment' });
    expect(state.docs.get(pathFor(idB))).toMatchObject({ paidAmount: 40, paidDate: '2026-06-01', paymentType: null });
    expect(await counted()).toBe(140);
    expect(state.docs.has(key)).toBe(false);
  });

  it('still saves a payment that has no client id', async () => {
    const response = await POST(request('POST', { quarter: 1, year: 2026, paidAmount: 80, paidDate: '2026-04-15' }));
    expect(response.status).toBe(200);
    expect(state.docs.get(key)?.paidAmount).toBe(80);
    expect(state.docs.get(key)?.paidDate).toBe('2026-04-15');
    expect(await counted()).toBe(80);
  });

  it('stores a January payment on the tax year it is for, apart from another payment in that quarter', async () => {
    expect((await POST(request('POST', {
      paymentId: idA, quarter: 4, year: 2026, designatedTaxYear: 2025, paidAmount: 10, paidDate: '2027-01-10',
    }))).status).toBe(200);
    expect((await POST(request('POST', {
      paymentId: idB, quarter: 4, year: 2026, designatedTaxYear: 2026, paidAmount: 20, paidDate: '2027-01-12',
    }))).status).toBe(200);
    const idC = '33333333-3333-4333-8333-333333333333';
    expect((await POST(request('POST', {
      paymentId: idC, quarter: 4, year: 2026, designatedTaxYear: 2027, paidAmount: 30, paidDate: '2027-01-10',
    }))).status).toBe(200);
    expect(state.docs.get(pathFor(idA))).toMatchObject({ year: 2025, designatedTaxYear: 2025, paidAmount: 10, paidDate: '2027-01-10' });
    expect(state.docs.get(pathFor(idB))).toMatchObject({ year: 2026, designatedTaxYear: 2026, paidAmount: 20, paidDate: '2027-01-12' });
    expect(state.docs.get(pathFor(idC))).toMatchObject({ year: 2027, designatedTaxYear: 2027, paidAmount: 30 });
    expect(state.docs.has('user_profiles/owner-a/quarterly_payments/Q4_2026')).toBe(false);
    expect(await counted(2025)).toBe(10);
    expect(await counted(2026)).toBe(20);
    expect(await counted(2027)).toBe(30);
  });

  it('keeps an edited legacy payment at $2,125 so past due does not drop', async () => {
    const legacy = { quarter: 1, year: 2026, paidAmount: 2125, paidDate: '2026-04-01', estimatedAmount: 0 };
    const untouched = { quarter: 2, year: 2026, paidAmount: 0, paidDate: null, notes: 'leave this record alone' };
    state.docs.set(key, { ...legacy });
    state.docs.set('user_profiles/owner-a/quarterly_payments/Q2_2026', { ...untouched });
    const response = await POST(request('POST', {
      recordId: 'Q1_2026', paymentId: idA, quarter: 1, year: 2026, paidAmount: 2125, paidDate: '2026-04-10',
    }));
    expect(response.status).toBe(200);
    expect(state.docs.get(key)).toMatchObject({ ...legacy, supersededBy: idA });
    expect(state.docs.get('user_profiles/owner-a/quarterly_payments/Q2_2026')).toEqual(untouched);
    expect(state.writes.some(path => path.endsWith('Q2_2026'))).toBe(false);
    expect(state.docs.get(pathFor(idA))).toMatchObject({ paidAmount: 2125, paidDate: '2026-04-10', year: 2026 });
    const saved = await getRecordedQuarterlyPayments('owner-a', 2026);
    expect(totalRecordedPayments(saved)).toBe(2125);
    const plan = buildQuarterlyPlan({
      taxYear: 2026, filingStatus: 'single', currentYearTax: null, withholding: 0,
      priorYear: { available: true, totalTax: 8500, agi: 100000, coveredTwelveMonths: true },
      asOf: '2026-10-22',
      payments: saved.filter(payment => payment.paidAmount > 0).map(payment => ({
        amount: payment.paidAmount,
        paidDate: typeof payment.record?.paidDate === 'string' ? payment.record.paidDate : null,
        recordedQuarter: payment.quarter,
      })),
    });
    const doubled = buildQuarterlyPlan({
      taxYear: 2026, filingStatus: 'single', currentYearTax: null, withholding: 0,
      priorYear: { available: true, totalTax: 8500, agi: 100000, coveredTwelveMonths: true },
      asOf: '2026-10-22',
      payments: [
        { amount: 2125, paidDate: '2026-04-01', recordedQuarter: 1 },
        { amount: 2125, paidDate: '2026-04-10', recordedQuarter: 1 },
      ],
    });
    expect(plan.pastDue?.amount).toBe(4250);
    expect(doubled.pastDue!.amount).toBeLessThan(plan.pastDue!.amount);
    const retry = await POST(request('POST', {
      recordId: 'Q1_2026', paymentId: idA, quarter: 1, year: 2026, paidAmount: 2125, paidDate: '2026-04-14',
    }));
    expect(retry.status).toBe(200);
    expect((await retry.json()).paidDate).toBe('2026-04-14');
    expect(totalRecordedPayments(await getRecordedQuarterlyPayments('owner-a', 2026))).toBe(2125);
    expect((await getRecordedQuarterlyPayments('owner-a', 2026)).filter(payment => payment.paidAmount > 0)).toHaveLength(1);
  });

  it('counts a legacy payment once after it is edited twice, down to $2,000', async () => {
    state.docs.set(key, { quarter: 1, year: 2026, paidAmount: 2125, paidDate: '2026-04-01', estimatedAmount: 0 });
    expect((await POST(request('POST', {
      recordId: 'Q1_2026', paymentId: idA, quarter: 1, year: 2026, paidAmount: 2125, paidDate: '2026-04-10',
    }))).status).toBe(200);
    expect((await POST(request('POST', {
      recordId: 'Q1_2026', paymentId: idB, quarter: 1, year: 2026, paidAmount: 2000, paidDate: '2026-04-12',
    }))).status).toBe(200);
    const saved = await getRecordedQuarterlyPayments('owner-a', 2026);
    const countedPayments = saved.filter(payment => payment.paidAmount > 0);
    expect(countedPayments).toHaveLength(1);
    expect(totalRecordedPayments(saved)).toBe(2000);
    expect(state.docs.get(pathFor(idA))?.supersededBy).toBe(idB);
    expect(state.docs.get(key)?.paidAmount).toBe(2125);
    expect(state.docs.get(key)?.supersededBy).toBe(idB);
  });

  it('counts a legacy payment once after it is edited three times', async () => {
    state.docs.set(key, { quarter: 1, year: 2026, paidAmount: 2125, paidDate: '2026-04-01', estimatedAmount: 0 });
    const edits = [
      { paymentId: idA, paidAmount: 1800, paidDate: '2026-04-10' },
      { paymentId: idB, paidAmount: 900, paidDate: '2026-04-12' },
      { paymentId: '33333333-3333-4333-8333-333333333333', paidAmount: 400, paidDate: '2026-04-14' },
    ];
    for (const edit of edits) {
      const response = await POST(request('POST', { recordId: 'Q1_2026', quarter: 1, year: 2026, ...edit }));
      expect(response.status).toBe(200);
      const saved = await getRecordedQuarterlyPayments('owner-a', 2026);
      const active = saved.filter(payment => payment.paidAmount > 0);
      expect(active).toHaveLength(1);
      expect(totalRecordedPayments(saved)).toBe(edit.paidAmount);
      expect(active[0]?.record?.paidAmount).toBe(edit.paidAmount);
    }
    expect(state.docs.get(key)?.paidAmount).toBe(2125);
    expect(state.docs.get(key)?.supersededBy).toBe(edits[2].paymentId);
  });

  it('saves a same-id re-edit instead of keeping the first amount', async () => {
    state.docs.set(key, { quarter: 1, year: 2026, paidAmount: 2125, paidDate: '2026-04-01' });
    expect((await POST(request('POST', {
      recordId: 'Q1_2026', paymentId: idA, quarter: 1, year: 2026, paidAmount: 2125, paidDate: '2026-04-10',
    }))).status).toBe(200);
    const edited = await POST(request('POST', {
      recordId: 'Q1_2026', paymentId: idA, quarter: 1, year: 2026, paidAmount: 2000, paidDate: '2026-05-01',
    }));
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ paidAmount: 2000, paidDate: '2026-05-01' });
    const again = await POST(request('POST', {
      recordId: 'Q1_2026', paymentId: idA, quarter: 1, year: 2026, paidAmount: 2000, paidDate: '2026-05-01',
    }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ paidAmount: 2000, paidDate: '2026-05-01' });
    const saved = await getRecordedQuarterlyPayments('owner-a', 2026);
    expect(saved.filter(payment => payment.paidAmount > 0)).toHaveLength(1);
    expect(totalRecordedPayments(saved)).toBe(2000);
    expect(state.docs.get(pathFor(idA))?.supersededBy).toBeUndefined();
  });

  it('shows confirmation and notes from the current payment, not the superseded record', async () => {
    state.docs.set(key, {
      quarter: 1, year: 2026, paidAmount: 2125, paidDate: '2026-04-01', estimatedAmount: 500,
      confirmationNumber: 'OLD-CONF', paymentMethod: 'Check', notes: 'old note', supersededBy: idA,
    });
    state.docs.set(pathFor(idA), {
      quarter: 1, year: 2026, paidAmount: 2000, paidDate: '2026-04-12',
      confirmationNumber: 'NEW-CONF', paymentMethod: 'EFTPS', notes: 'new note',
    });
    const result = await (await GET(request('GET'))).json();
    expect(result.payments[0]).toMatchObject({
      paidAmount: 2000, paidDate: '2026-04-12', estimatedAmount: 500,
      confirmationNumber: 'NEW-CONF', paymentMethod: 'EFTPS', notes: 'new note',
      editRecordId: idA, editAmount: 2000, editPaidDate: '2026-04-12', editVersion: 0,
    });
  });

  it('add 2125 then 500 equals 2625 for a legacy record', async () => {
    state.docs.set(key, { quarter: 1, year: 2026, paidAmount: 2125, paidDate: '2026-04-01', estimatedAmount: 0 });
    const added = await POST(request('POST', {
      paymentId: idA, quarter: 1, year: 2026, paidAmount: 500, paidDate: '2026-04-15',
    }));
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({ paidAmount: 500, paidDate: '2026-04-15', quarter: 1 });
    expect(state.docs.get(key)).toMatchObject({ paidAmount: 2125, paidDate: '2026-04-01' });
    expect(state.docs.get(key)?.supersededBy).toBeUndefined();
    expect(state.docs.get(pathFor(idA))).toMatchObject({ paidAmount: 500, paidDate: '2026-04-15' });
    const saved = await getRecordedQuarterlyPayments('owner-a', 2026);
    expect(saved.filter(payment => payment.paidAmount > 0)).toHaveLength(2);
    expect(totalRecordedPayments(saved)).toBe(2625);
    const listed = await (await GET(request('GET'))).json();
    expect(listed.payments[0]).toMatchObject({ paidAmount: 2625, status: 'recorded', editRecordId: idA, editAmount: 500, editPaidDate: '2026-04-15' });
    expect(listed.summary.totalPaid).toBe(2625);
  });

  it('add 2125 then 500 equals 2625 for a planner card record', async () => {
    state.docs.set(pathFor(idA), { quarter: 1, year: 2026, paidAmount: 2125, paidDate: '2026-04-01', version: 1 });
    expect(state.docs.has(key)).toBe(false);
    const added = await POST(request('POST', {
      paymentId: idB, quarter: 1, year: 2026, paidAmount: 500, paidDate: '2026-04-15',
    }));
    expect(added.status).toBe(200);
    expect(state.docs.get(pathFor(idA))).toMatchObject({ paidAmount: 2125, paidDate: '2026-04-01' });
    expect(state.docs.get(pathFor(idA))?.supersededBy).toBeUndefined();
    expect(await counted()).toBe(2625);
    const listed = await (await GET(request('GET'))).json();
    expect(listed.payments[0]).toMatchObject({ paidAmount: 2625, status: 'recorded', editRecordId: idB, editAmount: 500, editPaidDate: '2026-04-15' });
    expect(listed.summary.totalPaid).toBe(2625);
  });

  it('overpayment March counts in Q1 on the Q1 due date', async () => {
    const filedOn = '2027-03-12';
    const due = '2027-04-15';
    expect(appliedOverpaymentCreditDate(2027)).toBe(due);
    const saved = await POST(request('POST', {
      paymentId: idA, quarter: 4, year: 2027, paidAmount: 640, paidDate: filedOn,
      paymentType: 'prior_year_overpayment', priorReturnFiled: true,
    }, '2027'));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ paidAmount: 640, paidDate: due, quarter: 1, year: 2027 });
    const counted = paymentsForInstallmentMatching([{
      amount: 640, paidDate: filedOn, recordedQuarter: 4, paymentType: 'prior_year_overpayment', priorReturnFiled: true,
    }], 2027);
    expect(counted).toHaveLength(1);
    expect(counted[0]?.paidDate).toBe(due);
    const matched = matchPaymentsToPeriods(counted, 2027);
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ matchedQuarter: 1, paidDate: due, effectiveDate: due, amount: 640 });
    expect(matched.filter(payment => payment.matchedQuarter === 1)).toHaveLength(1);
  });

  it('overpayment October counts in Q1 on the Q1 due date', async () => {
    const filedOn = '2028-10-15';
    const due = '2028-04-18';
    expect(appliedOverpaymentCreditDate(2028)).toBe(due);
    const saved = await POST(request('POST', {
      paymentId: idA, quarter: 4, year: 2028, paidAmount: 640, paidDate: filedOn,
      paymentType: 'prior_year_overpayment', priorReturnFiled: true,
    }, '2028'));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ paidAmount: 640, paidDate: due, quarter: 1, year: 2028 });
    const counted = paymentsForInstallmentMatching([{
      amount: 640, paidDate: filedOn, recordedQuarter: 4, paymentType: 'prior_year_overpayment', priorReturnFiled: true,
    }], 2028);
    expect(counted).toHaveLength(1);
    expect(counted[0]?.paidDate).toBe(due);
    const matched = matchPaymentsToPeriods(counted, 2028);
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ matchedQuarter: 1, paidDate: due, effectiveDate: due, amount: 640 });
    expect(matched.filter(payment => payment.matchedQuarter !== 1)).toHaveLength(0);
  });

  it('edits a planner card payment by its saved id', async () => {
    state.docs.set(pathFor(idA), {
      quarter: 1, year: 2026, paidAmount: 100, paidDate: '2026-04-02', version: 1,
      confirmationNumber: 'PLAN-1', notes: 'card',
    });
    const before = await (await GET(request('GET'))).json();
    expect(before.payments[0]).toMatchObject({
      paidAmount: 100, editRecordId: idA, editAmount: 100, editPaidDate: '2026-04-02', editVersion: 1,
      confirmationNumber: 'PLAN-1', notes: 'card',
    });
    const edited = await POST(request('POST', {
      recordId: idA, paymentId: idB, baseVersion: 1, quarter: 1, year: 2026, paidAmount: 80, paidDate: '2026-04-15',
    }));
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ paidAmount: 80, paidDate: '2026-04-15' });
    expect(state.docs.get(pathFor(idA))?.supersededBy).toBe(idB);
    expect(await counted()).toBe(80);
    const after = await (await GET(request('GET'))).json();
    expect(after.payments[0]).toMatchObject({
      paidAmount: 80, editRecordId: idB, editAmount: 80, editPaidDate: '2026-04-15', editVersion: 2,
    });
  });

  it('drops a field the rewritten payment no longer saves', async () => {
    state.docs.set(pathFor(idA), {
      quarter: 1, year: 2026, paidAmount: 100, paidDate: '2026-04-15', staleMarker: 'drop-me', version: 1,
    });
    const edited = await POST(request('POST', {
      paymentId: idA, quarter: 1, year: 2026, paidAmount: 150, paidDate: '2026-04-16',
    }));
    expect(edited.status).toBe(200);
    expect(state.docs.get(pathFor(idA))?.staleMarker).toBeUndefined();
    expect(state.docs.get(pathFor(idA))).toMatchObject({ paidAmount: 150, paidDate: '2026-04-16', version: 2 });
    expect(await counted()).toBe(150);
  });

  it('stale retry rejected', async () => {
    state.docs.set(key, { quarter: 1, year: 2026, paidAmount: 2125, paidDate: '2026-04-01', version: 0 });
    expect((await POST(request('POST', {
      recordId: 'Q1_2026', paymentId: idA, baseVersion: 0, quarter: 1, year: 2026, paidAmount: 900, paidDate: '2026-04-10',
    }))).status).toBe(200);
    expect(state.docs.get(pathFor(idA))).toMatchObject({ paidAmount: 900, version: 1 });
    expect((await POST(request('POST', {
      recordId: 'Q1_2026', paymentId: idB, baseVersion: 1, quarter: 1, year: 2026, paidAmount: 1800, paidDate: '2026-04-12',
    }))).status).toBe(200);
    expect(await counted()).toBe(1800);
    const stale = await POST(request('POST', {
      recordId: 'Q1_2026', paymentId: idA, baseVersion: 0, quarter: 1, year: 2026, paidAmount: 900, paidDate: '2026-04-10',
    }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'Another edit already saved this payment. Your change wasn\'t saved.' });
    const saved = await getRecordedQuarterlyPayments('owner-a', 2026);
    expect(saved.filter(payment => payment.paidAmount > 0)).toHaveLength(1);
    expect(totalRecordedPayments(saved)).toBe(1800);
    expect(state.docs.get(pathFor(idB))).toMatchObject({ paidAmount: 1800, version: 2 });
    expect(state.docs.get(pathFor(idB))?.supersededBy).toBeUndefined();
    expect(state.docs.get(pathFor(idA))?.paidAmount).toBe(900);
  });

  const lateLine = 'One or more recorded payments are dated after the final installment date and are applied as late payments.';
  async function quarterPaid(quarter: number, year = 2026) {
    const saved = await getRecordedQuarterlyPayments('owner-a', year);
    return totalRecordedPayments(saved.filter(payment => payment.quarter === quarter));
  }
  async function timing(year = 2026) {
    const saved = await getRecordedQuarterlyPayments('owner-a', year);
    return buildQuarterlyPlan({
      taxYear: year, filingStatus: 'single', currentYearTax: null, withholding: 0,
      priorYear: { available: true, totalTax: 8500, agi: 100000, coveredTwelveMonths: true },
      asOf: '2027-01-20',
      payments: saved.filter(payment => payment.paidAmount > 0).map(payment => ({
        amount: payment.paidAmount,
        paidDate: typeof payment.record?.paidDate === 'string' ? payment.record.paidDate : null,
        recordedQuarter: payment.quarter,
        designatedTaxYear: typeof payment.record?.designatedTaxYear === 'number' ? payment.record.designatedTaxYear : null,
      })),
    });
  }

  it('T1 legacy Jun 10 payment edited to Jul 1 moves from Q2 to Q3 and keeps the year total', async () => {
    const amount = 500;
    state.docs.set('user_profiles/owner-a/quarterly_payments/Q2_2026', {
      quarter: 2, year: 2026, paidAmount: amount, paidDate: '2026-06-10', estimatedAmount: 0,
    });
    expect(await quarterPaid(2)).toBe(amount);
    expect(await quarterPaid(3)).toBe(0);
    const yearBefore = await counted();
    expect((await POST(request('POST', {
      recordId: 'Q2_2026', paymentId: idA, quarter: 2, year: 2026, paidAmount: amount, paidDate: '2026-07-01',
    }))).status).toBe(200);
    const listed = await (await GET(request('GET'))).json();
    expect(listed.payments.find((row: { quarter: number }) => row.quarter === 2).paidAmount).toBe(0);
    expect(listed.payments.find((row: { quarter: number }) => row.quarter === 3).paidAmount).toBe(amount);
    expect(listed.summary.totalPaid).toBe(yearBefore);
    expect(await counted()).toBe(yearBefore);
    const movedCopies = (await getRecordedQuarterlyPayments('owner-a', 2026)).filter(payment => payment.paidAmount === amount);
    expect(movedCopies).toHaveLength(1);
    expect(movedCopies[0]).toMatchObject({ quarter: 3, paidAmount: amount });
    expect(movedCopies[0]?.record?.paidDate).toBe('2026-07-01');
  });

  it('T1 planner card Jun 10 payment edited to Jul 1 moves from Q2 to Q3 and keeps the year total', async () => {
    const amount = 500;
    expect((await POST(request('POST', {
      paymentId: idA, quarter: 2, year: 2026, paidAmount: amount, paidDate: '2026-06-10',
    }))).status).toBe(200);
    expect(await quarterPaid(2)).toBe(amount);
    expect(await quarterPaid(3)).toBe(0);
    const yearBefore = await counted();
    const edited = await POST(request('POST', {
      paymentId: idA, quarter: 2, year: 2026, paidAmount: amount, paidDate: '2026-07-01',
    }));
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ paidAmount: amount, paidDate: '2026-07-01', quarter: 3 });
    const listed = await (await GET(request('GET'))).json();
    expect(listed.payments.find((row: { quarter: number }) => row.quarter === 2).paidAmount).toBe(0);
    expect(listed.payments.find((row: { quarter: number }) => row.quarter === 3).paidAmount).toBe(amount);
    expect(listed.summary.totalPaid).toBe(yearBefore);
    expect(await counted()).toBe(yearBefore);
    const movedCopies = (await getRecordedQuarterlyPayments('owner-a', 2026)).filter(payment => payment.paidAmount === amount);
    expect(movedCopies).toHaveLength(1);
    expect(movedCopies[0]).toMatchObject({ id: idA, quarter: 3, paidAmount: amount });
    expect(state.docs.has('user_profiles/owner-a/quarterly_payments/Q2_2026')).toBe(false);
  });

  it('T2 legacy Jan 10 2027 payment stays in tax year 2026 Q4 when the date moves', async () => {
    state.docs.set('user_profiles/owner-a/quarterly_payments/Q4_2026', {
      quarter: 4, year: 2026, designatedTaxYear: 2026, paidAmount: 320, paidDate: '2027-01-10', estimatedAmount: 0,
    });
    expect((await POST(request('POST', {
      recordId: 'Q4_2026', paymentId: idA, quarter: 4, year: 2026, designatedTaxYear: 2026, paidAmount: 320, paidDate: '2026-12-28',
    }))).status).toBe(200);
    const onTime = await timing();
    const onTimeQ4 = onTime.installments.find(item => item.quarter === 4)?.paymentsMatched ?? [];
    expect(await quarterPaid(4)).toBe(320);
    expect(await counted()).toBe(320);
    expect(await counted(2027)).toBe(0);
    expect(onTimeQ4).toHaveLength(1);
    expect(onTimeQ4[0]?.afterFinalDueDate).toBe(false);
    expect(onTime.assumptions).not.toContain(lateLine);

    expect((await POST(request('POST', {
      recordId: 'Q4_2026', paymentId: idB, quarter: 4, year: 2026, designatedTaxYear: 2026, paidAmount: 320, paidDate: '2027-01-20',
    }))).status).toBe(200);
    const late = await timing();
    const lateQ4 = late.installments.find(item => item.quarter === 4)?.paymentsMatched ?? [];
    const year2027 = await getRecordedQuarterlyPayments('owner-a', 2027);
    expect(await quarterPaid(4)).toBe(320);
    expect(await counted()).toBe(320);
    expect(await counted(2027)).toBe(0);
    expect(year2027.filter(payment => payment.quarter === 1)).toHaveLength(0);
    expect(lateQ4).toHaveLength(1);
    expect(lateQ4[0]).toMatchObject({ paidDate: '2027-01-20', afterFinalDueDate: true, matchedQuarter: 4 });
    expect(late.assumptions).toContain(lateLine);
    const active = (await getRecordedQuarterlyPayments('owner-a', 2026)).filter(payment => payment.paidAmount === 320);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ quarter: 4, id: idB });
    expect(active[0]?.record).toMatchObject({ year: 2026, designatedTaxYear: 2026, paidDate: '2027-01-20' });
  });

  it('T2 planner card Jan 10 2027 payment stays in tax year 2026 Q4 when the date moves', async () => {
    expect((await POST(request('POST', {
      paymentId: idA, quarter: 4, year: 2026, designatedTaxYear: 2026, paidAmount: 320, paidDate: '2027-01-10',
    }))).status).toBe(200);
    expect(await quarterPaid(4)).toBe(320);
    expect(await counted(2027)).toBe(0);
    expect((await POST(request('POST', {
      paymentId: idA, quarter: 4, year: 2026, designatedTaxYear: 2026, paidAmount: 320, paidDate: '2026-12-28',
    }))).status).toBe(200);
    const onTime = await timing();
    const onTimeQ4 = onTime.installments.find(item => item.quarter === 4)?.paymentsMatched ?? [];
    expect(await quarterPaid(4)).toBe(320);
    expect(await counted()).toBe(320);
    expect(await counted(2027)).toBe(0);
    expect(onTimeQ4).toHaveLength(1);
    expect(onTimeQ4[0]?.afterFinalDueDate).toBe(false);
    expect(onTime.assumptions).not.toContain(lateLine);
    expect(state.docs.get(pathFor(idA))).toMatchObject({ year: 2026, designatedTaxYear: 2026, paidDate: '2026-12-28', quarter: 4 });

    expect((await POST(request('POST', {
      paymentId: idA, quarter: 4, year: 2026, designatedTaxYear: 2026, paidAmount: 320, paidDate: '2027-01-20',
    }))).status).toBe(200);
    const late = await timing();
    const lateQ4 = late.installments.find(item => item.quarter === 4)?.paymentsMatched ?? [];
    const year2027 = await getRecordedQuarterlyPayments('owner-a', 2027);
    expect(await quarterPaid(4)).toBe(320);
    expect(await counted()).toBe(320);
    expect(await counted(2027)).toBe(0);
    expect(year2027.filter(payment => payment.quarter === 1)).toHaveLength(0);
    expect(lateQ4).toHaveLength(1);
    expect(lateQ4[0]).toMatchObject({ paidDate: '2027-01-20', afterFinalDueDate: true, matchedQuarter: 4 });
    expect(late.assumptions).toContain(lateLine);
    const active = (await getRecordedQuarterlyPayments('owner-a', 2026)).filter(payment => payment.paidAmount === 320);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ quarter: 4, id: idA });
    expect(active[0]?.record).toMatchObject({ year: 2026, designatedTaxYear: 2026, paidDate: '2027-01-20' });
  });

  it('T3 legacy amount edit replaces $900 with $1,800 and counts it once', async () => {
    state.docs.set(key, { quarter: 1, year: 2026, paidAmount: 900, paidDate: '2026-04-10' });
    const edited = await POST(request('POST', {
      recordId: 'Q1_2026', paymentId: idA, quarter: 1, year: 2026, paidAmount: 1800, paidDate: '2026-04-10',
    }));
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ paidAmount: 1800, paidDate: '2026-04-10' });
    expect(await counted()).toBe(1800);
    expect((await getRecordedQuarterlyPayments('owner-a', 2026)).filter(payment => payment.paidAmount > 0)).toHaveLength(1);
    expect(state.docs.get(key)?.paidAmount).toBe(900);
    expect(state.docs.get(key)?.supersededBy).toBe(idA);
  });

  it('T3 planner card amount edit replaces $900 with $1,800 and counts it once', async () => {
    expect((await POST(request('POST', {
      paymentId: idA, quarter: 1, year: 2026, paidAmount: 900, paidDate: '2026-04-10',
    }))).status).toBe(200);
    const edited = await POST(request('POST', {
      paymentId: idA, quarter: 1, year: 2026, paidAmount: 1800, paidDate: '2026-04-10',
    }));
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ paidAmount: 1800, paidDate: '2026-04-10' });
    expect(await counted()).toBe(1800);
    expect((await getRecordedQuarterlyPayments('owner-a', 2026)).filter(payment => payment.paidAmount > 0)).toHaveLength(1);
    expect(state.docs.get(pathFor(idA))?.supersededBy).toBeUndefined();
  });
});

describe('standard individual estimated-tax deadlines', () => {
  // IRS Form1040-ES: weekend/DC holiday rule; special disaster postponements are outside this helper.
  it.each([[2024, 1, '2024-04-15'], [2025, 2, '2025-06-16'], [2026, 2, '2026-06-15'], [2026, 4, '2027-01-15'], [2023, 4, '2024-01-16'], [2022, 1, '2022-04-18']])('rolls %i Q%i to %s', (year, quarter, expected) => {
    expect(getEstimatedTaxDeadline(Number(year), Number(quarter)).toISOString().slice(0, 10)).toBe(expected);
  });
});
