import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAuthenticatedRequest } from '../lib/firebase/api-client';
import { CONSENT_TERMS_VERSION } from '../lib/onboarding/consents';
import { uploadOnboardingDocument } from '../components/data-source-screen';
import { protectedScreen, protectedScreenUrl, previousProtectedScreen } from '../lib/navigation/protected-screens';
import { profileLookupState } from '../lib/onboarding/profile';
import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { generateActionItems } from '../lib/guidance/action-engine';
import { QuickActionsBar } from '../components/dashboard/QuickActionsBar';
import { AiAdvisoryCard } from '../components/dashboard/AiAdvisoryCard';
import LoginPage from '../app/auth/login/page';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const firebase = vi.hoisted(() => ({ currentUser: { getIdToken: vi.fn() } as { getIdToken: ReturnType<typeof vi.fn> } | null }));
vi.mock('@/lib/firebase/client', () => ({ auth: firebase }));
vi.mock('@/components/login-form', () => ({ LoginForm: () => null }));

beforeEach(() => { firebase.currentUser = { getIdToken: vi.fn().mockResolvedValue('test-id-token') }; });
afterEach(() => vi.unstubAllGlobals());

describe('authenticated upload transport', () => {
  it('lets fetch encode a parseable multipart boundary and preserves the file', async () => {
    let received: FormData | undefined;
    const request = vi.fn(async (_url: string, options?: RequestInit) => {
      const actual = new Request('https://staging.example/api/import', options);
      expect(actual.headers.get('authorization')).toBe('Bearer test-id-token');
      expect(actual.headers.get('x-journey')).toBe('upload');
      expect(actual.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
      received = await actual.formData();
      return new Response('{}');
    });
    vi.stubGlobal('fetch', request);
    const body = new FormData();
    body.append('file', new File(['synthetic receipt bytes'], 'receipt.png', { type: 'image/png' }));
    body.append('year', '2026');
    await makeAuthenticatedRequest('/api/import', {
      method: 'POST', body,
      headers: new Headers({ 'Content-Type': 'application/json', 'X-Journey': 'upload' }),
    });
    expect(received?.get('year')).toBe('2026');
    const file = received?.get('file') as File;
    expect(file.name).toBe('receipt.png');
    expect(await file.text()).toBe('synthetic receipt bytes');
  });

  it('retains JSON behavior for transaction writes and accepts HeadersInit tuples', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
      const request = new Request('https://staging.example/api/manual', options);
      expect(request.headers.get('content-type')).toBe('application/json');
      expect(request.headers.get('x-client')).toBe('journey');
      expect(await request.json()).toEqual({ amount: 42.15 });
      return new Response('{}');
    }));
    await makeAuthenticatedRequest('/api/manual', { method: 'POST', body: JSON.stringify({ amount: 42.15 }), headers: [['X-Client', 'journey']] });
  });

  it('does not send a request after sign-out', async () => {
    firebase.currentUser = null;
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    await expect(makeAuthenticatedRequest('/api/import')).rejects.toThrow('not authenticated');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('onboarding document outcomes', () => {
  const file = () => new File(['synthetic statement'], 'statement.pdf', { type: 'application/pdf' });
  it('sends a real multipart statement and returns the imported count', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
      const body = await new Request('https://staging.example/api/import', options).formData();
      expect(body.get('docType')).toBe('auto');
      expect(body.get('year')).toBe('2026');
      expect((body.get('file') as File).name).toBe('statement.pdf');
      return Response.json({ transactionsImported: 3, bankName: 'Synthetic bank' });
    }));
    await expect(uploadOnboardingDocument(file(), 2026)).resolves.toMatchObject({ transactionsImported: 3 });
  });
  it.each([400, 401, 413, 500, 503])('reports HTTP %s as a failure, never an imported document', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Document could not be read' }, { status })));
    await expect(uploadOnboardingDocument(file(), 2026)).rejects.toThrow('Document could not be read');
  });
  it('handles non-JSON hosting failures with a usable retry message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Unavailable</html>', { status: 502 })));
    await expect(uploadOnboardingDocument(file(), 2026)).rejects.toThrow('Upload failed. Please try again.');
  });
  it('does not call a redirect instruction a successful import', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ redirect: true, message: 'Use Import Document for W-2 forms' })));
    await expect(uploadOnboardingDocument(file(), 2026)).rejects.toThrow('Use Import Document for W-2 forms');
  });
});

