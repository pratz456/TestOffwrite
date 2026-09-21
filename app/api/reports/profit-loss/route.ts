import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { readOwnedTransactions } from '@/lib/reports/export-records';
import { exportDate, exportYear, selectExportYear, transactionAmount, ExportReviewRequiredError, type ExportRecord } from '@/lib/reports/transaction-export';
import { isSupersededRecord } from '@/lib/transactions/record-scope';
import { createPlanningPDF, formatExportMoney } from '@/lib/reports/planning-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const scope = 'Recorded USD cash movements, including personal, transfer and unreviewed records. Pending transactions are excluded. This is not business profit, taxable income, a tax estimate or a filed return.';

function period(yearValue: unknown, monthValue: unknown) {
  const year = exportYear(yearValue) ?? new Date().getFullYear();
  let month: number | undefined;
  if (monthValue !== undefined && monthValue !== null) {
    if (!/^\d{1,2}$/.test(String(monthValue)) || Number(monthValue) < 1 || Number(monthValue) > 12) throw new RangeError('Choose a month from 1 through 12.');
    month = Number(monthValue);
  }
  return { year, month };
}
function recordsInPeriod(records: ExportRecord[], year: number, month?: number) {
  return selectExportYear(records, year).filter(record => month === undefined || Number(exportDate(record.date ?? record.datetime)!.slice(5, 7)) === month);
}
function summarize(records: ExportRecord[]) {
  const income = new Map<string, number>(), outflows = new Map<string, number>();
  const posted = records.filter(record => record.pending !== true);
  const seen = new Set<string>();
  let totalIncome = 0, totalExpenses = 0;
  for (const record of posted) {
    const identity = record.trans_id ?? record.transaction_id ?? record.id;
    if (typeof identity === 'string' && identity) {
      const key = JSON.stringify([record.account_id ?? record.accountId ?? '', identity]);
      if (seen.has(key)) throw new ExportReviewRequiredError('Duplicate transaction references need reconciliation before creating a cash-flow summary. Review duplicate imports in your transaction records.');
      seen.add(key);
    }
    const amount = transactionAmount(record);
    if (amount === null || !Number.isSafeInteger(Math.round(amount * 100))) throw new ExportReviewRequiredError('A saved transaction has an invalid amount. Correct it before creating a cash-flow summary.');
    if (record.iso_currency_code !== 'USD' || record.unofficial_currency_code) throw new ExportReviewRequiredError('Every included transaction needs a recorded USD currency. Review missing currencies or convert non-USD amounts before creating a combined cash-flow summary.');
    if (amount < 0) {
      const source = String(record.merchant_name ?? record.merchant ?? record.name ?? 'Unspecified source');
      income.set(source, (income.get(source) ?? 0) - amount); totalIncome -= amount;
    } else if (amount > 0) {
      const category = Array.isArray(record.category) ? record.category.join(' > ') : typeof record.category === 'string' && record.category ? record.category : 'Uncategorized';
      outflows.set(category, (outflows.get(category) ?? 0) + amount); totalExpenses += amount;
    }
  }
  if (![totalIncome, totalExpenses, totalIncome - totalExpenses].every(value => Number.isSafeInteger(Math.round(value * 100)))) throw new ExportReviewRequiredError('Saved amounts exceed the supported summary range. Review the transaction amounts.');
  const money = (value: number) => Math.round(value * 100) / 100;
  // Legacy field names remain for the existing screen; reportType and labels define their cash-flow meaning.
  return { reportType: 'recorded_cash_flow' as const, currency: 'USD', scope,
    income: [...income].map(([source, amount]) => ({ source, amount: money(amount) })),
    operatingExpenses: [...outflows].map(([category, amount]) => ({ category, label: category, amount: money(amount) })),
    totalIncome: money(totalIncome), totalExpenses: money(totalExpenses), netProfit: money(totalIncome - totalExpenses),
    costOfGoodsSold: null, grossProfit: null, effectiveTaxRate: null, selfEmploymentTax: null, incomeTax: null,
    transactionCount: posted.length, excludedPendingCount: records.length - posted.length };
}
async function dataFor(uid: string, year: number, month?: number) {
  // The reader already drops superseded duplicates; filtering again keeps the summary safe if a caller passes raw records.
  const records = (await readOwnedTransactions(uid)).filter(record => !isSupersededRecord(record));
  const current = summarize(recordsInPeriod(records, year, month));
  const priorYear = month && month > 1 ? year : year - 1;
  const priorMonth = month === undefined ? undefined : month === 1 ? 12 : month - 1;
  let priorPeriod: { totalIncome: number; totalExpenses: number; netProfit: number } | null = null;
  let priorPeriodReviewRequired = false;
  try {
    const previous = recordsInPeriod(records, priorYear, priorMonth);
    if (previous.some(record => record.pending !== true)) {
      const summary = summarize(previous);
      priorPeriod = { totalIncome: summary.totalIncome, totalExpenses: summary.totalExpenses, netProfit: summary.netProfit };
    }
  } catch (error) {
    if (!(error instanceof ExportReviewRequiredError)) throw error;
    priorPeriodReviewRequired = true;
  }
  return { ...current, year, month: month ?? null, periodLabel: month === undefined ? String(year) : `${year}-${String(month).padStart(2, '0')}`, priorPeriod, priorPeriodReviewRequired };
}
function failure(error: unknown) {
  if (error instanceof RangeError) return json({ error: error.message }, 400);
  if (error instanceof ExportReviewRequiredError) return json({ error: error.message, code: error.code }, 422);
  return json({ error: 'Could not load complete cash-flow records. Please retry.', code: 'EXPORT_DATA_UNAVAILABLE' }, 503);
}
export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return json({ error: 'Unauthorized' }, 401);
  const denied = await requireFeatureAccess(user.uid, 'reports'); if (denied) return denied;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Provide a valid report period.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Provide a valid report period.' }, 400);
  try { const { year, month } = period(body.year, body.month); return json(await dataFor(user.uid, year, month)); }
  catch (error) { return failure(error); }
}
export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return json({ error: 'Unauthorized' }, 401);
  if (request.nextUrl.searchParams.get('format') !== 'pdf') return json({ error: 'Use POST for JSON data. GET supports format=pdf only.' }, 400);
  const denied = await requireFeatureAccess(user.uid, 'exports'); if (denied) return denied;
  try {
    const { year, month } = period(request.nextUrl.searchParams.get('year'), request.nextUrl.searchParams.get('month'));
    const data = await dataFor(user.uid, year, month);
    const pdf = await createPlanningPDF('Recorded cash-flow summary', year);
    pdf.paragraph(`Period: ${data.periodLabel}. Currency: USD.`, true);
    pdf.paragraph(scope);
    pdf.paragraph(`Included records: ${data.transactionCount}. Pending records excluded: ${data.excludedPendingCount}.`);
    pdf.table(['Recorded movement', 'Amount (USD)'], [['Inflows', formatExportMoney(data.totalIncome)], ['Outflows', formatExportMoney(data.totalExpenses)], ['Net cash movement', formatExportMoney(data.netProfit)]], [358, 170]);
    pdf.section('Inflows by recorded source');
    pdf.table(['Source', 'Amount (USD)'], data.income.map(row => [row.source, formatExportMoney(row.amount)]), [358, 170]);
    pdf.section('Outflows by recorded category');
    pdf.table(['Category (not tax treatment)', 'Amount (USD)'], data.operatingExpenses.map(row => [row.label, formatExportMoney(row.amount)]), [358, 170]);
    if (data.priorPeriodReviewRequired) pdf.paragraph('Prior-period comparison withheld: earlier records require currency or amount review.');
    else if (data.priorPeriod) {
      pdf.section('Prior recorded period');
      pdf.table(['Movement', 'Amount (USD)'], [['Inflows', formatExportMoney(data.priorPeriod.totalIncome)], ['Outflows', formatExportMoney(data.priorPeriod.totalExpenses)], ['Net cash movement', formatExportMoney(data.priorPeriod.netProfit)]], [358, 170]);
    }
    return new NextResponse(Buffer.from(await pdf.save()), { headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="recorded-cash-flow-${data.periodLabel}.pdf"` } });
  } catch (error) { return failure(error); }
}
