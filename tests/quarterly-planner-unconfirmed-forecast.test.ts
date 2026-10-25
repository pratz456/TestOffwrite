import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calcScheduleSE } from '@/lib/reports/calcSE';
import { getFederalTaxRules } from '@/lib/tax-rules/federal-year-rules';
import { calculateRegularEstimatedPayments, QuarterlyReviewRequiredError } from '@/lib/tax-provider/regular-estimated-payments';
import {
  buildQuarterlyPlan, calculateRequiredAnnualPayment, readYesNo, resolveQuarterlyPlannerFacts,
  type QuarterlyPlan,
} from '@/lib/tax-provider/quarterly-planner';

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn() }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: unknown) { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next; }]; },
    useEffect(effect: () => void | (() => void), deps: unknown[]) { const i = h.cursor++, old = h.slots[i]; if (!same(old?.deps, deps)) { const next: any = { deps }; h.slots[i] = next; h.effects.push(() => { old?.cleanup?.(); next.cleanup = effect(); }); } },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: h.request }));
import { QuarterlyTaxCalculator } from '@/components/quarterly-tax-calculator';

const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props?.children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '';
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function render(component: () => any) { h.cursor = 0; const tree = component(); h.effects.splice(0).forEach(effect => effect()); return tree; }

const profile = { filing_status: 'Single' };
const ytdTax = (profit: number, filingStatus = 'single') => calcScheduleSE({ scheduleCNetProfit: profit, taxYear: 2026 }, filingStatus).totalSETax; const ninetyOf = (tax: number) => Math.round(Math.round(tax * 100) * 0.9) / 100; const dollars = (tax: number) => tax.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function resolvedPlan(filingStatus: string, agi: string, profit: number, organizer: Record<string, unknown> = {}) {
  const resolution = resolveQuarterlyPlannerFacts({
    taxYear: 2026,
    annual: { filingStatus, totalTax: ytdTax(profit, filingStatus), refundableCredits: 0, totalFederalWithheld: 0, totalIncome: profit },
    profile: { filing_status: filingStatus },
    organizer: { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '10000', priorYearAGI: agi, priorYearFilingStatus: filingStatus, ...organizer },
    deductions: {},
  });
  if (resolution.status !== 'ready') throw new Error(`expected a plan, received ${JSON.stringify(resolution)}`);
  return { resolution, plan: buildQuarterlyPlan({ ...resolution.facts, payments: [], asOf: '2026-03-31' }) };
}

