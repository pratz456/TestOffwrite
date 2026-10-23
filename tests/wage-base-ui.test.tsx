import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useState(initial: unknown) {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = initial;
      return [state.slots[index], (value: unknown) => { state.slots[index] = typeof value === 'function' ? (value as (prev: unknown) => unknown)(state.slots[index]) : value; }];
    },
    useMemo: (compute: () => unknown) => compute(),
    useEffect() {},
    useRef: (initial: unknown) => ({ current: initial }),
    useCallback: (fn: unknown) => fn,
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: vi.fn(async () => ({ ok: false })) }));
vi.mock('@/components/landing/landing-header', () => ({ LandingHeader: 'LandingHeader' }));

import { SETaxCalculatorClient } from '@/app/tools/se-tax-calculator/se-tax-calculator-client';
import { TaxCalculator1099Client } from '@/app/tools/1099-tax-calculator/1099-tax-calculator-client';
import { DocumentImportScreen } from '@/components/document-import-screen';
import { socialSecurityWageBase } from '@/lib/tax-rules/public-calculators';

function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return Object.values((node as { props?: Record<string, unknown> }).props ?? {}).map(text).join('');
  }
  return '';
}
function render(component: () => unknown) {
  state.cursor = 0;
  return component();
}
beforeEach(() => { state.slots = []; state.cursor = 0; });

const rounded = (base: number) => Math.round(base * 0.062).toLocaleString();

function w2Screen(taxYear: number, box4: number) {
  state.slots = [];
  state.slots[0] = String(taxYear);
  state.slots[2] = { name: 'w2.pdf' };
  state.slots[6] = { docType: 'w2', summary: 'W-2', extracted: { confidence: 1 }, disclosure: 'text', identifiersRedacted: 0 };
  state.slots[7] = { employerName: 'Synthetic employer', box3SocialSecurityWages: 200000, box4SocialSecurityWithheld: box4, taxYear };
  return text(render(() => DocumentImportScreen({ user: { id: 'owner' }, onBack() {} })));
}

describe('Social Security wage base readers', () => {
  it('returns the published base for 2025, 2026 and 2027 and nothing for an unknown year', () => {
    expect(socialSecurityWageBase(2025)).toBe(176100);
    expect(socialSecurityWageBase(2026)).toBe(184500);
    expect(socialSecurityWageBase(2027)).toBe(192300);
    expect(socialSecurityWageBase(2030)).toBeNull();
  });
});

describe('W-2 Box 4 check uses the wage base for that year', () => {
  it.each([
    [2025, 176100],
    [2026, 184500],
    [2027, 192300],
  ] as const)('%i with Box 3 of 200000 expects 6.2 percent of %i', (year, base) => {
    expect(base * 0.062).toBeCloseTo(socialSecurityWageBase(year)! * 0.062, 8);
    const shown = w2Screen(year, 1);
    expect(shown).toContain('expected SS withholding');
    expect(shown).toContain(rounded(base));
    expect(w2Screen(year, base * 0.062)).not.toContain('expected SS withholding');
  });

  it('skips the check when the year has no wage base', () => {
    expect(w2Screen(2030, 1)).not.toContain('expected SS withholding');
    expect(w2Screen(2030, 0)).not.toContain('expected SS withholding');
  });
});

describe('self employment calculator wage base note', () => {
  it('shows the announced 2027 wage base instead of the pending sentence', () => {
    const content = text(render(SETaxCalculatorClient));
    expect(content).toContain('The 2027 wage base is $192,300.');
    expect(content).not.toContain('has not been announced');
  });

  it('keeps the 2027 federal estimate unavailable while brackets and the standard deduction are unpublished', () => {
    const content = text(render(TaxCalculator1099Client));
    expect(content).toContain('A 2027 federal estimate is unavailable');
  });
});
