import { describe, expect, it } from 'vitest';
import {
  ENCODED_STATE_CODES, STATE_REGISTRY_TAX_YEARS, getStateYearRules, isSupportedStateYear, resolveStateCode,
  scheduleTax, supportedStateYears, type CaliforniaRules, type FlatRateRules, type NewYorkRules, type OhioRules, type RateSchedule,
} from '../lib/tax-rules/state';
import { NEW_YORK_BRACKET_EDGES } from '../lib/tax-rules/state/new-york';

const NO_TAX = ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY'];
const edges = (schedule: RateSchedule) => schedule.slice(1).map(segment => segment.over);
const rules = <T>(state: string, year: number) => {
  const found = getStateYearRules(state, year);
  if (!isSupportedStateYear(found)) throw new Error(`${state} ${year} unexpectedly unsupported: ${found.reason}`);
  return found as unknown as T;
};

describe('state registry sanity', () => {
  it('encodes exactly the ten requested states plus the other no-income-tax states, for 2025 and 2026 only', () => {
    expect([...ENCODED_STATE_CODES]).toEqual([...new Set([...NO_TAX, 'CA', 'GA', 'IL', 'NC', 'NY', 'OH', 'PA'])].sort());
    expect([...STATE_REGISTRY_TAX_YEARS]).toEqual([2025, 2026]);
    const pairs = supportedStateYears().map(pair => `${pair.stateCode}-${pair.taxYear}`);
    // 9 no-tax states and 4 flat states for both years, New York for both years, California and Ohio for 2025 only.
    expect(pairs).toHaveLength(9 * 2 + 4 * 2 + 2 + 1 + 1);
    expect(pairs).toContain('CA-2025'); expect(pairs).not.toContain('CA-2026');
    expect(pairs).toContain('OH-2025'); expect(pairs).not.toContain('OH-2026');
    expect(pairs).toContain('NY-2025'); expect(pairs).toContain('NY-2026');
  });

  it('gives every supported state-year primary sources with an effective-year note, a review date and an unmodeled list', () => {
    for (const { stateCode, taxYear } of supportedStateYears()) {
      const found = getStateYearRules(stateCode, taxYear);
      if (!isSupportedStateYear(found)) throw new Error('unreachable');
      expect(found.sources.length, `${stateCode} ${taxYear}`).toBeGreaterThan(0);
      for (const source of found.sources) {
        const host = new URL(source.url).hostname;
        expect(source.url.startsWith('https://'), source.url).toBe(true);
        expect(host.endsWith('.gov') || host === 'floridarevenue.com', `${stateCode}: ${host} is not a government source`).toBe(true);
        expect(source.note.length, source.url).toBeGreaterThan(20);
      }
      expect(found.sources.some(source => /20(25|26)|2021|1980/.test(source.note)), `${stateCode} ${taxYear} note lacks an effective year`).toBe(true);
      expect(found.reviewedAt).toBe('2026-09-17');
      expect(Array.isArray(found.unmodeled)).toBe(true);
      expect(found.stateCode).toBe(stateCode); expect(found.taxYear).toBe(taxYear);
    }
  });

  it('marks 2027, states that are not encoded, unpublished 2026 parameters and unknown values as unsupported with a reason', () => {
    for (const state of ['CA', 'NY', 'TX', 'OH']) {
      const found = getStateYearRules(state, 2027);
      expect(isSupportedStateYear(found)).toBe(false);
      if (!isSupportedStateYear(found)) expect(found.reason).toMatch(/2025 and 2026 only.*2027/);
    }
    const nj = getStateYearRules('NJ', 2025);
    expect(isSupportedStateYear(nj)).toBe(false);
    if (!isSupportedStateYear(nj)) expect(nj.reason).toContain('New Jersey');
    for (const state of ['CA', 'OH']) {
      const found = getStateYearRules(state, 2026);
      expect(isSupportedStateYear(found)).toBe(false);
      if (!isSupportedStateYear(found)) { expect(found.reason).toMatch(/2026/); expect(found.reason).toMatch(/2025 only/); expect(found.sources?.length).toBeGreaterThan(0); }
    }
    const empty = getStateYearRules('', 2026);
    if (!isSupportedStateYear(empty)) expect(empty.reason).toMatch(/No state is saved/);
    const unknown = getStateYearRules('Narnia', 2026);
    if (!isSupportedStateYear(unknown)) expect(unknown.reason).toMatch(/not a recognized U\.S\. state/);
  });

  it('resolves saved codes and full names without truncating names to their first two letters', () => {
    expect(resolveStateCode('New York')).toBe('NY');
    expect(resolveStateCode('Nebraska')).toBe('NE');
    expect(resolveStateCode(' north  carolina ')).toBe('NC');
    expect(resolveStateCode('tx')).toBe('TX');
    expect(resolveStateCode('District of Columbia')).toBe('DC');
    expect(resolveStateCode('XX')).toBe('');
    expect(resolveStateCode(42)).toBe('');
    expect(resolveStateCode('')).toBe('');
  });

  it.each(NO_TAX)('%s has no individual income tax for both registry years', state => {
    for (const year of STATE_REGISTRY_TAX_YEARS) {
      const found = rules<{ kind: string; notes: string[] }>(state, year);
      expect(found.kind).toBe('no_income_tax');
      expect(found.notes.length).toBeGreaterThan(0);
    }
  });

  it('encodes the flat rates and standard deductions by year from the department pages', () => {
    const flat = (state: string, year: number) => rules<FlatRateRules>(state, year);
    expect(flat('IL', 2025).rate).toBe(0.0495); expect(flat('IL', 2026).rate).toBe(0.0495);
    expect(flat('IL', 2025).exemptionAllowance?.amount).toBe(2850); expect(flat('IL', 2026).exemptionAllowance?.amount).toBe(2925);
    expect(flat('IL', 2025).standardDeduction).toBeUndefined();
    expect(flat('PA', 2025).rate).toBe(0.0307); expect(flat('PA', 2026).rate).toBe(0.0307);
    expect(flat('PA', 2026).incomeBase).toBe('pa_income_classes'); expect(flat('PA', 2026).standardDeduction).toBeUndefined();
    expect(flat('GA', 2025).rate).toBe(0.0519); expect(flat('GA', 2026).rate).toBe(0.0499);
    expect(flat('GA', 2025).standardDeduction).toMatchObject({ single: 12000, married_filing_jointly: 24000, married_filing_separately: 12000, head_of_household: 12000 });
    expect(flat('GA', 2026).standardDeduction).toMatchObject({ single: 15000, married_filing_jointly: 30000, married_filing_separately: 15000, head_of_household: 15000 });
    expect(flat('GA', 2025).dependentExemption).toBe(4000); expect(flat('GA', 2026).dependentExemption).toBeUndefined();
    // The 2025 IT-511 booklet lives under /document/document/; the older /document/booklet/ path is a 404.
    expect(flat('GA', 2025).sources.map(source => source.url)).toContain('https://dor.georgia.gov/document/document/2025-it-511-individual-income-tax-booklet/download');
    expect(flat('GA', 2026).sources.map(source => source.url)).toContain('https://dor.georgia.gov/document/document/2025-it-511-individual-income-tax-booklet/download');
    expect(flat('NC', 2025).rate).toBe(0.0425); expect(flat('NC', 2026).rate).toBe(0.0399);
    for (const year of STATE_REGISTRY_TAX_YEARS) expect(flat('NC', year).standardDeduction).toMatchObject({ single: 12750, married_filing_jointly: 25500, married_filing_separately: 12750, head_of_household: 19125 });
  });

  it('transcribes the 2025 California schedules with continuous printed bases and the Form 540 fixed amounts', () => {
    const ca = rules<CaliforniaRules>('CA', 2025);
    expect(edges(ca.schedules.single)).toEqual([11079, 26264, 41452, 57542, 72724, 371479, 445771, 742953]);
    expect(edges(ca.schedules.married_filing_jointly)).toEqual([22158, 52528, 82904, 115084, 145448, 742958, 891542, 1485906]);
    expect(edges(ca.schedules.head_of_household)).toEqual([22173, 52530, 67716, 83805, 98990, 505208, 606251, 1010417]);
    expect(ca.schedules.married_filing_separately).toBe(ca.schedules.single);
    for (const schedule of Object.values(ca.schedules)) {
      for (let i = 1; i < schedule.length; i++) {
        const previous = schedule[i - 1];
        expect(schedule[i].base).toBeCloseTo(previous.base + previous.rate * (schedule[i].over - previous.over), 2);
      }
      expect(schedule.map(segment => segment.rate)).toEqual([0.01, 0.02, 0.04, 0.06, 0.08, 0.093, 0.103, 0.113, 0.123]);
    }
    expect(scheduleTax(ca.schedules.single, 11079)).toBeCloseTo(110.79, 2);
    expect(scheduleTax(ca.schedules.single, 26264)).toBeCloseTo(414.49, 2);
    expect(scheduleTax(ca.schedules.married_filing_jointly, 145448)).toBeCloseTo(6403.94, 2);
    expect(ca.standardDeduction).toEqual({ single: 5706, married_filing_separately: 5706, married_filing_jointly: 11412, head_of_household: 11412 });
    expect(ca.personalExemptionCredit).toBe(153); expect(ca.dependentExemptionCredit).toBe(475);
    expect(ca.behavioralHealthServicesTax).toEqual({ threshold: 1000000, rate: 0.01 });
  });

  it('transcribes the New York schedules for both years with dollar-rounded printed bases', () => {
    for (const year of STATE_REGISTRY_TAX_YEARS) {
      const ny = rules<NewYorkRules>('NY', year);
      expect(edges(ny.schedules.single)).toEqual([...NEW_YORK_BRACKET_EDGES.single]);
      expect(edges(ny.schedules.married_filing_jointly)).toEqual([...NEW_YORK_BRACKET_EDGES.joint]);
      expect(edges(ny.schedules.head_of_household)).toEqual([...NEW_YORK_BRACKET_EDGES.head]);
      expect(edges(ny.schedules.single)).toEqual([8500, 11700, 13900, 80650, 215400, 1077550, 5000000, 25000000]);
      expect(edges(ny.schedules.married_filing_jointly)).toEqual([17150, 23600, 27900, 161550, 323200, 2155350, 5000000, 25000000]);
      for (const schedule of Object.values(ny.schedules)) {
        for (let i = 1; i < schedule.length; i++) {
          const previous = schedule[i - 1];
          expect(Math.abs(schedule[i].base - (previous.base + previous.rate * (schedule[i].over - previous.over)))).toBeLessThanOrEqual(1);
        }
      }
      expect(ny.standardDeduction).toEqual({ single: 8000, married_filing_jointly: 16050, married_filing_separately: 8000, head_of_household: 11200 });
      expect(ny.dependentExemption).toBe(1000);
      expect(ny.recaptureAgiThreshold).toBe(107650); expect(ny.phaseInWidth).toBe(50000);
    }
    expect(rules<NewYorkRules>('NY', 2025).schedules.single[0].rate).toBe(0.04);
    expect(rules<NewYorkRules>('NY', 2026).schedules.single[0].rate).toBe(0.039);
    expect(rules<NewYorkRules>('NY', 2026).schedules.single[4].rate).toBe(0.059);
    expect(rules<NewYorkRules>('NY', 2026).recapture.single.flatRate).toBe(0.059);
  });

  it('transcribes the 2025 Ohio nonbusiness schedule as printed and the business income deduction limits', () => {
    const oh = rules<OhioRules>('OH', 2025);
    expect(edges(oh.nonbusinessSchedule)).toEqual([26050, 100000]);
    expect(oh.nonbusinessSchedule.map(segment => [segment.base, segment.rate])).toEqual([[0, 0], [342, 0.0275], [2394.32, 0.03125]]);
    expect(scheduleTax(oh.nonbusinessSchedule, 26050)).toBe(0);
    expect(scheduleTax(oh.nonbusinessSchedule, 50000)).toBeCloseTo(342 + 0.0275 * (50000 - 26050), 2);
    expect(scheduleTax(oh.nonbusinessSchedule, 150000)).toBeCloseTo(2394.32 + 0.03125 * 50000, 2);
    expect(oh.businessIncomeDeduction).toEqual({ limit: 250000, limitMarriedSeparate: 125000, rateOnExcess: 0.03 });
    expect(oh.exemptionByMAGI).toEqual([{ agiUpTo: 40000, amount: 2400 }, { agiUpTo: 80000, amount: 2150 }, { agiUpTo: 749999, amount: 1900 }]);
  });
});
