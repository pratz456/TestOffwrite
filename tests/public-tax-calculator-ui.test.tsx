import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useState(initial: unknown) {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = initial;
      return [state.slots[index], (value: unknown) => { state.slots[index] = value; }];
    },
    useMemo: (compute: () => unknown) => compute(),
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/components/landing/landing-header', () => ({ LandingHeader: 'LandingHeader' }));
import { TaxCalculator1099Client } from '@/app/tools/1099-tax-calculator/1099-tax-calculator-client';
import { SETaxCalculatorClient } from '@/app/tools/se-tax-calculator/se-tax-calculator-client';

function walk(node: any): any[] { return Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : []; }
function text(node: any): string { return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function render(component: () => any) { state.cursor = 0; return component(); }
function fill(component: () => any, id: string, value: string) {
  walk(render(component)).find(node => node.props?.id === id)!.props.onChange({ target: { value } });
}
beforeEach(() => { state.slots = []; state.cursor = 0; });

describe('public tax calculator review boundaries', () => {
  it.each([['1099', TaxCalculator1099Client, 'gross-income'], ['SE', SETaxCalculatorClient, 'net-profit']] as const)
  ('withholds totals until joint wage ownership is established in %s', (_name, component, incomeId) => {
    fill(component, incomeId, '75000'); fill(component, 'filing-status', 'married_filing_jointly'); fill(component, 'w2-wages', '40000');
    const tree = render(component), alert = walk(tree).find(node => node.props?.role === 'alert');
    expect(text(alert)).toContain('spouse who earned them');
    expect(text(alert)).toContain('separate Social Security wage base');
    expect(text(alert)).toContain('estimate is withheld');
    expect(text(tree)).not.toContain('Estimated Total Federal Tax');
    expect(text(tree)).not.toContain('Total Self-Employment Tax');
  });

  it('shows real zero SE tax when positive profit is below the filing threshold', () => {
    fill(SETaxCalculatorClient, 'net-profit', '350');
    const content = text(render(SETaxCalculatorClient));
    expect(content).toContain('Total Self-Employment Tax$0.00');
    expect(content).not.toContain('NaN');
  });

  it.each([['1099', TaxCalculator1099Client, 'gross-income'], ['SE', SETaxCalculatorClient, 'net-profit']] as const)
  ('does not calculate from a partially parsed malformed amount in %s', (_name, component, incomeId) => {
    fill(component, incomeId, '100junk');
    expect(text(walk(render(component)).find(node => node.props?.role === 'alert'))).toContain('valid nonnegative');
  });

  it('shows the above-threshold QBI review instead of an invented deduction or tax total', () => {
    fill(TaxCalculator1099Client, 'gross-income', '500000');
    const tree = render(TaxCalculator1099Client), alert = walk(tree).find(node => node.props?.role === 'alert');
    expect(text(alert)).toContain('QBI'); expect(text(tree)).not.toContain('Estimated Total Federal Tax');
  });
});
