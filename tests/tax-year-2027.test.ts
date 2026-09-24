import { describe, expect, it } from 'vitest';
import {
  ACA_2027_PARAMETERS,
  HSA_2027_LIMITS,
  SALT_2027_PARAMETERS,
  TAX_YEAR_2027_STATUS,
} from '../lib/tax-rules/tax-year-2027';
import { getFederalTaxRules, SUPPORTED_TAX_YEARS, TAX_YEAR_2027_STATUS as apiStatus } from '../lib/tax-rules/federal-year-rules';

describe('published 2027 planning parameters', () => {
  it('matches Rev. Proc. 2026-24 §3, rather than copying 2026 health limits', () => {
    expect(HSA_2027_LIMITS).toEqual({
      selfOnly: 4500, family: 9000, catchUp: 1000,
      minimumDeductible: { selfOnly: 1750, family: 3500 },
      maximumOutOfPocket: { selfOnly: 8700, family: 17400 },
      directPrimaryCareMonthly: { selfOnly: 150, moreThanOnePerson: 300 },
      exceptedBenefitHra: 2250,
    });
    expect(HSA_2027_LIMITS.selfOnly).not.toBe(getFederalTaxRules(2026).hsaContributionLimit.selfOnly);
  });

  it('transcribes Rev. Proc. 2026-26 §3 in percentage units, including discontinuities', () => {
    expect(ACA_2027_PARAMETERS.employerAffordabilityPercent).toBe(10.22);
    expect(ACA_2027_PARAMETERS.applicablePercentages.map((band) => [
      band.fplMinimumPercent, band.fplMaximumPercent, band.initialPercent, band.finalPercent,
    ])).toEqual([
      [0, 133, 2.15, 2.15], [133, 150, 3.23, 4.30], [150, 200, 4.30, 6.78],
      [200, 250, 6.78, 8.66], [250, 300, 8.66, 10.22], [300, 400, 10.22, 10.22],
    ]);
  });

  it('derives the SALT caps and thresholds from the statutory 101% escalator', () => {
    expect(SALT_2027_PARAMETERS.cap).toBe(40400 * 1.01);
    expect(SALT_2027_PARAMETERS.phaseDownMagi).toBe(505000 * 1.01);
    expect(SALT_2027_PARAMETERS.marriedFilingSeparatelyCap).toBe(20402);
    expect(SALT_2027_PARAMETERS.marriedFilingSeparatelyPhaseDownMagi).toBe(255025);
    expect(SALT_2027_PARAMETERS.marriedFilingSeparatelyFloor).toBe(5000);
  });
});

describe('2027 coverage boundaries', () => {
  it('shares exactly the same status with annual API errors without enabling annual estimates', () => {
    expect(apiStatus).toBe(TAX_YEAR_2027_STATUS);
    expect(SUPPORTED_TAX_YEARS).not.toContain(2027);
    expect(() => getFederalTaxRules(2027)).toThrow('not published the 2027');
    expect(TAX_YEAR_2027_STATUS.annualEstimateAvailable).toBe(false);
    expect(TAX_YEAR_2027_STATUS.usualFilingYear).toBe(2028);
  });

  it('keeps every newly published or statutory topic guidance-only and sourced', () => {
    expect(TAX_YEAR_2027_STATUS.topics).toHaveLength(5);
    for (const topic of TAX_YEAR_2027_STATUS.topics) {
      expect(topic.application).toBe('guidance_only');
      expect(new URL(topic.source).hostname).toMatch(/^(www\.)?(irs\.gov|govinfo\.gov)$/);
      expect(topic.sourceSection).not.toBe('');
    }
    expect(TAX_YEAR_2027_STATUS.pendingPublication.some(({ item }) => item.includes('QBI'))).toBe(true);
    expect(TAX_YEAR_2027_STATUS.pendingPublication.some(({ item }) => item.includes('mileage'))).toBe(true);
    expect(TAX_YEAR_2027_STATUS.notImplemented.join(' ')).toContain('transaction-level');
  });
});
