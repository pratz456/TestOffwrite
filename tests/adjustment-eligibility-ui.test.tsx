import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AdjustmentEligibilityFields } from '@/components/adjustment-eligibility-fields';
import { eligibilityOrganizer, hsaFacts, healthFacts } from './fixtures/eligibility';
type Element = ReactElement<Record<string, unknown>>;
function walk(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (node && typeof node === 'object' && 'props' in node) { const element = node as Element; return [element, ...walk(element.props.children)]; }
  return [];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join(' ').replace(/\s+/g, ' ');
  if (node && typeof node === 'object' && 'props' in node) return text((node as Element).props.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
function render(overrides: Partial<Parameters<typeof AdjustmentEligibilityFields>[0]> = {}) {
  const onChange = vi.fn();
  const tree = AdjustmentEligibilityFields({ taxYear: 2026, filingStatus: 'single', value: '', showHsa: true, onChange, ...overrides });
  return { nodes: walk(tree), onChange, content: text(tree) };
}
function click(nodes: Element[], label: string) {
  const button = nodes.find(node => node.type === 'button' && text(node).trim() === label)!;
  (button.props.onClick as () => void)();
}
describe('guided saved deduction eligibility', () => {
  it('starts eligibility unanswered and keeps monthly details collapsed', () => {
    const { nodes, content } = render();
    expect(nodes.filter(node => node.type === 'select').every(node => node.props.value === '')).toBe(true);
    expect(nodes.filter(node => node.type === 'details').every(node => !node.props.open)).toBe(true);
    expect(content).toContain('Payroll salary reductions and W-2 code W');
    expect(content).toContain('retroactive enrollment');
  });
  it('a coverage shortcut never infers Medicare eligibility or other HSA confirmations', () => {
    const { nodes, onChange } = render();
    click(nodes, 'Self-only all year');
    const saved = JSON.parse(onChange.mock.calls[0][0]);
    expect(saved).toMatchObject({ version: 1, taxYear: 2026 });
    expect(saved.hsa.months).toHaveLength(12);
    expect(saved.hsa.months.every((month: { coverage: string; medicare: string }) => month.coverage === 'self' && month.medicare === '')).toBe(true);
    expect(saved.hsa).not.toHaveProperty('notDependent');
  });
  it('changes one section while preserving saved facts in the other section', () => {
    const value = eligibilityOrganizer({ health: healthFacts(), hsa: hsaFacts({ age55: 'no' }) }).adjustmentEligibilityFacts;
    const { nodes, onChange } = render({ value });
    const field = nodes.find(node => node.props['aria-label'] === 'Holder was age 55 or older at year end')!;
    (field.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'yes' } });
    expect(JSON.parse(onChange.mock.calls[0][0])).toMatchObject({ health: healthFacts(), hsa: { age55: 'yes' } });
  });
  it('spreads annual premium cents without filling employer-access answers', () => {
    const { nodes, onChange } = render({ showHsa: false, showHealth: true, annualPremium: '1000' });
    click(nodes, 'Premiums were equal monthly');
    const months = JSON.parse(onChange.mock.calls[0][0]).health.months as { premiums: string; employerAccess: string }[];
    expect(months.reduce((sum, month) => sum + Math.round(Number(month.premiums) * 100), 0)).toBe(100000);
    expect(months.every(month => month.employerAccess === '')).toBe(true);
  });
  it('discards stale-year answers on a new edit and displays an explicit warning', () => {
    const { nodes, onChange, content } = render({ value: eligibilityOrganizer({ taxYear: 2025, hsa: hsaFacts() }).adjustmentEligibilityFacts });
    expect(content).toContain('Saved eligibility needs review for 2026');
    click(nodes, 'No Medicare all year');
    const saved = JSON.parse(onChange.mock.calls[0][0]);
    expect(saved.taxYear).toBe(2026);
    expect(saved.hsa.months.every((month: { coverage: string; medicare: string }) => month.medicare === 'no' && month.coverage === '')).toBe(true);
    expect(saved.hsa).not.toHaveProperty('age55');
  });
  it('collects each spouse’s box totals and flags the one-self-employed-spouse boundary', () => {
    const { nodes, content } = render({ showHsa: false, showJoint: true, filingStatus: 'married_filing_jointly' });
    expect(nodes.filter(node => node.type === 'input' && node.props.type === 'number')).toHaveLength(6);
    expect(content).toContain('Exactly one spouse earned all recorded business income');
    expect(content).toContain('Spouse W-2 Boxes 3 + 7');
    expect(nodes.filter(node => node.type === 'select').every(node => node.props.value === '')).toBe(true);
  });
});