describe('protected browser journey destinations', () => {
  it.each(['receipt-upload', 'add-manual-transaction', 'document-import', 'review-transactions', 'schedule-c-export'])(
    'returns from %s to a dashboard URL that remains correct on reload', (screen) => {
      const back = previousProtectedScreen(protectedScreen(screen), ['dashboard']);
      const url = new URL(protectedScreenUrl(back.screen), 'https://staging.example');
      expect(url.pathname).toBe('/protected');
      expect(url.search).toBe('');
      expect(protectedScreen(url.searchParams.get('screen'))).toBe('dashboard');
    },
  );
  it('returns a direct transaction link to its real transaction-list route', () => {
    const back = previousProtectedScreen('transaction-detail', ['dashboard'], 'transactions');
    expect(protectedScreenUrl(back.screen)).toBe('/protected/transactions');
  });
  it('returns a nested transaction review journey to review and then dashboard', () => {
    const back = previousProtectedScreen('transaction-detail', ['dashboard', 'review-transactions'], 'review-transactions');
    expect(protectedScreenUrl(back.screen)).toBe('/protected?screen=review-transactions');
    const dashboard = previousProtectedScreen(back.screen, back.stack);
    expect(protectedScreenUrl(dashboard.screen)).toBe('/protected');
  });
  it('preserves the bank-connection return destination and escapes transaction IDs', () => {
    expect(protectedScreenUrl('plaid-link?from=settings')).toBe('/protected?screen=plaid-link&from=settings');
    const url = new URL(protectedScreenUrl('transaction-detail?transactionId=abc%26def&from=review-transactions'), 'https://staging.example');
    expect(url.searchParams.get('transactionId')).toBe('abc&def');
    expect(url.searchParams.get('from')).toBe('review-transactions');
    const details = new URL(protectedScreenUrl('transaction-detail?transactionId=tx-1&section=details'), 'https://staging.example');
    expect(details.searchParams.get('section')).toBe('details');
    expect(protectedScreenUrl('settings?tab=payment')).toBe('/protected/settings?tab=payment');
    expect(protectedScreenUrl('reports?year=2026')).toBe('/protected/reports?year=2026');
    expect(protectedScreenUrl('reports?year=9999')).toBe('/protected/reports');
  });
  it('preserves the selected record when opening review from transaction details', () => {
    const url = new URL(protectedScreenUrl('review-transactions?transactionId=abc%26def%2Fghi&from=transaction-detail'), 'https://staging.example');
    expect(url.searchParams.get('screen')).toBe('review-transactions');
    expect(url.searchParams.get('transactionId')).toBe('abc&def/ghi');
    expect(url.searchParams.get('from')).toBe('transaction-detail');
    expect(protectedScreenUrl('review-transactions')).toBe('/protected?screen=review-transactions');
    expect(protectedScreenUrl('receipt-upload?transactionId=unexpected')).toBe('/protected?screen=receipt-upload');
  });
  it.each(['javascript:alert(1)', '//example.com', 'unknown-screen'])('keeps unknown destination %s inside the dashboard', value => {
    expect(protectedScreenUrl(value)).toBe('/protected');
    expect(protectedScreenUrl(previousProtectedScreen('transaction-detail', [], value).screen)).toBe('/protected');
  });
});

describe('returning-customer profile decisions', () => {
  it.each([{ code: 'FETCH_ERROR' }, { code: 'permission-denied' }, {}, new Error('offline')])(
    'requires retry, never onboarding, when the profile lookup fails: %j', error => {
      expect(profileLookupState(null, error)).toBe('error');
    },
  );
  it('allows onboarding only for a confirmed missing profile and restores the existing customer after retry', () => {
    expect(profileLookupState(null, { code: 'PROFILE_NOT_FOUND' })).toBe('missing');
    expect(profileLookupState({ name: 'Existing customer' }, null)).toBe('existing');
  });
  it('keeps onboarding open for a document that only records the sign-up acknowledgments', () => {
    const consents = { version: CONSENT_TERMS_VERSION, source: 'profile-setup', accepted_at: '2026-09-17T12:00:00.000Z', terms: true, bank_data: true, ai_review: true, communications: false };
    // getUserProfile maps absent answers to empty strings.
    expect(profileLookupState({ id: 'new', email: '', name: '', profession: '', income: '', state: '', filing_status: '', consents }, null)).toBe('missing');
    expect(profileLookupState({ id: 'new', name: 'Finished setup', consents }, null)).toBe('existing');
    // Customers from before consent records never had the field and stay existing.
    expect(profileLookupState({ id: 'legacy', email: '', name: '', profession: '', income: '', state: '', filing_status: '' }, null)).toBe('existing');
  });
});

describe('accessibility quick wins', () => {
  it('gives every receipt-upload select an accessible name', () => {
    const source = readFileSync(resolve(__dirname, '../components/receipt-upload-screen.tsx'), 'utf8');
    const selects = [...source.matchAll(/<select\b([^>]*)>/gs)].map(match => match[1]);
    expect(selects).toHaveLength(3);
    for (const attributes of selects) {
      const id = attributes.match(/\bid="([^"]+)"/)?.[1];
      const labeled = Boolean(id) && source.includes(`htmlFor="${id}"`);
      expect(labeled || /\baria-label="[^"]+"/.test(attributes)).toBe(true);
    }
    expect(source).toContain('aria-label="Transaction to attach this receipt to"');
  });
  it('announces the login page fallback as a status', () => {
    vi.stubGlobal('React', React); // the app compiles JSX with the automatic runtime; vitest uses the classic one
    const page = (LoginPage as () => ReactElement<{ fallback: ReactElement<{ role?: string; children?: ReactNode }> }>)();
    expect(page.props.fallback.props.role).toBe('status');
    expect(nodeText(page.props.fallback)).toMatch(/Loading/);
  });
});

