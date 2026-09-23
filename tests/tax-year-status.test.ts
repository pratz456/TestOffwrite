import { describe, expect, it } from 'vitest';
import { describeUnsupportedTaxYear, getFederalTaxRules, LATEST_PUBLISHED_TAX_YEAR, nearestPublishedTaxYear, SUPPORTED_TAX_YEARS, TAX_YEAR_2027_STATUS, UnsupportedTaxYearError } from '../lib/tax-rules/federal-year-rules';
import { calculateEffectiveTaxRate, calculateFederalIncomeTax, getMarginalTaxRate, getUserTaxRate, getUserTaxRateDisplay } from '../lib/tax-rules/federal-brackets';
import { calcCombinedSERate } from '../lib/tax-rules/kpi-calculations';

describe('published parameter registry versus primary sources (Rev. Proc. 2024-40 / 2025-32, SSA, P.L. 119-21)', () => {
  it('encodes the verified 2025 and 2026 headline amounts', () => {
    const y2025 = getFederalTaxRules(2025);
    const y2026 = getFederalTaxRules(2026);
    expect(y2025.standardDeductions).toEqual({ single: 15750, married_filing_jointly: 31500, married_filing_separately: 15750, head_of_household: 23625 });
    expect(y2026.standardDeductions).toEqual({ single: 16100, married_filing_jointly: 32200, married_filing_separately: 16100, head_of_household: 24150 });
    expect([y2025.socialSecurityWageBase, y2026.socialSecurityWageBase]).toEqual([176100, 184500]);
    expect([y2025.saltCap, y2025.saltPhaseoutStart, y2026.saltCap, y2026.saltPhaseoutStart]).toEqual([40000, 500000, 40400, 505000]);
    expect([y2025.qbiPhaseInWidth, y2026.qbiPhaseInWidth]).toEqual([50000, 75000]);
    expect(y2026.qbiThreshold).toEqual({ single: 201750, married_filing_jointly: 403500, married_filing_separately: 201775, head_of_household: 201750 });
    expect(y2026.brackets.single.map(bracket => bracket.max)).toEqual([12400, 50400, 105700, 201775, 256225, 640600, Infinity]);
    expect(y2026.brackets.head_of_household.map(bracket => bracket.max)).toEqual([17700, 67450, 105700, 201750, 256200, 640600, Infinity]);
    expect(y2026.capitalGainsThresholds.single).toEqual([49450, 545500]);
    expect(y2026.eitc[3]).toMatchObject({ maxCredit: 8231, phaseOutStart: 23890, phaseOutStartMFJ: 31160, phaseOutEnd: 62974, phaseOutEndMFJ: 70244 });
    expect(y2026.childTaxCreditPerChild).toBe(2200);
  });

  it('refuses 2027 with an explanation of what is pending and what is already law', () => {
    expect(SUPPORTED_TAX_YEARS).toEqual([2024, 2025, 2026]);
    expect(LATEST_PUBLISHED_TAX_YEAR).toBe(2026);
    expect(() => getFederalTaxRules(2027)).toThrow(UnsupportedTaxYearError);
    expect(describeUnsupportedTaxYear(2027)).toContain('not published the 2027');
    expect(TAX_YEAR_2027_STATUS.pendingPublication.map(item => item.item)).toEqual(expect.arrayContaining([
      'Ordinary income bracket amounts', 'Social Security wage base and quarter of coverage', 'Standard mileage rates',
    ]));
    expect(TAX_YEAR_2027_STATUS.knownByStatute.join(' ')).toContain('$25,000');
    expect(TAX_YEAR_2027_STATUS.knownByStatute.join(' ')).not.toMatch(/2027 bracket amounts are/);
  });

  it('preserves published-year calculations and the latest published default', () => {
    expect(nearestPublishedTaxYear(2027)).toBe(2026);
    expect(nearestPublishedTaxYear(2023)).toBe(2024);
    expect(calculateFederalIncomeTax(12400, 'single')).toBe(1240);
    expect(calculateFederalIncomeTax(12400, 'single', 2025)).toBe(1192.5 + (12400 - 11925) * 0.12);
    const profile = { income: 100000, filing_status: 'Single' };
    expect(calculateEffectiveTaxRate(profile, 2026)).not.toBe(calculateEffectiveTaxRate(profile, 2025));
    expect(calculateEffectiveTaxRate(profile)).toBe(calculateEffectiveTaxRate(profile, 2026));
    expect(getMarginalTaxRate({ income: 60000, filing_status: 'Single' }, 2026)).toBe(22);
    expect(calcCombinedSERate(60000, 'Single', 0, 2026).incomeTaxDollars).not.toBe(calcCombinedSERate(60000, 'Single', 0, 2025).incomeTaxDollars);
  });

  it.each([2024, 2025, 2026])('preserves missing-income and zero-profit behavior for supported year %i', taxYear => {
    const profile = { income: 0, filing_status: 'Single' };
    expect(calculateEffectiveTaxRate(profile, taxYear)).toBe(25);
    expect(getMarginalTaxRate(profile, taxYear)).toBe(25);
    expect(getUserTaxRate(undefined, taxYear)).toBe(0.25);
    expect(getUserTaxRate(profile, taxYear)).toBe(0.25);
    expect(calcCombinedSERate(0, 'Single', 0, taxYear).totalTaxDollars).toBe(0);
  });

  it.each([2023, 2027, 2028])('rejects unsupported year %i before returning any numeric estimate', taxYear => {
    for (const income of [100000, 0, -100, undefined, 'invalid']) {
      const profile = { income, filing_status: 'Single' };
      expect(() => calculateEffectiveTaxRate(profile, taxYear)).toThrow(UnsupportedTaxYearError);
      expect(() => getMarginalTaxRate(profile, taxYear)).toThrow(UnsupportedTaxYearError);
      expect(() => getUserTaxRate(profile, taxYear)).toThrow(UnsupportedTaxYearError);
    }
    expect(() => getUserTaxRate(undefined, taxYear)).toThrow(UnsupportedTaxYearError);
    expect(() => getUserTaxRate(null, taxYear)).toThrow(UnsupportedTaxYearError);
    for (const profit of [100000, 0, -100]) {
      expect(() => calculateFederalIncomeTax(profit, 'single', taxYear)).toThrow(UnsupportedTaxYearError);
      expect(() => calcCombinedSERate(profit, 'Single', 0, taxYear)).toThrow(UnsupportedTaxYearError);
    }
  });

  it('shows an unavailable estimate for an explicit 2027 year even with missing income', () => {
    for (const profile of [{ income: 100000, filing_status: 'Single' }, { income: 0, filing_status: 'Single' }, undefined]) {
      expect(getUserTaxRateDisplay(profile, 2027)).toEqual({
        rate: null, filingStatus: null, reviewMessage: describeUnsupportedTaxYear(2027),
      });
    }
  });
});
