import { readTaxExportTransactions } from './tax-export-transactions';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { getScheduleCSettings } from '@/lib/firebase/settings-server';
import { adminDb } from '@/lib/firebase/admin';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { reconcileBusinessIncome } from '@/lib/tax-rules/business-income';
import { normalizeFilingStatus } from '@/lib/tax-rules/filing-status';
import { summarizeW2Income } from '@/lib/tax-rules/w2-income';
import { getFederalTaxRules } from '@/lib/tax-rules/federal-year-rules';
import { computeScheduleCProfit } from '@/lib/tax-rules/schedule-c-profit';
import { calcScheduleSE } from './calcSE';
export class TaxExportDataUnavailableError extends Error {
  readonly code = 'TAX_EXPORT_DATA_UNAVAILABLE';
  constructor() { super('Could not load all records needed for this calculation. Please retry.'); }
}

/**
 * Selected-year Schedule C records and settings shared by the SE loader and the Form 4562 /
 * Form 8829 exports. Home office and asset elections come from settings, never the profile cache.
 */
export async function loadScheduleCRecords(uid: string, taxYear: number) {
  getFederalTaxRules(taxYear);
  const query = (name: string) => adminDb.collection(name).where('userId', '==', uid).where('taxYear', '==', taxYear);
  const [tx, profile, gross, forms, wages, deductions, settings] = await Promise.all([
    readTaxExportTransactions(uid, taxYear), getUserProfileServer(uid), query('gross_receipts').get(), query('income_1099').get(),
    query('w2_income').get(), query('tax_deductions').limit(1).get(), getScheduleCSettings(uid),
  ]);
  if (profile.error || !profile.data || settings.error || !settings.data) throw new TaxExportDataUnavailableError();
  const transactions = tx;
  const receipts = reconcileBusinessIncome(taxYear, transactions.map(row => ({ ...row })), gross.docs.map(doc => ({ ...doc.data(), id: doc.id })), forms.docs.map(doc => ({ ...doc.data(), id: doc.id })));
  const expense = aggregateScheduleC(transactions, String(taxYear), CATEGORY_MAP, { mode: 'confirmed-only' });
  const w2 = summarizeW2Income(wages.docs.map(doc => doc.data()));
  return {
    taxYear, profile: profile.data, transactions, receipts, expense, w2, w2Count: wages.docs.length,
    deductions: deductions.empty ? {} : deductions.docs[0].data(),
    assets: settings.data.assets, homeOffice: settings.data.homeOffice, depreciationElections: settings.data.depreciationElections,
    /** §179(b)(3) business income: Schedule C profit before assets plus employee wages (Pub 946 ch. 2). */
    section179BusinessIncome: receipts.grossReceipts - expense.totalDeductible + w2.wages,
  };
}

export type ScheduleCRecords = Awaited<ReturnType<typeof loadScheduleCRecords>>;

/** The shared line 13 → 29 → 30 → 31 ordering applied to loaded records; throws the review errors. */
export function scheduleCProfitFromRecords(records: ScheduleCRecords) {
  return computeScheduleCProfit({
    taxYear: records.taxYear, grossReceipts: records.receipts.grossReceipts, confirmedExpenses: records.expense.totalDeductible, w2Wages: records.w2.wages,
    assets: records.assets, depreciationElections: records.depreciationElections, homeOffice: records.homeOffice, legacyHomeOfficeMethod: records.profile.home_office_method,
  });
}

/** Selected-year inputs shared by the SE preview and PDF. Never read tax_summary cache. */
export async function loadScheduleSEData(uid: string, taxYear: number) {
  const records = await loadScheduleCRecords(uid, taxYear);
  const { profile, receipts, expense, w2 } = records;
  const filingStatus = normalizeFilingStatus(profile.filing_status);
  const scheduleC = scheduleCProfitFromRecords(records);
  const netProfitBeforeDepreciation = scheduleC.profitBeforeAssets;
  const { depreciationDeduction, deMinimisExpense, homeOfficeDeduction, netProfit } = scheduleC;
  const calculation = calcScheduleSE({ scheduleCNetProfit: netProfit, taxYear }, filingStatus, w2.socialSecurityWages, w2.medicareWagesForSE);
  const ded = records.deductions;
  const amount = (value: unknown) => {
    if (value === undefined || value === null || value === '') return 0;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TaxExportDataUnavailableError();
    return value;
  };
  const healthInsurancePremiums = amount(ded.healthInsurancePremiums);
  const totalRetirement = amount(ded.sepIraContribution) + amount(ded.solo401kEmployeeContribution) + amount(ded.solo401kEmployerContribution);
  const hsaContribution = amount(ded.hsaContribution), studentLoanInterest = amount(ded.studentLoanInterest);
  const aboveTheLineDeductions = calculation.halfSEDeduction + healthInsurancePremiums + totalRetirement + hsaContribution + studentLoanInterest;
  return {
    userProfile: { ...profile, filing_status: filingStatus }, taxYear, filingStatus,
    calculation, w2SocialSecurityWages: w2.socialSecurityWages, w2MedicareWages: w2.medicareWagesForSE,
    grossReceipts: receipts.grossReceipts, totalExpenses: expense.totalDeductible,
    netProfitBeforeDepreciation, deMinimisExpense, depreciationDeduction, tentativeProfit: scheduleC.tentativeProfit, homeOfficeDeduction, netProfit,
    homeOffice: scheduleC.homeOffice.calculation, scheduleCWarnings: scheduleC.warnings,
    w2Wages: w2.wages, w2Withheld: w2.federalWithheld, w2Count: records.w2Count,
    healthInsurancePremiums, totalRetirement, hsaContribution, priorYearTotalTax: amount(ded.priorYearTotalTax), studentLoanInterest,
    aboveTheLineDeductions, totalIncome: netProfit + w2.wages, estimatedAGI: netProfit + w2.wages - aboveTheLineDeductions,
    dataSource: 'auto', calculationScope: 'Nonfarm SE planning for one taxpayer. Partial income picture, not an annual return or final AGI. Confirm wage ownership; spouses require separate Schedule SE calculations.',
  };
}
