import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import * as React from 'react';

// Run the actual form handlers and effects; no emails or passwords are sent to Firebase.
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], verify: vi.fn(), confirm: vi.fn(), reset: vi.fn(), params: new URLSearchParams() }));
vi.mock('firebase/auth', () => ({ verifyPasswordResetCode: harness.verify, confirmPasswordReset: harness.confirm }));
vi.mock('@/lib/firebase/client', () => ({ auth: { currentUser: null } }));
vi.mock('@/lib/firebase/auth', () => ({ resetPassword: harness.reset }));
vi.mock('@/lib/onboarding/email-confirmation', () => ({ confirmEmailAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => harness.params }));
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
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = harness.cursor++; const previous = harness.slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        const next: any = { deps }; harness.slots[index] = next;
        harness.effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
      }
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
import { UpdatePasswordForm } from '../components/update-password-form';
import { ForgotPasswordForm } from '../components/forgot-password-form';
import ConfirmPage from '../app/auth/confirm/page';
import UpdatePasswordPage from '../app/auth/update-password/page';

type Element = ReactElement<Record<string, any>>;
function render(code: string | null = 'valid-code', mode: string | null = 'resetPassword') {
  harness.cursor = 0;
  const tree = UpdatePasswordForm({ code, mode }) as Element;
  harness.effects.splice(0).forEach(effect => effect());
  return tree;
}
function renderForgot() { harness.cursor = 0; return ForgotPasswordForm({}) as Element; }
function walk(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  return node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return typeof node === 'string' ? node : '';
}
function field(tree: Element, id: string) { return walk(tree).find(node => node.props.id === id)!; }
function form(tree: Element) { return walk(tree).find(node => node.type === 'form')!; }
function button(tree: Element, label: string) { return walk(tree).find(node => node.props.onClick && text(node) === label)!; }
function fill(password = 'NewPassword!123', confirmation = password) {
  const tree = render(); field(tree, 'password').props.onChange({ target: { value: password } });
  field(tree, 'confirm-password').props.onChange({ target: { value: confirmation } });
}
const event = () => ({ preventDefault() {} });
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.stubGlobal('React', React);
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.params = new URLSearchParams();
  vi.clearAllMocks(); harness.verify.mockResolvedValue('owner@example.test'); harness.confirm.mockResolvedValue(undefined); harness.reset.mockResolvedValue({ error: null });
});
afterEach(() => { harness.slots.forEach(slot => slot?.cleanup?.()); vi.unstubAllGlobals(); });