describe('quarterly planner before a full-year forecast is confirmed', () => {
  it('uses $2,500 per quarter for $15,000 of January through March profit and a saved $10,000 prior year', () => {
    const se = calcScheduleSE({ scheduleCNetProfit: 15000, taxYear: 2026 }, 'single');
    expect(15000 - se.halfSEDeduction).toBeLessThan(getFederalTaxRules(2026).standardDeductions.single);
    const seTax = se.totalSETax;
    const { resolution, plan } = resolvedPlan('single', '50000', 15000);
    expect(plan.requiredAnnualPayment.currentYearTax).toBe(seTax);
    expect(plan.requiredAnnualPayment.ninetyPercentOfCurrentYear).toBe(ninetyOf(seTax));
    expect(plan.requiredAnnualPayment.basis).toBe('prior_year_100');
    expect(plan.requiredAnnualPayment.fullYearForecastConfirmed).toBe(false);
    expect(plan.requiredAnnualPayment.requiredAnnualPayment).toBe(10000);
    expect(plan.requiredAnnualPayment.estimatedPaymentsRequired).toBe(10000);
    expect(plan.installments.map(item => item.requiredInstallment)).toEqual([2500, 2500, 2500, 2500]);
    expect(plan.installments.map(item => item.plannedEstimatedPayment)).toEqual([2500, 2500, 2500, 2500]);
    expect(resolution.facts.assumptions[0]).not.toContain('treated as the full-year forecast');
    expect(resolution.facts.assumptions[0]).toContain('PLACEHOLDER');
    expect(resolution.facts.assumptions[0]).toContain(dollars(seTax));
  });

  it('keeps $2,500 per quarter when year-to-date tax is under $1,000 and a $10,000 prior year is saved', () => {
    const se = calcScheduleSE({ scheduleCNetProfit: 5000, taxYear: 2026 }, 'single');
    const lowTax = se.totalSETax;
    expect(lowTax).toBeLessThan(1000);
    const { plan } = resolvedPlan('single', '50000', 5000);
    expect(plan.requiredAnnualPayment.deMinimis).toMatchObject({ applies: false, taxLessWithholding: lowTax });
    expect(plan.requiredAnnualPayment.estimatedPaymentsRequired).toBe(10000);
    expect(plan.installments.map(item => item.plannedEstimatedPayment)).toEqual([2500, 2500, 2500, 2500]);
    const assumptions = plan.assumptions.join(' ');
    expect(assumptions).not.toContain('no estimated payments are required');
    expect(assumptions.toLowerCase()).not.toContain('no payments required');
  });

  it('stays in review when no prior year is saved and no full-year forecast is confirmed', () => {
    const resolution = resolveQuarterlyPlannerFacts({
      taxYear: 2026,
      annual: { filingStatus: 'single', totalTax: ytdTax(5000), refundableCredits: 0, totalFederalWithheld: 0, totalIncome: 5000 },
      profile, organizer: {}, deductions: {},
    });
    expect(resolution.status).toBe('review_required');
    if (resolution.status !== 'review_required') throw new Error('expected review');
    expect(resolution.missingFacts.map(fact => fact.label)).toEqual([
      "PLACEHOLDER Add last year's return",
      'PLACEHOLDER Confirm a full-year forecast',
      "PLACEHOLDER My total tax last year was $0",
    ]);
    expect(resolution.notes.join(' ')).toContain("PLACEHOLDER Can't tell yet");
    const body = JSON.stringify(resolution);
    expect(body).not.toContain('no estimated payments are required');
    expect(body).not.toContain('"estimatedPaymentsRequired":0');
    expect(body).not.toContain('treated as the full-year forecast');
  });

  it('does not calculate a zero payment from year-to-date tax when the prior return did not cover 12 months', () => {
    const resolution = resolveQuarterlyPlannerFacts({
      taxYear: 2026,
      annual: { filingStatus: 'single', totalTax: ytdTax(5000), refundableCredits: 0, totalFederalWithheld: 0, totalIncome: 5000 },
      profile, organizer: { priorReturnCoveredTwelveMonths: 'no' }, deductions: {},
    });
    expect(resolution.status).toBe('review_required');
    if (resolution.status !== 'review_required') throw new Error('expected review');
    expect(resolution.notes.join(' ')).toContain("PLACEHOLDER Can't tell yet");
    expect(JSON.stringify(resolution)).not.toContain('no estimated payments are required');
    expect(() => calculateRequiredAnnualPayment({
      taxYear: 2026, filingStatus: 'single', currentYearTax: ytdTax(5000), withholding: 0,
      priorYear: { available: false, reason: 'short_year_or_no_return' },
    })).toThrow(QuarterlyReviewRequiredError);
  });

  it('requires no annual payment when last year tax was $0 and both yes answers are saved', () => {
    const resolution = resolveQuarterlyPlannerFacts({
      taxYear: 2026,
      annual: { filingStatus: 'single', totalTax: ytdTax(15000), refundableCredits: 0, totalFederalWithheld: 0, totalIncome: 15000 },
      profile, organizer: { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '0', priorYearFullYearUsCitizenOrResident: 'yes', priorYearFilingStatus: 'single' }, deductions: {},
    });
    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') throw new Error('expected ready');
    const plan = buildQuarterlyPlan({ ...resolution.facts, payments: [], asOf: '2026-03-31' });
    expect(plan.requiredAnnualPayment.requiredAnnualPayment).toBe(0);
    expect(plan.requiredAnnualPayment.estimatedPaymentsRequired).toBe(0);
    expect(plan.requiredAnnualPayment.deMinimis.applies).toBe(false);
    expect(plan.requiredAnnualPayment.basis).toBe('prior_year_100');
    expect(plan.installments.map(item => item.requiredInstallment)).toEqual([0, 0, 0, 0]);
    expect(plan.assumptions.join(' ')).toContain('no annual payment');
  });

  it('reviews a $0 prior year when the residency answer is no', () => {
    const resolution = resolveQuarterlyPlannerFacts({
      taxYear: 2026,
      annual: { filingStatus: 'single', totalTax: ytdTax(15000), refundableCredits: 0, totalFederalWithheld: 0, totalIncome: 15000 },
      profile,
      organizer: { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '0', priorYearAGI: '50000', priorYearFullYearUsCitizenOrResident: 'no' },
      deductions: {},
    });
    expect(resolution.status).toBe('review_required');
    if (resolution.status !== 'review_required') throw new Error('expected review');
    expect(resolution.notes.join(' ')).toContain('PLACEHOLDER');
    expect(JSON.stringify(resolution)).not.toContain('no annual payment');
    expect(JSON.stringify(resolution)).not.toContain('"estimatedPaymentsRequired":0');
  });

  it('reviews a no answer on the same taxpayers and filing status question', () => {
    let regularMessage = '';
    try {
      calculateRegularEstimatedPayments({
        taxYear: 2026, filingStatus: 'single', expectedTaxAfterCredits: 20000, expectedAnnualWithholding: 0,
        reviewedTaxAmounts: true, regularMethodConfirmed: true,
        priorYear: { available: true, adjustedGrossIncome: 50000, taxAfterAdjustments: 10000, fullTwelveMonths: true, sameTaxpayersAndFilingStatus: false, fullYearUSResident: true },
      });
    } catch (error) {
      regularMessage = error instanceof Error ? error.message : '';
    }
    const resolution = resolveQuarterlyPlannerFacts({
      taxYear: 2026,
      annual: { filingStatus: 'single', totalTax: ytdTax(15000), refundableCredits: 0, totalFederalWithheld: 0, totalIncome: 15000 },
      profile,
      organizer: { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '10000', priorYearAGI: '50000', priorYearSameTaxpayersAndFilingStatus: 'no' },
      deductions: {},
    });
    expect(regularMessage).toContain('adjusting');
    expect(resolution.status).toBe('review_required');
    if (resolution.status !== 'review_required') throw new Error('expected review');
    expect(resolution.notes.join(' ')).toContain(regularMessage);
  });

  it.each([
    ['single', '150000', 'prior_year_100', 10000, 2500],
    ['single', '150000.01', 'prior_year_110', 11000, 2750],
    ['married_filing_separately', '75000', 'prior_year_100', 10000, 2500],
    ['married_filing_separately', '75000.01', 'prior_year_110', 11000, 2750],
  ] as const)('uses the prior-year percentage at the %s AGI boundary of %s', (filingStatus, agi, basis, annualPayment, quarter) => {
    const { plan } = resolvedPlan(filingStatus, agi, 15000);
    expect(plan.requiredAnnualPayment.currentYearTax).toBe(ytdTax(15000, filingStatus));
    expect(plan.requiredAnnualPayment.priorYear?.agiThreshold).toBe(filingStatus === 'married_filing_separately' ? 75000 : 150000);
    expect(plan.requiredAnnualPayment.basis).toBe(basis);
    expect(plan.requiredAnnualPayment.requiredAnnualPayment).toBe(annualPayment);
    expect(plan.installments.map(item => item.requiredInstallment)).toEqual([quarter, quarter, quarter, quarter]);
  });
});

