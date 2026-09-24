import { summarizeConfirmedDeductions } from './display-deductions';
import { exportDate, ExportReviewRequiredError } from '@/lib/reports/transaction-export';
import { getFederalTaxRules, SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';

const recordDate = (record: object) => {
  const value = record as Record<string, unknown>;
  return exportDate(value.date ?? value.datetime);
};

/** A labeled income-tax planning estimate, never a refund or complete return calculation. */
export function buildMonthlySavings(records: readonly object[], taxYear: number, rate: number, now = new Date()) {
  getFederalTaxRules(taxYear);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new RangeError('A valid reviewed income-tax rate is required.');
  const today = now.toISOString().slice(0, 10);
  const isCurrentYear = taxYear === now.getUTCFullYear();
  // Future-dated entries cannot inflate year-to-date savings. Invalid dates still reach review.
  const rows = records.filter(record => {
    const date = recordDate(record);
    return !date || !isCurrentYear || date <= today;
  });
  const summary = summarizeConfirmedDeductions(rows, taxYear);
  if (summary.reviewMessage) throw new ExportReviewRequiredError(summary.reviewMessage);
  const monthlyData = Array.from({ length: 12 }, (_, month) => ({
    month, monthName: new Date(Date.UTC(taxYear, month, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
    total: 0, deductionBasis: 0, count: 0,
  }));
  for (const [record, contribution] of summary.contributions) {
    const date = recordDate(record)!;
    const bucket = monthlyData[Number(date.slice(5, 7)) - 1];
    bucket.deductionBasis = Math.round((bucket.deductionBasis + contribution) * 100) / 100;
    bucket.count += 1;
  }
  monthlyData.forEach(bucket => { bucket.total = bucket.deductionBasis * rate; });
  const currentMonth = isCurrentYear ? now.getUTCMonth() : 11;
  const currentMonthTotal = monthlyData[currentMonth].total;
  const lastMonthTotal = currentMonth > 0 ? monthlyData[currentMonth - 1].total : 0;
  const monthsWithData = monthlyData.slice(0, currentMonth + 1).filter(bucket => bucket.count > 0);
  const yearToDateTotal = monthlyData.reduce((sum, bucket) => sum + bucket.total, 0);
  const availableYears = [...new Set(records.map(record => recordDate(record)?.slice(0, 4)).filter(Boolean).map(Number))]
    .filter(year => year <= now.getUTCFullYear() && (SUPPORTED_TAX_YEARS as readonly number[]).includes(year)).sort((a, b) => b - a);
  return {
    taxYear,
    estimateKind: 'federal_income_tax_planning' as const,
    estimateNotice: 'Planning approximation: confirmed transaction deductions multiplied by the saved profile’s average federal income-tax rate, not a before-and-after tax calculation. Before vehicle, asset and home-office adjustments; excludes self-employment tax, credits and state tax. Not a refund or return calculation.',
    monthlyData,
    summary: {
      currentMonthTotal,
      monthOverMonthChange: lastMonthTotal > 0 ? ((currentMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 : 0,
      avgMonthly: monthsWithData.length ? monthsWithData.reduce((sum, bucket) => sum + bucket.total, 0) / monthsWithData.length : 0,
      monthsWithData: monthsWithData.length,
      yearToDateTotal, estimatedTaxSavingsFromMarkedDeductions: yearToDateTotal,
      deductionBasis: summary.totalDeductible!,
    },
    availableYears: availableYears.length ? availableYears : [taxYear],
    diagnostics: { expensesInYear: rows.filter(record => recordDate(record)?.startsWith(`${taxYear}-`) && Number((record as Record<string, unknown>).amount) > 0).length,
      deductibleInYear: summary.transactions.length,
      unclassifiedInYear: rows.filter(record => recordDate(record)?.startsWith(`${taxYear}-`) && (record as Record<string, unknown>).is_deductible == null).length },
  };
}
