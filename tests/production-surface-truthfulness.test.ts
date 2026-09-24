import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { taxCalendarEventsForYear } from '@/components/tax-calendar-screen';
import { calculateEITC, calculateSEPIRAMax } from '@/lib/tax-rules/credits';
import { getFederalTaxRules, LATEST_PUBLISHED_TAX_YEAR } from '@/lib/tax-rules/federal-year-rules';

const source = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

describe('production financial surfaces use saved data rather than demos', () => {
  it('routes the legacy Profit & Loss screen to the saved-data report', () => {
    const code = source('app/protected/page.tsx');
    expect(code).not.toContain('ProfitLossDetailScreen');
    expect(code).toContain("currentScreen === 'profit-loss-report' || currentScreen === 'profit-loss-detail'");
    expect(code).toContain('<ProfitLossReportScreen');
  });

  it('does not return fabricated category totals or claim a no-op category update succeeded', () => {
    const code = source('app/api/categories/route.ts');
    expect(code).not.toContain('sampleCategories');
    expect(code).not.toContain('Category updated successfully');
    expect(code).toContain('CATEGORY_OVERRIDE_UNAVAILABLE');
    expect(code).toContain('getTransactionsServer');
  });

  it('derives calendar deadlines from the shared federal deadline helpers', () => {
    const events = taxCalendarEventsForYear(2026);
    expect(events.map(event => [event.id, event.date])).toEqual(expect.arrayContaining([
      ['2025-q4', '2026-01-15'],
      ['2025-return', '2026-04-15'],
      ['2026-q1', '2026-04-15'],
      ['2026-q2', '2026-06-15'],
      ['2026-q3', '2026-09-15'],
    ]));
    expect(events.every(event => event.date.startsWith('2026-'))).toBe(true);
  });
});

describe('omitted tax-year parameters use the latest complete published registry', () => {
  it('uses the current published EITC and SEP limits instead of a stale 2025 default', () => {
    const rules = getFederalTaxRules(LATEST_PUBLISHED_TAX_YEAR);
    const eitc = calculateEITC({
      taxYear: LATEST_PUBLISHED_TAX_YEAR,
      earnedIncome: 20_000,
      agi: 20_000,
      filingStatus: 'single',
      numDependents: 0,
      numEITCChildren: 1,
      taxableIncome: 0,
    });
    expect(eitc.amount).toBe(rules.eitc[1].maxCredit);
    expect(calculateSEPIRAMax(1_000_000, LATEST_PUBLISHED_TAX_YEAR, 0)).toBe(rules.sepContributionLimit);
  });
});
