import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { SocialSecurityFields, EMPTY_SOCIAL_SECURITY_ANSWERS, type SocialSecurityAnswers } from '../components/tax-organizer-social-security';
type Element = ReactElement<Record<string, unknown>>;
const walk = (node: unknown): Element[] => Array.isArray(node) ? node.flatMap(walk)
  : node && typeof node === 'object' && 'props' in node ? [node as Element, ...walk((node as Element).props.children)] : [];
const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join(' ')
  : node && typeof node === 'object' && 'props' in node ? text((node as Element).props.children) : typeof node === 'string' ? node : '';
describe('persistable Social Security organizer fields', () => {
  it('emits every amount as a distinct persisted field and never overwrites legacy Box3', () => {
    const answers = { ...EMPTY_SOCIAL_SECURITY_ANSWERS }; const updates: Record<string, string> = {};
    const tree = SocialSecurityFields({ answers, filingStatus: 'single', set: (field, value) => { updates[field] = value; } });
    walk(tree).filter(node => node.props.type === 'number').forEach((node, i) => {
      (node.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: String(i + 100) } });
    });
    expect(updates).toEqual({ socialSecurityNetBenefits: '100', socialSecurityFederalWithheld: '101', socialSecurityTaxExemptInterest: '102', socialSecurityExcludedSavingsBondInterest: '103', socialSecurityAdoptionExclusion: '104' });
    expect(updates).not.toHaveProperty('amountSocialSecurity');
  });
  it('shows the MFS living question only for separate filers, with no assumed answer', () => {
    const separate = SocialSecurityFields({ answers: { ...EMPTY_SOCIAL_SECURITY_ANSWERS }, filingStatus: 'married_filing_separately', set: vi.fn() });
    expect(text(separate)).toContain('live apart');
    expect(walk(separate).filter(node => 'aria-pressed' in node.props).every(node => node.props['aria-pressed'] === false)).toBe(true);
    const single = SocialSecurityFields({ answers: { ...EMPTY_SOCIAL_SECURITY_ANSWERS }, filingStatus: 'single', set: vi.fn() });
    expect(text(single)).not.toContain('live apart');
  });
  it('shows explicit taxable retirement review when retirement income is present', () => {
    const tree = SocialSecurityFields({ answers: { ...EMPTY_SOCIAL_SECURITY_ANSWERS }, filingStatus: 'single', hasRetirementIncome: true, set: vi.fn() });
    expect(text(tree)).toContain('reviewed taxable Box2a'); expect(text(tree)).toContain('early-distribution tax');
  });
  it('records explicit eligible and unsupported answers through the real controls', () => {
    const answers: SocialSecurityAnswers = { ...EMPTY_SOCIAL_SECURITY_ANSWERS };
    const set = (field: keyof SocialSecurityAnswers, value: string) => { answers[field] = value; };
    const tree = SocialSecurityFields({ answers, filingStatus: 'single', set });
    const priorYear = walk(tree).find(node => node.type === 'fieldset' && text(node).includes('earlier tax year'))!;
    const yes = walk(priorYear).find(node => node.props.onClick && text(node) === 'Yes')!;
    (yes.props.onClick as () => void)();
    expect(answers.socialSecurityLumpSum).toBe('yes');
    expect(answers.socialSecurityIncomeComplete).toBe('');
    expect(walk(tree).some(node => node.props.href === '/protected?screen=deductions-entry')).toBe(true);
  });
});