describe('blank answers, joint or separate returns, and the confirmed forecast exception', () => {
  const annualFor = (filingStatus: string, profit: number) => ({
    filingStatus, totalTax: ytdTax(profit, filingStatus), refundableCredits: 0, totalFederalWithheld: 0, totalIncome: profit,
  });

  it.each(['50000', '0', 0] as const)('asks the residency question and shows no figure when prior-year tax is 0 and saved AGI is %j', agi => {
    const resolution = resolveQuarterlyPlannerFacts({
      taxYear: 2026,
      annual: annualFor('single', 15000),
      profile,
      organizer: { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '0', priorYearAGI: agi, priorYearFilingStatus: 'single' },
      deductions: {},
    });
    expect(resolution.status).toBe('review_required');
    if (resolution.status !== 'review_required') throw new Error('expected review');
    expect(resolution.missingFacts.map(fact => fact.key)).toContain('prior_year_us_citizen_or_resident');
    expect(resolution.missingFacts.map(fact => fact.key)).not.toContain('prior_year_agi');
    const body = JSON.stringify(resolution);
    expect(body).not.toContain('requires no annual payment');
    expect(body).not.toContain('estimatedPaymentsRequired');
  });

  it('asks the joint or separate question and shows no figure when that answer is blank', () => {
    const resolution = resolveQuarterlyPlannerFacts({
      taxYear: 2026,
      annual: annualFor('single', 15000),
      profile,
      organizer: { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '10000', priorYearAGI: '50000' },
      deductions: {},
    });
    expect(resolution.status).toBe('review_required');
    if (resolution.status !== 'review_required') throw new Error('expected review');
    expect(resolution.missingFacts.map(fact => fact.key)).toContain('prior_year_joint_or_separate');
    expect(resolution.missingFacts.map(fact => fact.label).join(' ')).toContain('PLACEHOLDER');
    expect(JSON.stringify(resolution)).not.toContain('estimatedPaymentsRequired');
  });

  it('reviews a switch from a 2025 separate return to a 2026 joint return', () => {
    const resolution = resolveQuarterlyPlannerFacts({
      taxYear: 2026,
      annual: annualFor('married_filing_jointly', 15000),
      profile: { filing_status: 'married_filing_jointly' },
      organizer: { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '10000', priorYearAGI: '50000', priorYearFilingStatus: 'married_filing_separately' },
      deductions: {},
    });
    expect(resolution.status).toBe('review_required');
    if (resolution.status !== 'review_required') throw new Error('expected review');
    expect(resolution.notes.join(' ')).toContain('PLACEHOLDER');
    expect(resolution.notes.join(' ')).toContain('adjusting');
    expect(JSON.stringify(resolution)).not.toContain('estimatedPaymentsRequired');
  });

  it('uses the prior-year target for a 2025 single return and a 2026 head of household return', () => {
    const resolution = resolveQuarterlyPlannerFacts({
      taxYear: 2026,
      annual: annualFor('head_of_household', 15000),
      profile: { filing_status: 'head_of_household' },
      organizer: { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '10000', priorYearAGI: '50000', priorYearFilingStatus: 'single' },
      deductions: {},
    });
    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') throw new Error('expected ready');
    const plan = buildQuarterlyPlan({ ...resolution.facts, payments: [], asOf: '2026-03-31' });
    expect(plan.requiredAnnualPayment.currentYearTax).toBe(ytdTax(15000, 'head_of_household'));
    expect(plan.requiredAnnualPayment.basis).toBe('prior_year_100');
    expect(plan.requiredAnnualPayment.requiredAnnualPayment).toBe(10000);
    expect(plan.installments.map(item => item.requiredInstallment)).toEqual([2500, 2500, 2500, 2500]);
  });

  it('does not give none required when the 12-month answer is no and prior-year tax is $0', () => {
    const resolution = resolveQuarterlyPlannerFacts({
      taxYear: 2026,
      annual: annualFor('single', 15000),
      profile,
      organizer: { priorReturnCoveredTwelveMonths: 'no', priorYearTax: '0', priorYearAGI: '50000', priorYearFilingStatus: 'single' },
      deductions: {},
    });
    expect(resolution.status).toBe('review_required');
    if (resolution.status !== 'review_required') throw new Error('expected review');
    const body = JSON.stringify(resolution);
    expect(body).not.toContain('no annual payment');
    expect(body).not.toContain('estimatedPaymentsRequired');
  });

  it('treats an empty or unparseable prior-year AGI as missing and keeps an entered 0', () => {
    for (const priorYearAGI of ['', '   ', 'n/a']) {
      const resolution = resolveQuarterlyPlannerFacts({
        taxYear: 2026,
        annual: annualFor('single', 15000),
        profile,
        organizer: { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '10000', priorYearFilingStatus: 'single', priorYearAGI },
        deductions: {},
      });
      expect(resolution.status).toBe('review_required');
      if (resolution.status !== 'review_required') throw new Error('expected review');
      expect(resolution.missingFacts.map(fact => fact.key)).toContain('prior_year_agi');
    }
    for (const priorYearAGI of ['0', 0]) {
      const resolution = resolveQuarterlyPlannerFacts({
        taxYear: 2026,
        annual: annualFor('single', 15000),
        profile,
        organizer: { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '10000', priorYearFilingStatus: 'single', priorYearAGI },
        deductions: {},
      });
      expect(resolution.status).toBe('ready');
      if (resolution.status !== 'ready') throw new Error('expected ready');
      expect(resolution.facts.priorYear).toMatchObject({ agi: 0, totalTax: 10000 });
    }
  });

  it('reads a saved boolean true or false as yes or no', () => {
    expect(readYesNo(true)).toBe('yes');
    expect(readYesNo(false)).toBe('no');
    const ready = resolveQuarterlyPlannerFacts({
      taxYear: 2026,
      annual: annualFor('single', 15000),
      profile,
      organizer: { priorReturnCoveredTwelveMonths: true, priorYearTax: '10000', priorYearAGI: '50000', priorYearFilingStatus: 'single' },
      deductions: {},
    });
    expect(ready.status).toBe('ready');
    const blocked = resolveQuarterlyPlannerFacts({
      taxYear: 2026,
      annual: annualFor('single', 15000),
      profile,
      organizer: { priorReturnCoveredTwelveMonths: false, priorYearTax: '0', priorYearAGI: '50000', priorYearFilingStatus: 'single' },
      deductions: {},
    });
    expect(blocked.status).toBe('review_required');
    expect(JSON.stringify(blocked)).not.toContain('requires no annual payment');
  });

  it('does not describe a confirmed full-year forecast as independent of the prior-year target', () => {
    const resolution = resolveQuarterlyPlannerFacts({
      taxYear: 2026,
      annual: { filingStatus: 'single', totalTax: 20000, refundableCredits: 0, totalFederalWithheld: 0, totalIncome: 80000 },
      profile,
      organizer: { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '10000', priorYearAGI: '50000', priorYearFilingStatus: 'single', fullYearForecastConfirmed: 'yes' },
      deductions: {},
    });
    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') throw new Error('expected ready');
    const note = resolution.facts.assumptions[0];
    expect(note).toContain('PLACEHOLDER');
    expect(note).toContain('$20,000.00');
    expect(note).not.toContain('does not depend');
    expect(note).not.toContain('treated as the full-year forecast');
  });

  it('does not apply the $1,000 exception to year-to-date tax when the confirmed full-year forecast is over $1,000 after withholding', () => {
    const yearToDate = ytdTax(5000);
    expect(yearToDate).toBeLessThan(1000);
    const forecast = 2500;
    const withholding = 400;
    const net = Math.round((forecast - withholding) * 100) / 100;
    expect(net).toBeGreaterThan(1000);
    const result = calculateRequiredAnnualPayment({
      taxYear: 2026, filingStatus: 'single', currentYearTax: yearToDate, confirmedFullYearTax: forecast, withholding,
      fullYearForecastConfirmed: true,
      priorYear: { available: true, totalTax: 10000, agi: 50000, coveredTwelveMonths: true },
    });
    expect(result.currentYearTax).toBe(yearToDate);
    expect(result.deMinimis.applies).toBe(false);
    expect(result.deMinimis.taxLessWithholding).toBe(net);
  });
});

