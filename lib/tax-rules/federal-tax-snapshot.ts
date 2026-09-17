import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import type { Asset, DepreciationElections } from '@/lib/reports/calc4562';
import type { HomeOfficeSettings } from '@/lib/reports/calc8829';
import { calcScheduleSE } from '@/lib/reports/calcSE';
import { compute1040 } from './compute-1040';
import { computeScheduleCProfit } from './schedule-c-profit';
import { reconcileBusinessIncome, type IncomeRecord } from './business-income';
import { summarizeW2Income } from './w2-income';
import { normalizeFilingStatus } from './filing-status';
import { assertGenericDependentCreditScope } from './credit-scope';
import { readSocialSecurityFacts, calculateSocialSecurityWorksheet, assertSocialSecurityAdjustmentRecords, SocialSecurityReviewRequiredError } from './social-security';
import { calculateCapitalGainCharacter, hasCapitalGainAmounts, readCapitalGainFacts } from './capital-gains';

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
  /** settings/homeOffice facts; omitted or null means no home office is claimed in settings. */
  homeOffice?: HomeOfficeSettings | null;
  /** settings/depreciation annual elections (de minimis safe harbor years). */
  depreciationElections?: DepreciationElections | null;
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
  // Schedule C ordering shared with the SE loader: line 13 assets, line 29, line 30 home office, line 31.
  const scheduleC = computeScheduleCProfit({
    taxYear, grossReceipts: reconciliation.grossReceipts, confirmedExpenses: totalDeductible, w2Wages: w2.wages,
    assets: input.assets, depreciationElections: input.depreciationElections, homeOffice: input.homeOffice, legacyHomeOfficeMethod: profile.home_office_method,
  });
  const scheduleCNetProfit = scheduleC.profitBeforeAssets;
  const { depreciationDeduction, deMinimisExpense, homeOfficeDeduction } = scheduleC;
  const scheduleCLine31NetProfit = scheduleC.netProfit;
  const seCalc = calcScheduleSE({ scheduleCNetProfit: scheduleCLine31NetProfit, taxYear }, filingStatus, w2.socialSecurityWages, w2.medicareWagesForSE);

  const interest = amount(org.amount1099INT);
  const dividends = amount(org.amount1099DIV);
  // Any saved gain/loss (legacy total or short/long-term split) keeps the Social
  // Security gate below; character is resolved only after that gate.
  const anyCapitalGainAmount = hasCapitalGainAmounts(org);
  const iraDist = amount(org.amountIRADistributions);
  const rental = amount(org.amountRentalIncome);
  const otherOrdinaryIncome = amount(org.amountOtherIncome);
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
    if (anyCapitalGainAmount || rental !== 0) {
      throw new SocialSecurityReviewRequiredError('Capital gain/loss character and allowed rental income/loss must be reviewed before including them in this supported Social Security estimate. These return calculations are not yet fully modeled.');
    }
    assertSocialSecurityAdjustmentRecords(org, { healthInsurancePremiums, sepIraContribution, solo401kContribution, simpleIraContribution, hsaContribution, studentLoanInterest });
    if (!profile.filing_status || !org.filingStatus || normalizeFilingStatus(org.filingStatus) !== filingStatus) {
      throw new SocialSecurityReviewRequiredError('Confirm matching filing status in Profile and Tax Organizer before applying the benefit thresholds.');
    }
    if (scheduleCLine31NetProfit < 0) {
      throw new SocialSecurityReviewRequiredError('Business-loss treatment needs review before including it in the Social Security income test.');
    }
    const livedApart = org.socialSecurityLivedApartAllYear;
    if (filingStatus === 'married_filing_separately' && livedApart !== 'yes' && livedApart !== 'no') {
      throw new SocialSecurityReviewRequiredError('Answer whether you lived apart from your spouse for the entire tax year.');
    }
  }
  // Schedule D character (short-term ordinary, long-term preferential, §1211(b) loss limit).
  // Read after the benefit gates so a nonzero legacy total keeps its existing review code.
  const capitalGains = calculateCapitalGainCharacter({ taxYear, filingStatus, ...readCapitalGainFacts(org) });
  const capGains = capitalGains.line7;
  const nonBenefitOtherIncome = interest + dividends + capGains + iraDist + rental + otherOrdinaryIncome;
  if (benefitFacts) {
    const livedApart = org.socialSecurityLivedApartAllYear;
    socialSecurityWorksheet = calculateSocialSecurityWorksheet({
      taxYear, filingStatus, ...benefitFacts,
      otherIncome: scheduleCLine31NetProfit + w2.wages + nonBenefitOtherIncome,
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
    // Pub 596: EITC investment income includes the positive Form 1040 line 7 amount.
    investmentIncome: interest + dividends + Math.max(0, capGains),
    longTermCapGains: capitalGains.preferentialLongTermGain, shortTermCapGains: capitalGains.ordinaryShortTermGain,
    healthInsurancePremiums, sepIraContribution, solo401kContribution, simpleIraContribution, hsaContribution, studentLoanInterest,
    charitableDonations: amount(ded.charitableCashDonations) + amount(ded.charitableNonCashDonations), depreciationDeduction, deMinimisExpense, homeOfficeDeduction,
  }, priorYearTotalTax > 0 ? priorYearTotalTax : undefined);
  result.calculationWarnings.push(...reconciliation.warnings, ...capitalGains.warnings, ...scheduleC.warnings);
  if (dividends || iraDist || rental) {
    result.calculationWarnings.push('Organizer income amounts require tax review: qualified-dividend character, retirement basis and rental treatment are not fully modeled.');
  }
  return {
    filingStatus, result, seCalc, depreciationDeduction, deMinimisExpense, homeOfficeDeduction, scheduleC, reconciliation, socialSecurityWorksheet, personalDeductions: result.personalDeductions,
    capitalGains, businessLoss: result.businessLoss, obbbaDeductions: result.obbbaDeductions,
    income: {
      grossReceipts: reconciliation.grossReceipts, w2Wages: w2.wages, scheduleCNetProfit, scheduleCAllowed: result.scheduleCAllowed, totalDeductible, deMinimisExpense, depreciationDeduction,
      scheduleCLine29TentativeProfit: scheduleC.tentativeProfit, homeOfficeDeduction, scheduleCLine31NetProfit,
      otherIncome, otherOrdinaryIncome, interest, dividends,
      capGains, shortTermCapGains: capitalGains.netShortTerm, longTermCapGains: capitalGains.netLongTerm, capitalLossCarryforward: capitalGains.lossCarryforward,
      socialSecurity, socialSecurityNetBenefits, taxExemptInterest, iraDist, rental,
    },
    w2: { wages: w2.wages, withheld: w2FederalWithheld, count: input.w2Entries.length, stateWithheld: w2.stateWithheld },
    deductions: { healthInsurancePremiums, sepIraContribution, solo401kContribution, hsaContribution, studentLoanInterest },
    payments: { estimatedPayments: input.estimatedPayments, w2FederalWithheld, socialSecurityFederalWithheld, totalFederalWithheld: w2FederalWithheld + socialSecurityFederalWithheld },
  };
}
