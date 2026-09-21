import { describe, expect, it } from 'vitest';
import { PersonalDeductionFields } from '../components/personal-deduction-fields';
import { calculateEnhancedSeniorDeduction, calculateStandardDeduction } from '../lib/tax-rules/personal-deductions';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
type Node = { type?: unknown; props?: { children?: unknown; [key: string]: unknown } };
const walk = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node as Node, ...walk((node as Node).props?.children)] : [];
const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text((node as Node).props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
function fixture(taxYear = 2026, filingStatus = 'single', initial: Record<string, unknown> = {}) {
  const answers: { personalDeductionFacts?: string; dateOfBirth?: string; spouseDoB?: string } = { ...initial };
  const render = () => PersonalDeductionFields({ taxYear, filingStatus, answers, onChange: (field, value) => { answers[field] = value; } });
  const change = (label: string, value: string) => {
    const target = walk(render()).find(node => node.props?.['aria-label'] === label);
    expect(target, `Missing field ${label}`).toBeDefined();
    (target!.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
  };
  return { answers, render, change };
}

describe('personal-deduction fields save the server facts contract', () => {
  it('starts unanswered and persists explicit version/year instead of default eligibility', () => {
    const form = fixture();
    expect(walk(form.render()).filter(node => node.type === 'select').every(node => node.props?.value === '')).toBe(true);
    form.change('Do the ordinary full-year deduction rules apply?', 'yes');
    expect(JSON.parse(form.answers.personalDeductionFacts!)).toEqual({ version: 1, taxYear: 2026, ordinaryScope: 'yes' });
    expect(() => calculateStandardDeduction({ taxYear: 2026, filingStatus: 'single', organizer: form.answers })).toThrow('date of birth');
  });
  it('does not transfer old-year confirmations when editing a new selected year', () => {
    const form = fixture(2026, 'single', reviewedPersonalDeductionOrganizer(2025));
    expect(text(form.render())).toContain('another tax year');
    form.change('Do the ordinary full-year deduction rules apply?', 'yes');
    expect(JSON.parse(form.answers.personalDeductionFacts!)).toEqual({ version: 1, taxYear: 2026, ordinaryScope: 'yes' });
  });
  it('actual input handlers produce the IRS blind-dependent5350 example', () => {
    const form = fixture(2025);
    form.change('Do the ordinary full-year deduction rules apply?', 'yes');
    form.change('Your date of birth for deduction eligibility', '2007-01-01');
    form.change('Do you meet the IRS blindness definition?', 'yes');
    form.change('Can another taxpayer claim you as a dependent?', 'yes');
    form.change('Earned income for the dependent deduction worksheet', '2900');
    expect(calculateStandardDeduction({ taxYear: 2025, filingStatus: 'single', organizer: form.answers }).standardDeduction).toBe(5350);
  });
  it('collects spouse facts for a joint return and conditionally for an eligible separate spouse', () => {
    const joint = fixture(2026, 'Married Filing Jointly');
    expect(text(joint.render())).toContain('Can another taxpayer claim your spouse');
    const separate = fixture(2026, 'married_filing_separately');
    expect(text(separate.render())).not.toContain('Spouse date of birth for deduction eligibility');
    separate.change('Can your spouse’s age or blindness count on your separate return?', 'yes');
    expect(text(separate.render())).toContain('Spouse date of birth for deduction eligibility');
    separate.change('Does your spouse itemize deductions on a separate return?', 'yes');
    expect(text(separate.render())).toContain('standard deduction is zero');
  });
  it('shows the senior SSN question for January1 qualification and computes after explicit confirmation', () => {
    const form = fixture(2026, 'single', reviewedPersonalDeductionOrganizer(2026, { taxpayerSeniorSSN: '', seniorHasAddbacks: '' }, { dateOfBirth: '1962-01-01' }));
    expect(text(form.render())).toContain('eligible SSN');
    expect(() => calculateEnhancedSeniorDeduction({ taxYear: 2026, filingStatus: 'single', agi: 75000, organizer: form.answers })).toThrow('SSN');
    form.change('Do you have an eligible SSN for the senior deduction?', 'yes');
    form.change('Do foreign or territory amounts need to be added back for senior MAGI?', 'no');
    expect(calculateEnhancedSeniorDeduction({ taxYear: 2026, filingStatus: 'single', agi: 75000, organizer: form.answers }).deduction).toBe(6000);
    form.change('Your date of birth for deduction eligibility', '1962-01-02');
    expect(text(form.render())).not.toContain('Do you have an eligible SSN');
  });
  it('keeps saved addbacks visible on Yes and review-blocks contradicting No rather than losing amounts', () => {
    const form = fixture(2026, 'single', reviewedPersonalDeductionOrganizer(2026, {}, { dateOfBirth: '1950-01-01' }));
    form.change('Do foreign or territory amounts need to be added back for senior MAGI?', 'yes');
    for (const label of ['Excluded Puerto Rico income', 'Form 2555 line 45', 'Form 2555 line 50', 'Form 4563 line 15']) form.change(label, label === 'Form 2555 line 45' ? '20000' : '0');
    expect(calculateEnhancedSeniorDeduction({ taxYear: 2026, filingStatus: 'single', agi: 75000, organizer: form.answers }).deduction).toBe(4800);
    form.change('Do foreign or territory amounts need to be added back for senior MAGI?', 'no');
    expect(() => calculateEnhancedSeniorDeduction({ taxYear: 2026, filingStatus: 'single', agi: 75000, organizer: form.answers })).toThrow('reconcile');
  });
});
