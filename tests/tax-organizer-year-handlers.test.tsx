import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn() }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useState(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [harness.slots[index], (next: unknown) => { harness.slots[index] = typeof next === 'function' ? next(harness.slots[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = { current: initial };
      return harness.slots[index];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = harness.cursor++, previous = harness.slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) harness.slots[index] = { deps, callback };
      return harness.slots[index].callback;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = harness.cursor++, previous = harness.slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        const next: any = { deps }; harness.slots[index] = next;
        harness.effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
      }
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
import { TaxOrganizerScreen, EMPTY_ORGANIZER_ANSWERS } from '../components/tax-organizer-screen';
import { PersonalDeductionFields } from '../components/personal-deduction-fields';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
type Element = ReactElement<Record<string, any>>;
const walk = (node: any): Element[] => Array.isArray(node) ? node.flatMap(walk)
  : node && typeof node === 'object' && 'props' in node ? [node, ...walk(node.props.children)] : [];
const text = (node: any): string => Array.isArray(node) ? node.map(text).join(' ')
  : node && typeof node === 'object' && 'props' in node ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
function render(uid = 'organizer-owner') {
  harness.cursor = 0;
  const tree = TaxOrganizerScreen({ user: { id: uid }, onBack() {} }) as Element;
  harness.effects.splice(0).forEach(effect => effect());
  return tree;
}
const button = (tree: Element, label: string) => walk(tree).find(node => node.props.onClick && text(node).trim() === label)!;
const yearSelect = (tree: Element) => walk(tree).find(node => node.props['aria-label'] === 'Organizer tax year')!;
const personal = (tree: Element) => walk(tree).find(node => node.type === PersonalDeductionFields)!;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tick = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
async function load() { render(); await tick(); return render(); }
function deferred() { let resolve!: (value: Response) => void; const promise = new Promise<Response>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  harness.slots = []; harness.effects = []; harness.cursor = 0; vi.clearAllMocks();
  harness.request.mockImplementation(async (url: string, init?: RequestInit) => init?.method === 'POST'
    ? response({ success: true })
    : response({ taxYear: Number(new URL(url, 'http://local').searchParams.get('year')), organizer: null }));
});
afterEach(() => { harness.slots.forEach(slot => slot?.cleanup?.()); });

describe('organizer personal facts and safe tax-year changes', () => {
  it('mounts the controlled deduction questions, persists a reviewed field and avoids duplicate DOB inputs', async () => {
    const tree = await load(), section = personal(tree);
    const fields = PersonalDeductionFields(section.props as Parameters<typeof PersonalDeductionFields>[0]);
    expect(walk(tree).filter(node => node.props.type === 'date')).toHaveLength(0);
    expect(walk(fields).filter(node => node.props.type === 'date')).toHaveLength(1);
    const fact = reviewedPersonalDeductionOrganizer().personalDeductionFacts;
    section.props.onChange('personalDeductionFacts', fact);
    section.props.onChange('dateOfBirth', '1955-06-01');
    await button(render(), 'Save').props.onClick();
    const saved = JSON.parse(harness.request.mock.calls.find(call => call[1]?.method === 'POST')![1].body);
    expect(saved).toMatchObject({ personalDeductionFacts: fact, dateOfBirth: '1955-06-01' });
    expect(Object.keys(saved).length - 1).toBeLessThanOrEqual(80);
    expect(Object.keys(EMPTY_ORGANIZER_ANSWERS)).toHaveLength(66);
  });
  it('keeps edited facts and the old year when automatic saving fails, without loading another year', async () => {
    personal(await load()).props.onChange('dateOfBirth', '1955-06-01');
    harness.request.mockResolvedValueOnce(response({ error: 'Save unavailable; retry.' }, 503));
    const current = yearSelect(render()).props.value;
    yearSelect(render()).props.onChange({ target: { value: '2024' } }); await tick();
    const tree = render();
    expect(yearSelect(tree).props.value).toBe(current); expect(personal(tree).props.answers.dateOfBirth).toBe('1955-06-01');
    expect(text(tree)).toContain('Save unavailable; retry.');
    expect(harness.request.mock.calls.filter(call => call[0].includes('?year=2024'))).toHaveLength(0);
  });
  it('saves edits to their original year before loading the selected year and coalesces repeated switch attempts', async () => {
    personal(await load()).props.onChange('dateOfBirth', '1955-06-01');
    const pending = deferred(); harness.request.mockReturnValueOnce(pending.promise);
    const original = yearSelect(render()).props.value;
    yearSelect(render()).props.onChange({ target: { value: '2024' } });
    yearSelect(render()).props.onChange({ target: { value: '2025' } });
    expect(yearSelect(render()).props.value).toBe(original); expect(yearSelect(render()).props.disabled).toBe(true);
    expect(harness.request.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
    expect(JSON.parse(harness.request.mock.calls.at(-1)![1].body)).toMatchObject({ taxYear: original, dateOfBirth: '1955-06-01' });
    pending.resolve(response({ success: true })); await tick();
    const switched = render(); expect(yearSelect(switched).props.value).toBe(2024);
    expect(personal(switched).props.taxYear).toBe(2024); expect(personal(switched).props.answers.dateOfBirth).toBe('');
    render(); await tick(); expect(harness.request.mock.calls.filter(call => call[0].includes('?year=2024'))).toHaveLength(1);
  });
  it('retains the current answers if the other-year read fails or returns the wrong year', async () => {
    personal(await load()).props.onChange('dateOfBirth', '1955-06-01');
    harness.request.mockResolvedValueOnce(response({ success: true })).mockResolvedValueOnce(response({ taxYear: 2025, organizer: null }));
    const current = yearSelect(render()).props.value;
    yearSelect(render()).props.onChange({ target: { value: '2024' } }); await tick();
    expect(yearSelect(render()).props.value).toBe(current); expect(personal(render()).props.answers.dateOfBirth).toBe('1955-06-01');
    expect(text(render())).toContain('did not match the selected year');
  });
  it('blocks editing after a failed initial lookup and recovers through explicit retry', async () => {
    harness.request.mockResolvedValueOnce(response({ error: 'Organizer unavailable' }, 503));
    const failed = await load(); expect(personal(failed)).toBeUndefined(); expect(button(failed, 'Save')).toBeUndefined();
    expect(text(failed)).toContain('Organizer unavailable');
    button(failed, 'Retry organizer').props.onClick(); await tick();
    expect(personal(render())).toBeDefined();
  });
  it('does not advance Next when saving fails', async () => {
    await load(); harness.request.mockResolvedValueOnce(response({ error: 'Could not save' }, 503));
    await button(render(), 'Next').props.onClick();
    expect(personal(render())).toBeDefined(); expect(text(render())).toContain('Could not save');
  });
  it('ignores the old-account year response after the authenticated owner changes', async () => {
    await load(); const pending = deferred(); harness.request.mockReturnValueOnce(pending.promise);
    yearSelect(render()).props.onChange({ target: { value: '2024' } });
    render('replacement-owner'); await tick();
    pending.resolve(response({ taxYear: 2024, organizer: { dateOfBirth: '1955-06-01' } })); await tick();
    const current = render('replacement-owner');
    expect(yearSelect(current).props.value).not.toBe(2024); expect(personal(current).props.answers.dateOfBirth).toBe('');
  });
  it('presents optional handoff records without promising filing or refund timing', async () => {
    const copy = text(await load());
    expect(copy).toContain('WriteOff does not submit tax returns');
    expect(copy).toContain('actual adjusted gross income');
    expect(copy).not.toContain('10-21'); expect(copy).not.toContain('enter $0'); expect(copy).not.toContain('Form 8879');
  });
});

describe('compact organizer sections', () => {
  const sectionSelect = (tree: Element) => walk(tree).find(node => node.props['aria-label'] === 'Organizer section')!;
  const section = (tree: Element, title: string) => walk(tree).find(node => node.type === 'details' && text(node.props.children[0]).includes(title))!;
  const choose = (tree: Element, label: string, answer: string) => {
    const group = walk(tree).find(node => node.props.role === 'group' && node.props['aria-label'] === label)!;
    button(group, answer).props.onClick();
  };

  it('keeps optional records collapsed and preserves them when saving from a different section', async () => {
    harness.request.mockResolvedValueOnce(response({ taxYear: 2026, organizer: { bankRouting: '123456789', bankAccount: '987654321', taxpayerSSN: '123456789' } }));
    let tree = await load();
    expect(section(tree, 'Accountant handoff').props.open).not.toBe(true);
    expect(section(tree, 'Deduction eligibility').props.open).not.toBe(true);
    expect(text(tree)).not.toContain('sections complete');
    sectionSelect(tree).props.onChange({ target: { value: '3' } });
    choose(render(), 'Started or acquired a business', 'yes');
    sectionSelect(render()).props.onChange({ target: { value: '0' } });
    tree = render();
    expect(personal(tree).props.answers.startedBusiness).toBe('yes');
    await button(tree, 'Save').props.onClick();
    const saved = JSON.parse(harness.request.mock.calls.find(call => call[1]?.method === 'POST')![1].body);
    expect(saved).toMatchObject({ bankRouting: '123456789', bankAccount: '987654321', taxpayerSSN: '123456789', startedBusiness: 'yes' });
  });

  it('keeps unanswered income distinct from No and updates the collapsed group summary', async () => {
    sectionSelect(await load()).props.onChange({ target: { value: '1' } });
    let tree = render();
    expect(text(section(tree, 'Rental & other income').props.children[0])).toContain('2 to review');
    choose(tree, 'Rental income from property you own', 'no');
    tree = render();
    expect(text(section(tree, 'Rental & other income').props.children[0])).toContain('1 to review');
    choose(tree, 'Other income (gambling, prizes, alimony pre-2019, etc.)', 'yes');
    tree = render();
    expect(text(section(tree, 'Rental & other income').props.children[0])).toContain('1 selected');
    expect(text(section(tree, 'Rental & other income').props.children[0])).not.toContain('to review');
    const group = walk(tree).find(node => node.props['aria-label'] === 'Rental income from property you own')!;
    expect(button(group, 'no').props['aria-pressed']).toBe(true);
    expect(button(group, 'yes').props['aria-pressed']).toBe(false);
    await button(tree, 'Save').props.onClick();
    const saved = JSON.parse(harness.request.mock.calls.find(call => call[1]?.method === 'POST')![1].body);
    expect(saved).toMatchObject({ hasRentalIncome: 'no', hasOtherIncome: 'yes', has1099INT: '' });
  });
});
