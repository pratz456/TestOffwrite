import { readTaxExportTransactions } from './tax-export-transactions';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { getAssetsSettings } from '@/lib/firebase/settings-server';
import { adminDb } from '@/lib/firebase/admin';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { reconcileBusinessIncome } from '@/lib/tax-rules/business-income';
import { normalizeFilingStatus } from '@/lib/tax-rules/filing-status';
import { summarizeW2Income } from '@/lib/tax-rules/w2-income';
import { getFederalTaxRules } from '@/lib/tax-rules/federal-year-rules';
import { calcScheduleSE } from './calcSE';
import { calc4562 } from './calc4562';
import { readIncomeReconciliationDecisions } from '@/lib/firebase/income-reconciliations-server';
export class TaxExportDataUnavailableError extends Error {
  readonly code = 'TAX_EXPORT_DATA_UNAVAILABLE';
  constructor() { super('Could not load all records needed for this calculation. Please retry.'); }
}

/** Selected-year inputs shared by the SE preview and PDF. Never read tax_summary cache. */
export async function loadScheduleSEData(uid: string, taxYear: number) {
  getFederalTaxRules(taxYear);
  const query = (name: string) => adminDb.collection(name).where('userId', '==', uid).where('taxYear', '==', taxYear);
  const [tx, profile, gross, forms, wages, deductions, assets, decisions] = await Promise.all([
    readTaxExportTransactions(uid, taxYear), getUserProfileServer(uid), query('gross_receipts').get(), query('income_1099').get(),
    query('w2_income').get(), query('tax_deductions').limit(1).get(), getAssetsSettings(uid), readIncomeReconciliationDecisions(uid, taxYear),
  ]);
  if (profile.error || assets.error || !profile.data) throw new TaxExportDataUnavailableError();
  const transactions = tx;
  const filingStatus = normalizeFilingStatus(profile.data.filing_status);
  const receipts = reconcileBusinessIncome(taxYear, transactions.map(row => ({ ...row })), gross.docs.map(doc => ({ ...doc.data(), id: doc.id })), forms.docs.map(doc => ({ ...doc.data(), id: doc.id })), decisions);
  const expense = aggregateScheduleC(transactions, String(taxYear), CATEGORY_MAP, { mode: 'confirmed-only' });
  const w2 = summarizeW2Income(wages.docs.map(doc => doc.data()));
  const netProfitBeforeDepreciation = receipts.grossReceipts - expense.totalDeductible;
  const depreciationDeduction = assets.data?.length ? calc4562(assets.data, netProfitBeforeDepreciation, taxYear).totalDepreciation : 0;
  const netProfit = netProfitBeforeDepreciation - depreciationDeduction;
  const calculation = calcScheduleSE({ scheduleCNetProfit: netProfit, taxYear }, filingStatus, w2.socialSecurityWages, w2.medicareWagesForSE);
  const ded = deductions.empty ? {} : deductions.docs[0].data();
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
    userProfile: { ...profile.data, filing_status: filingStatus }, taxYear, filingStatus,
    calculation, w2SocialSecurityWages: w2.socialSecurityWages, w2MedicareWages: w2.medicareWagesForSE,
    grossReceipts: receipts.grossReceipts, totalExpenses: expense.totalDeductible,
    netProfitBeforeDepreciation, depreciationDeduction, netProfit,
    w2Wages: w2.wages, w2Withheld: w2.federalWithheld, w2Count: wages.docs.length,
    healthInsurancePremiums, totalRetirement, hsaContribution, priorYearTotalTax: amount(ded.priorYearTotalTax), studentLoanInterest,
    aboveTheLineDeductions, totalIncome: netProfit + w2.wages, estimatedAGI: netProfit + w2.wages - aboveTheLineDeductions,
    dataSource: 'auto', calculationScope: 'Nonfarm SE planning for one taxpayer. Partial income picture, not an annual return or final AGI. Confirm wage ownership; spouses require separate Schedule SE calculations.',
  };
}
