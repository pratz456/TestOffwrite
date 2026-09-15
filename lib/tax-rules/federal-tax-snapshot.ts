import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { calc4562, type Asset } from '@/lib/reports/calc4562';
import { calcScheduleSE } from '@/lib/reports/calcSE';
import { compute1040 } from './compute-1040';
import { reconcileBusinessIncome, type IncomeRecord } from './business-income';
import { summarizeW2Income } from './w2-income';
import { normalizeFilingStatus } from './filing-status';

interface FederalTaxSnapshotInput {
  taxYear: number;
  transactions: ReadonlyArray<IncomeRecord>;
  grossReceipts: ReadonlyArray<IncomeRecord>;
  forms1099: ReadonlyArray<IncomeRecord>;
  w2Entries: ReadonlyArray<IncomeRecord>;
  profile: IncomeRecord;
  organizer: IncomeRecord;
  deductions: IncomeRecord;
  assets: Asset[];
  estimatedPayments: number;
}

/** One federal input snapshot for the preview and PDF; not a complete return engine. */
export function buildFederalTaxSnapshot(input: FederalTaxSnapshotInput) {
  const { taxYear, transactions, profile, organizer: org, deductions: ded } = input;
  const amount = (value: unknown): number => {
    if (value === undefined || value === null || value === '') return 0;
    const parsed = typeof value === 'string' ? Number(value) : value;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) throw new RangeError('Invalid tax amount');
    return parsed;
  };
  const filingStatus = normalizeFilingStatus(profile.filing_status);
  const reconciliation = reconcileBusinessIncome(taxYear, transactions, input.grossReceipts, input.forms1099);
  const w2 = summarizeW2Income(input.w2Entries);
  const w2FederalWithheld = input.w2Entries.length ? w2.federalWithheld : amount(profile.w2_federal_withheld);
  const { totalDeductible } = aggregateScheduleC([...transactions] as Parameters<typeof aggregateScheduleC>[0], String(taxYear), CATEGORY_MAP, { mode: 'confirmed-only' });
  const scheduleCNetProfit = reconciliation.grossReceipts - totalDeductible;
  const depreciationDeduction = input.assets.length ? calc4562(input.assets, scheduleCNetProfit, taxYear).totalDepreciation : 0;
  const seCalc = calcScheduleSE({ scheduleCNetProfit: scheduleCNetProfit - depreciationDeduction, taxYear }, filingStatus, w2.socialSecurityWages, w2.medicareWagesForSE);

  const interest = amount(org.amount1099INT);
  const dividends = amount(org.amount1099DIV);
  const capGains = amount(org.amountCapGains);
  const socialSecurity = amount(org.amountSocialSecurity) * .85;
  const iraDist = amount(org.amountIRADistributions);
  const rental = amount(org.amountRentalIncome);
  const otherOrdinaryIncome = amount(org.amountOtherIncome);
  const otherIncome = interest + dividends + capGains + socialSecurity + iraDist + rental + otherOrdinaryIncome;
  const numDependents = amount(org.dependents);
  const taxPayerAge = org.dateOfBirth ? taxYear - new Date(String(org.dateOfBirth)).getUTCFullYear() : undefined;
  const healthInsurancePremiums = amount(ded.healthInsurancePremiums ?? profile.health_insurance_premiums);
  const sepIraContribution = amount(ded.sepIraContribution ?? profile.sep_ira_contribution);
  const solo401kContribution = ded.solo401kEmployeeContribution !== undefined || ded.solo401kEmployerContribution !== undefined
    ? amount(ded.solo401kEmployeeContribution) + amount(ded.solo401kEmployerContribution)
    : amount(profile.solo_401k_contribution);
  const simpleIraContribution = amount(ded.simpleIraContribution);
  const hsaContribution = amount(ded.hsaContribution ?? profile.hsa_contribution);
  const studentLoanInterest = amount(ded.studentLoanInterest);
  const priorYearTotalTax = amount(ded.priorYearTotalTax ?? profile.prior_year_tax);
  const result = compute1040({
    taxYear, filingStatus, scheduleCNetProfit, w2Wages: w2.wages, w2MedicareWages: w2.medicareWages,
    w2FederalWithheld, estimatedPayments: input.estimatedPayments,
    selfEmploymentTax: seCalc.totalSETax, halfSEDeduction: seCalc.halfSEDeduction,
    otherIncome, numDependents, numEITCChildren: numDependents, taxPayerAge,
    investmentIncome: interest + dividends + Math.max(0, capGains), longTermCapGains: Math.max(0, capGains), shortTermCapGains: 0,
    healthInsurancePremiums, sepIraContribution, solo401kContribution, simpleIraContribution, hsaContribution, studentLoanInterest,
    charitableDonations: amount(ded.charitableCashDonations) + amount(ded.charitableNonCashDonations), depreciationDeduction,
  }, priorYearTotalTax > 0 ? priorYearTotalTax : undefined);
  result.calculationWarnings.push(...reconciliation.warnings);
  if (socialSecurity || dividends || capGains || iraDist || rental || numDependents) {
    result.calculationWarnings.push('Organizer income and dependent amounts require tax review: benefit taxability, dividend/gain character, retirement basis, rental treatment and credit eligibility are not fully modeled.');
  }
  return {
    filingStatus, result, seCalc, depreciationDeduction, reconciliation,
    income: { grossReceipts: reconciliation.grossReceipts, w2Wages: w2.wages, scheduleCNetProfit, totalDeductible, otherIncome, otherOrdinaryIncome, interest, dividends, capGains, socialSecurity, iraDist, rental },
    w2: { wages: w2.wages, withheld: w2FederalWithheld, count: input.w2Entries.length, stateWithheld: w2.stateWithheld },
    deductions: { healthInsurancePremiums, sepIraContribution, solo401kContribution, hsaContribution, studentLoanInterest },
    payments: { estimatedPayments: input.estimatedPayments, w2FederalWithheld },
  };
}