type ClickableElement = ReactElement<{ children?: ReactNode; onClick?: () => void }>;
function elements(node: ReactNode): ClickableElement[] {
  return Children.toArray(node).flatMap(child => isValidElement<ClickableElement['props']>(child)
    ? [child, ...elements(child.props.children)] : []);
}
function nodeText(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<ClickableElement['props']>(child)
    ? nodeText(child.props.children) : String(child)).join('');
}

describe('manual dashboard entry and review actions', () => {
  const profile = { profession: 'Consultant', state: 'CA', filing_status: 'Single', business_income: 100000 };

  it('prioritizes manual entry for an empty account while retaining an optional bank route', () => {
    const actions = generateActionItems(profile, []);
    const manual = actions.findIndex(action => action.id === 'add-first-transaction');
    const bank = actions.findIndex(action => action.id === 'connect-bank');
    expect(actions[manual]).toMatchObject({ priority: 'high', screen: 'add-manual-transaction' });
    expect(actions[bank]).toMatchObject({ priority: 'low', screen: 'plaid-link' });
    expect(manual).toBeLessThan(bank);
    expect(generateActionItems({ ...profile, bankConnected: true }, []).some(action => action.id === 'connect-bank')).toBe(false);
  });

  it('keeps manually confirmed records done and skipped records eligible for analysis', () => {
    // Server-saved decisions carry review_status; a legacy pre-cutoff record has only the date.
    const records = [
      { amount: 100, is_deductible: true, review_status: 'confirmed', date: '2026-03-01' },
      { amount: 50, is_deductible: false, date: '2026-03-02' },
      { amount: 20, is_deductible: null, user_classification_reason: 'Skipped by user' },
    ];
    const actions = generateActionItems(profile, records);
    expect(actions.find(action => action.id === 'analyze-transactions')).toMatchObject({ screen: 'review-transactions' });
    expect(generateActionItems(profile, records.slice(0, 2)).some(action => action.id === 'analyze-transactions' || action.id === 'review-analyzed')).toBe(false);
    expect(generateActionItems(profile, [...records, { amount: 25, is_deductible: null }])
      .find(action => action.id === 'analyze-transactions')).toMatchObject({ screen: 'review-transactions' });
  });

  it('keeps an unstamped deduction flag on a post-cutoff record in the review queue', () => {
    const unstamped = [{ amount: 100, is_deductible: true, date: '2026-12-01', created_at: '2026-12-01T10:00:00.000Z' }];
    expect(generateActionItems(profile, unstamped).find(action => action.id === 'analyze-transactions')).toMatchObject({ screen: 'review-transactions' });
    expect(generateActionItems(profile, [{ ...unstamped[0], review_status: 'confirmed' }]).some(action => action.id === 'analyze-transactions')).toBe(false);
  });

  it('routes a missing-income prompt to the saved income records', () => {
    expect(generateActionItems({ ...profile, business_income: 0 }, [])
      .find(action => action.id === 'set-income')).toMatchObject({ screen: 'income-tracking' });
  });

  it.each([
    ['Add Income', 'income-tracking'],
    ['Add Expense', 'add-manual-transaction'],
  ])('opens the existing manual destination from %s', (label, screen) => {
    const onNavigate = vi.fn();
    const tree = QuickActionsBar({ onNavigate, needsReviewCount: 0, needsAnalysisCount: 0 });
    const button = elements(tree).find(element => element.type === 'button' && nodeText(element.props.children) === label);
    expect(button).toBeDefined();
    button!.props.onClick!();
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(screen);
  });

  it.each([
    [{ needsReviewCount: 0, needsAnalysisCount: 0, confirmedCount: 0 }, 'add-manual-transaction'],
    [{ needsReviewCount: 1, needsAnalysisCount: 1, confirmedCount: 0 }, 'review-transactions'],
    [{ needsReviewCount: 0, needsAnalysisCount: 0, confirmedCount: 1 }, 'tax-preview'],
  ])('keeps the advisory action within manual review or the shared estimate: %j', (counts, screen) => {
    const onNavigate = vi.fn();
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    const tree = AiAdvisoryCard({ ...counts, onNavigate });
    elements(tree).find(element => typeof element.props.onClick === 'function')!.props.onClick!();
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(screen);
    expect(request).not.toHaveBeenCalled();
  });
});
