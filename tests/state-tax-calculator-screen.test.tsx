import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useState(initial: unknown) {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [state.slots[index], (value: unknown) => { state.slots[index] = value; }];
    },
    useMemo: (compute: () => unknown) => compute(),
    useEffect: () => {},
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});

import { StateTaxCalculatorScreen } from '@/components/state-tax-calculator-screen';

function walk(node: any): any[] { return Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : []; }
function text(node: any): string { return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
/** AmountField is a local function component, so its Label is not in the screen element until it is called. */
function fields(node: any): any[] {
  return walk(node).flatMap(item => (
    typeof item.type === 'function' && typeof item.props?.id === 'string' && typeof item.props?.label === 'string'
      ? [item, ...walk(item.type(item.props))]
      : []
  ));
}

beforeEach(() => { state.slots = []; state.cursor = 0; });

describe('state tax calculator screen labels', () => {
  it('asks for the taxpayer’s own W-2 Social Security wages and keeps Box 1 wages separate', () => {
    const tree = StateTaxCalculatorScreen({ user: { id: 'preview' }, onBack: () => {} });
    const rendered = fields(tree);
    const label = (id: string) => text(rendered.find(node => node.props?.htmlFor === id));
    const field = (id: string) => rendered.find(node => node.props?.id === id && typeof node.props?.label === 'string');
    expect(label('own-ss-wages')).toBe('Your own W-2 Social Security wages (box 3)');
    expect(field('own-ss-wages').props.hint).toBeUndefined();
    expect(label('wages')).toBe('W-2 wages ($)');
    expect(field('wages').props.hint).toBe('Box 1');
    expect(text(field('wages').type(field('wages').props))).toContain('Box 1');
  });
});
