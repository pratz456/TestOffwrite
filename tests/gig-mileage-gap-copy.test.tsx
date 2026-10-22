import { readFileSync } from 'node:fs';
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
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/components/landing/landing-header', () => ({ LandingHeader: 'LandingHeader' }));
vi.mock('next/link', () => ({ default: 'a' }));

import { GigMileageGapCalculatorClient } from '@/app/tools/gig-mileage-gap-calculator/gig-mileage-gap-calculator-client';
import { GIG_MILEAGE_GAP_COPY, SHOW_DEDUCTION_ESTIMATE, listGigMileageGapCopy } from '@/lib/tools/gig-mileage-gap-copy';

const BANNED = ['owed', 'refund', 'savings', 'money back', 'audit-proof', 'irs-approved'];

function walk(node: any): any[] {
  return Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
}
function text(node: any): string {
  return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
function render() {
  state.cursor = 0;
  return GigMileageGapCalculatorClient();
}
function fill(id: string, value: string) {
  walk(render()).find(node => node.props?.id === id).props.onChange({ target: { value } });
}
function renderedText(): string {
  return text(render());
}

beforeEach(() => { state.slots = []; state.cursor = 0; });

function expectClean(value: string) {
  const lower = value.toLowerCase();
  for (const phrase of BANNED) expect(lower).not.toContain(phrase);
}

describe('gig mileage gap copy', () => {
  it('keeps the deduction estimate off and stores every visible sentence in one constants file', () => {
    expect(SHOW_DEDUCTION_ESTIMATE).toBe(false);
    expect(GIG_MILEAGE_GAP_COPY.milesToReviewLabel).toBe('miles to review against your log');
    expect(GIG_MILEAGE_GAP_COPY.waitingNotice).toBe("The IRS hasn't ruled on this");
    expect(GIG_MILEAGE_GAP_COPY.notTaxAdvice).toBe('General information, not tax advice.');
    expect(GIG_MILEAGE_GAP_COPY.homeOfficeLabel).toBe('I have a qualifying home office');
    expect(GIG_MILEAGE_GAP_COPY.ratePending).toBe('Rate pending');
    expect(GIG_MILEAGE_GAP_COPY.logNotice).toContain('IRC section 274(d)');
    expect(GIG_MILEAGE_GAP_COPY.logNotice).toContain('Treas. Reg. 1.274-5T(c)(2)(ii)(A)');
    for (const sentence of listGigMileageGapCopy()) expectClean(sentence);
  });

  it('renders miles only, with no dollar sign and no mileage rate', () => {
    fill('start-date', '2026-06-30');
    fill('end-date', '2026-07-01');
    fill('on-trip', '40');
    fill('to-pickup', '10');
    fill('commute', '6');
    fill('waiting', '4');
    fill('odometer', '70');
    const page = renderedText();
    expectClean(page);
    expect(page).toContain('miles to review against your log');
    expect(page).toContain('50 miles');
    expect(page).toContain("The IRS hasn't ruled on this");
    expect(page).toContain('Rev. Rul. 99-7');
    expect(page).toContain('Shown separately and not counted');
    expect(page).toContain('General information, not tax advice.');
    expect(page).toContain('IRC section 274(d)');
    expect(page).toContain('Treas. Reg. 1.274-5T(c)(2)(ii)(A)');
    expect(page).not.toContain('$');
    expect(page.toLowerCase()).not.toContain('cents per mile');
    expect(page).not.toContain('Rate pending');
    expect(page.toLowerCase()).not.toMatch(/mileage rate/);
    expect(walk(render()).some(node => node.props?.href === '/auth/sign-up')).toBe(true);
    expect(walk(render()).some(node => node.props?.id === 'home-office')).toBe(false);
    expect((page.match(/<h1>|Gig Mileage Gap Calculator/g) ?? []).length).toBeGreaterThan(0);
    const headings = walk(render()).filter(node => node.type === 'h1');
    expect(headings).toHaveLength(1);
  });

  it('does not render a rate for a 2027 range', () => {
    fill('start-date', '2027-01-01');
    fill('end-date', '2027-01-31');
    fill('on-trip', '12');
    fill('to-pickup', '3');
    fill('commute', '2');
    fill('waiting', '1');
    fill('odometer', '20');
    const page = renderedText();
    expect(page).toContain('15 miles');
    expect(page).not.toContain('$');
    expect(page).not.toContain('Rate pending');
    expect(page.toLowerCase()).not.toContain('cents per mile');
    expectClean(page);
  });

  it('does not fetch, store entries, or send an analytics event from the page', () => {
    const client = readFileSync(new URL('../app/tools/gig-mileage-gap-calculator/gig-mileage-gap-calculator-client.tsx', import.meta.url), 'utf8');
    const math = readFileSync(new URL('../lib/tools/gig-mileage-gap.ts', import.meta.url), 'utf8');
    for (const source of [client, math]) {
      expect(source).not.toMatch(/new Date\(\s*['"`]/);
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|gtag|sendBeacon/);
    }
    const sitemap = readFileSync(new URL('../app/sitemap.ts', import.meta.url), 'utf8');
    expect(sitemap).toContain('GIG_MILEAGE_GAP_COPY.canonicalPath');
    expect(GIG_MILEAGE_GAP_COPY.canonicalPath).toBe('/tools/gig-mileage-gap-calculator');
  });
});