describe('reset form and email action routing', () => {
  it('only exposes the form after the code is validated, including logged-out users', async () => {
    expect(form(render())).toBeUndefined(); await tick();
    expect(text(render())).toContain('owner@example.test');
    fill(); await form(render()).props.onSubmit(event());
    expect(harness.confirm).toHaveBeenCalledWith(expect.anything(), 'valid-code', 'NewPassword!123');
    expect(text(render())).toContain('Password reset complete');
    expect(form(render())).toBeUndefined();
  });
  it.each([[null, null], ['code', 'verifyEmail']])('shows recovery for invalid link shape', async (code, mode) => {
    render(code, mode); await tick();
    const tree = render(code, mode); expect(form(tree)).toBeUndefined();
    expect(text(tree)).toContain('request a new link'); expect(harness.verify).not.toHaveBeenCalled();
    expect(walk(tree).some(node => node.props.href === '/auth/forgot-password')).toBe(true);
  });
  it('rejects mismatched confirmation before submitting', async () => {
    render(); await tick(); fill('NewPassword!123', 'OtherPassword!123');
    await form(render()).props.onSubmit(event());
    expect(harness.confirm).not.toHaveBeenCalled(); expect(text(render())).toContain('do not match');
  });
  it('prevents two concurrent password changes from a double submit', async () => {
    let finish!: () => void;
    harness.confirm.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    render(); await tick(); fill(); const handler = form(render()).props.onSubmit;
    const first = handler(event()); await handler(event()); expect(harness.confirm).toHaveBeenCalledOnce();
    expect(text(render())).not.toContain('Password reset complete'); finish(); await first;
    expect(text(render())).toContain('Password reset complete');
  });
  it('preserves entered passwords and permits retry after a network submission failure', async () => {
    harness.confirm.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    render(); await tick(); fill(); await form(render()).props.onSubmit(event());
    const failed = render(); expect(field(failed, 'password').props.value).toBe('NewPassword!123');
    expect(text(failed)).toContain('Check your connection');
    await form(failed).props.onSubmit(event()); expect(text(render())).toContain('Password reset complete');
  });
  it('removes the form when the code expires between validation and submission', async () => {
    harness.confirm.mockRejectedValueOnce({ code: 'auth/expired-action-code' });
    render(); await tick(); fill(); await form(render()).props.onSubmit(event());
    expect(form(render())).toBeUndefined(); expect(text(render())).toContain('expired or was already used');
  });
  it('retries a failed code validation without consuming the code', async () => {
    harness.verify.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    render(); await tick(); button(render(), 'Try again').props.onClick(); render(); await tick();
    expect(form(render())).toBeDefined(); expect(harness.confirm).not.toHaveBeenCalled();
  });
  it('ignores stale validation after navigating to a different reset code', async () => {
    let finish!: (email: string) => void;
    harness.verify.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    render('old-code'); render('new-code'); await tick(); finish('old-owner@example.test'); await tick();
    const tree = render('new-code'); expect(text(tree)).toContain('owner@example.test'); expect(text(tree)).not.toContain('old-owner');
  });
  it('ignores an old submission result after the link changes', async () => {
    let finish!: () => void;
    harness.confirm.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    render(); await tick(); fill(); const pending = form(render()).props.onSubmit(event());
    render('new-code'); await tick(); finish(); await pending;
    expect(text(render('new-code'))).not.toContain('Password reset complete'); expect(form(render('new-code'))).toBeDefined();
  });
  it('dispatches resetPassword from the shared email handler to the reset form', () => {
    harness.params = new URLSearchParams({ mode: 'resetPassword', oobCode: 'test-code', apiKey: 'untrusted-ignored', continueUrl: 'https://attacker.test' });
    const suspense = ConfirmPage() as Element;
    const content = suspense.props.children.type() as Element;
    expect(walk(content).find(node => node.type === UpdatePasswordForm)?.props).toMatchObject({ code: 'test-code', mode: 'resetPassword' });
    expect(text(content)).not.toContain('attacker');
  });
  it('passes the full link contract from the dedicated reset page', () => {
    harness.params = new URLSearchParams({ mode: 'resetPassword', oobCode: 'test-code' });
    const page = UpdatePasswordPage() as Element;
    const suspense = walk(page).find(node => node.props.fallback)!;
    expect(suspense.props.children.type().props).toMatchObject({ code: 'test-code', mode: 'resetPassword' });
  });
});

describe('forgot password request handling', () => {
  function enterEmail() { field(renderForgot(), 'email').props.onChange({ target: { value: ' user@example.test ' } }); }
  it('trims the requested email and provides a way back to sign in', async () => {
    enterEmail(); await form(renderForgot()).props.onSubmit(event());
    expect(harness.reset).toHaveBeenCalledWith('user@example.test');
    expect(text(renderForgot())).toContain('If you registered');
    expect(walk(renderForgot()).some(node => node.props.href === '/auth/login')).toBe(true);
  });
  it('does not reveal whether an account exists', async () => {
    harness.reset.mockResolvedValue({ error: { code: 'auth/user-not-found', message: 'No account found' } });
    enterEmail(); await form(renderForgot()).props.onSubmit(event());
    expect(text(renderForgot())).toContain('If you registered'); expect(text(renderForgot())).not.toContain('No account');
  });
  it('prevents duplicate sends while the first email request is pending', async () => {
    let finish!: (result: { error: null }) => void;
    harness.reset.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    enterEmail(); const handler = form(renderForgot()).props.onSubmit;
    const pending = handler(event()); await handler(event()); expect(harness.reset).toHaveBeenCalledOnce(); finish({ error: null }); await pending;
  });
  it('keeps a retryable form and hides unexpected provider details', async () => {
    harness.reset.mockRejectedValueOnce(new Error('private diagnostic'));
    enterEmail(); await form(renderForgot()).props.onSubmit(event());
    expect(form(renderForgot())).toBeDefined(); expect(text(renderForgot())).not.toContain('private diagnostic');
    await form(renderForgot()).props.onSubmit(event()); expect(text(renderForgot())).toContain('If you registered');
  });
});
