import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { calc4562, type Asset } from '@/lib/reports/calc4562';
import { calcScheduleSE } from '@/lib/reports/calcSE';
import { compute1040 } from './compute-1040';
import { reconcileBusinessIncome, type IncomeRecord } from './business-income';
import { summarizeW2Income } from './w2-income';
import { normalizeFilingStatus } from './filing-status';
import { assertGenericDependentCreditScope } from './credit-scope';
import { readSocialSecurityFacts, calculateSocialSecurityWorksheet, assertSocialSecurityAdjustmentRecords, SocialSecurityReviewRequiredError } from './social-security';

interface FederalTaxSnapshotInput {
  taxYear: number;
  transactions: ReadonlyArray<IncomeRecord>;
  grossReceipts: ReadonlyArray<IncomeRecord>;
  forms1099: ReadonlyArray<IncomeRecord>;
  /** Owner-recorded income reconciliation decisions for the same tax year. */
  reconciliationDecisions?: ReadonlyArray<IncomeRecord>;
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
  assertGenericDependentCreditScope(org.dependents);
  const benefitFacts = readSocialSecurityFacts(org);
  const amount = (value: unknown): number => {
    if (value === undefined || value === null || value === '') return 0;
    const parsed = typeof value === 'string' ? Number(value) : value;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) throw new RangeError('Invalid tax amount');
    return parsed;
  };
  const filingStatus = normalizeFilingStatus(profile.filing_status);
  const reconciliation = reconcileBusinessIncome(taxYear, transactions, input.grossReceipts, input.forms1099, input.reconciliationDecisions ?? []);
  const w2 = summarizeW2Income(input.w2Entries);
  const w2FederalWithheld = input.w2Entries.length ? w2.federalWithheld : amount(profile.w2_federal_withheld);
  const { totalDeductible } = aggregateScheduleC([...transactions] as Parameters<typeof aggregateScheduleC>[0], String(taxYear), CATEGORY_MAP, { mode: 'confirmed-only' });
  const scheduleCNetProfit = reconciliation.grossReceipts - totalDeductible;
  const depreciationDeduction = input.assets.length ? calc4562(input.assets, scheduleCNetProfit, taxYear).totalDepreciation : 0;
  const seCalc = calcScheduleSE({ scheduleCNetProfit: scheduleCNetProfit - depreciationDeduction, taxYear }, filingStatus, w2.socialSecurityWages, w2.medicareWagesForSE);

  const interest = amount(org.amount1099INT);
  const dividends = amount(org.amount1099DIV);
  const capGains = amount(org.amountCapGains);
  const iraDist = amount(org.amountIRADistributions);
  const rental = amount(org.amountRentalIncome);
  const otherOrdinaryIncome = amount(org.amountOtherIncome);
  const nonBenefitOtherIncome = interest + dividends + capGains + iraDist + rental + otherOrdinaryIncome;
  const healthInsurancePremiums = amount(ded.healthInsurancePremiums ?? profile.health_insurance_premiums);
  const sepIraContribution = amount(ded.sepIraContribution ?? profile.sep_ira_contribution);
  const solo401kContribution = ded.solo401kEmployeeContribution !== undefined || ded.solo401kEmployerContribution !== undefined
    ? amount(ded.solo401kEmployeeContribution) + amount(ded.solo401kEmployerContribution)
    : amount(profile.solo_401k_contribution);
  const simpleIraContribution = amount(ded.simpleIraContribution);
  const hsaContribution = amount(ded.hsaContribution ?? profile.hsa_contribution);
  const studentLoanInterest = amount(ded.studentLoanInterest);
  let socialSecurityWorksheet: ReturnType<typeof calculateSocialSecurityWorksheet> | null = null;
  if (benefitFacts) {
    if (iraDist !== 0 && org.socialSecurityRetirementReviewed !== 'yes') {
      throw new SocialSecurityReviewRequiredError('Confirm the retirement amount is the reviewed taxable Box2a amount, with no unresolved basis, rollover or additional early-distribution tax. Otherwise complete the retirement review before this estimate.');
    }
    if (capGains !== 0 || rental !== 0) {
      throw new SocialSecurityReviewRequiredError('Capital gain/loss character and allowed rental income/loss must be reviewed before including them in this supported Social Security estimate. These return calculations are not yet fully modeled.');
    }
    assertSocialSecurityAdjustmentRecords(org, { healthInsurancePremiums, sepIraContribution, solo401kContribution, simpleIraContribution, hsaContribution, studentLoanInterest });
    if (!profile.filing_status || !org.filingStatus || normalizeFilingStatus(org.filingStatus) !== filingStatus) {
      throw new SocialSecurityReviewRequiredError('Confirm matching filing status in Profile and Tax Organizer before applying the benefit thresholds.');
    }
    if (scheduleCNetProfit - depreciationDeduction < 0) {
      throw new SocialSecurityReviewRequiredError('Business-loss treatment needs review before including it in the Social Security income test.');
    }
    const livedApart = org.socialSecurityLivedApartAllYear;
    if (filingStatus === 'married_filing_separately' && livedApart !== 'yes' && livedApart !== 'no') {
      throw new SocialSecurityReviewRequiredError('Answer whether you lived apart from your spouse for the entire tax year.');
    }
    socialSecurityWorksheet = calculateSocialSecurityWorksheet({
      taxYear, filingStatus, ...benefitFacts,
      otherIncome: scheduleCNetProfit - depreciationDeduction + w2.wages + nonBenefitOtherIncome,
      // Pub915 line7 excludes student-loan interest (Schedule1 line21).
      allowedAdjustments: seCalc.halfSEDeduction + healthInsurancePremiums + sepIraContribution
        + solo401kContribution + simpleIraContribution + hsaContribution,
      livedApartAllYear: livedApart === 'yes',
    });
  }
  const socialSecurity = socialSecurityWorksheet?.taxableBenefits ?? 0;
  const socialSecurityNetBenefits = benefitFacts?.netBenefits ?? 0;
  const socialSecurityFederalWithheld = benefitFacts?.federalWithheld ?? 0;
  const taxExemptInterest = benefitFacts?.taxExemptInterest ?? 0;
  const otherIncome = nonBenefitOtherIncome + socialSecurity;
  const priorYearTotalTax = amount(ded.priorYearTotalTax ?? profile.prior_year_tax);
  const result = compute1040({
    taxYear, filingStatus, personalDeductionOrganizer: org, scheduleCNetProfit, w2Wages: w2.wages, w2MedicareWages: w2.medicareWages,
    w2FederalWithheld, socialSecurityFederalWithheld, estimatedPayments: input.estimatedPayments,
    selfEmploymentTax: seCalc.totalSETax, halfSEDeduction: seCalc.halfSEDeduction,
    otherIncome, numDependents: 0, numEITCChildren: 0,
    investmentIncome: interest + dividends + Math.max(0, capGains), longTermCapGains: Math.max(0, capGains), shortTermCapGains: 0,
    healthInsurancePremiums, sepIraContribution, solo401kContribution, simpleIraContribution, hsaContribution, studentLoanInterest,
    charitableDonations: amount(ded.charitableCashDonations) + amount(ded.charitableNonCashDonations), depreciationDeduction,
  }, priorYearTotalTax > 0 ? priorYearTotalTax : undefined);
  result.calculationWarnings.push(...reconciliation.warnings);
  if (dividends || capGains || iraDist || rental) {
    result.calculationWarnings.push('Organizer income amounts require tax review: dividend/gain character, retirement basis and rental treatment are not fully modeled.');
  }
  return {
    filingStatus, result, seCalc, depreciationDeduction, reconciliation, socialSecurityWorksheet, personalDeductions: result.personalDeductions,
    income: { grossReceipts: reconciliation.grossReceipts, w2Wages: w2.wages, scheduleCNetProfit, totalDeductible, otherIncome, otherOrdinaryIncome, interest, dividends, capGains, socialSecurity, socialSecurityNetBenefits, taxExemptInterest, iraDist, rental },
    w2: { wages: w2.wages, withheld: w2FederalWithheld, count: input.w2Entries.length, stateWithheld: w2.stateWithheld },
    deductions: { healthInsurancePremiums, sepIraContribution, solo401kContribution, hsaContribution, studentLoanInterest },
    payments: { estimatedPayments: input.estimatedPayments, w2FederalWithheld, socialSecurityFederalWithheld, totalFederalWithheld: w2FederalWithheld + socialSecurityFederalWithheld },
  };
}