describe('safe harbor heading', () => {
  const currentYear = new Date().getFullYear();
  beforeEach(() => { h.slots = []; h.cursor = 0; h.effects = []; h.request.mockReset(); });
  afterEach(() => { h.slots.forEach(slot => slot?.cleanup?.()); });

  function show(plan: QuarterlyPlan) {
    h.slots = [];
    h.cursor = 0;
    h.effects = [];
    h.request.mockImplementation(() => Response.json({
      taxYear: currentYear, totalEstimatedTax: plan.requiredAnnualPayment.currentYearTax, recordedEstimatedPayments: 0, w2Withheld: 0,
      calculationWarnings: [], paymentReview: { code: 'QUARTERLY_PLANNER_READY', message: 'Planning estimate from reviewed facts.' },
      planner: plan,
      quarters: plan.installments.map(item => ({ quarter: item.quarter, dueDate: item.dueDate, amountPaid: 0 })),
    }));
    const component = () => QuarterlyTaxCalculator({ userProfile: { id: 'synthetic' }, transactions: [] });
    render(component);
    return flush().then(() => text(render(component)));
  }

  it('does not put a safe harbor heading on a 90% basis unless a full-year forecast is confirmed', async () => {
    const confirmed = buildQuarterlyPlan({
      taxYear: 2026, filingStatus: 'single', currentYearTax: 10000, withholding: 0, fullYearForecastConfirmed: true,
      priorYear: { available: true, totalTax: 10000, agi: 50000, coveredTwelveMonths: true }, payments: [], asOf: '2026-03-31',
    });
    const unconfirmed = { ...confirmed, requiredAnnualPayment: { ...confirmed.requiredAnnualPayment, basis: 'current_year_90' as const, fullYearForecastConfirmed: false } };
    const hidden = await show(unconfirmed);
    expect(hidden).not.toContain('Safe-harbor basis used');
    expect(hidden).toContain('PLACEHOLDER Current-year percentage basis');
    const { plan } = resolvedPlan('single', '50000', 15000);
    const shown = await show(plan);
    expect(shown).toContain('Safe-harbor basis used: 100% of 2025 tax ($10,000.00)');
    expect(shown).not.toContain('Safe-harbor basis used: 90%');
  });
});
