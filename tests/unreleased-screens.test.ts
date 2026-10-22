import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { RECORD_NAVIGATION, TAX_TOOL_NAVIGATION, visibleNavItems } from '../lib/navigation/app-navigation';
import { blockUnreleasedScreen, isUnreleasedScreen, unreleasedScreensEnabled } from '../lib/features/unreleased-screens';

const state = vi.hoisted(() => ({
  user: { uid: 'user-1', email: 'user@example.com' } as { uid: string; email: string } | null,
  touched: false,
}));
vi.mock('@/lib/firebase/api-auth', () => ({
  getAuthenticatedUser: async () => ({ user: state.user, error: state.user ? null : 'No authentication token found' }),
}));
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => { state.touched = true; throw new Error('stored records were read'); },
    doc: () => { state.touched = true; throw new Error('stored records were read'); },
  },
}));
vi.mock('@/lib/subscriptions/feature-access', () => ({
  requireFeatureAccess: async () => { state.touched = true; throw new Error('plan was read'); },
}));
vi.mock('@/lib/tax-filing/column-client', () => ({
  initializeColumnFiling: async () => { state.touched = true; throw new Error('provider was called'); },
  getColumnTaxReturn: async () => { state.touched = true; throw new Error('provider was called'); },
  validateColumnMetadata: () => { state.touched = true; throw new Error('provider was called'); },
}));

import { GET as filingGet, POST as filingPost } from '../app/api/tax/filing/route';
import { GET as hiddenGet, POST as hiddenPost } from '../app/api/tax/form-8879/route';

const root = path.resolve(__dirname, '..');
const source = (file: string) => readFileSync(path.join(root, file), 'utf8');
const request = (url: string, method = 'GET') => new NextRequest(url, { method });

beforeEach(() => {
  state.user = { uid: 'user-1', email: 'user@example.com' };
  state.touched = false;
  vi.stubEnv('FEATURE_UNRELEASED_SCREENS', '');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('unreleased screens stay off by default', () => {
  it('enables only an exact true value', () => {
    expect(unreleasedScreensEnabled({})).toBe(false);
    expect(unreleasedScreensEnabled({ FEATURE_UNRELEASED_SCREENS: 'false' })).toBe(false);
    expect(unreleasedScreensEnabled({ FEATURE_UNRELEASED_SCREENS: '1' })).toBe(false);
    expect(unreleasedScreensEnabled({ FEATURE_UNRELEASED_SCREENS: 'true' })).toBe(true);
  });

  it('blocks the unreleased screen queries and leaves the rest of the app alone', () => {
    for (const screen of ['form-8879', 'tax-filing-hub', 'tax-form-wizard']) {
      expect(isUnreleasedScreen(screen)).toBe(true);
      expect(blockUnreleasedScreen(screen, {})).toBe(true);
      expect(blockUnreleasedScreen(screen, { FEATURE_UNRELEASED_SCREENS: 'true' })).toBe(false);
    }
    for (const screen of [null, undefined, 'dashboard', 'transactions', 'settings', 'receipt-upload', 'tax-preview', 'schedule-c-export']) {
      expect(blockUnreleasedScreen(screen, {})).toBe(false);
    }
  });

  it('omits unreleased navigation entries unless they are enabled', () => {
    const hidden = visibleNavItems([...RECORD_NAVIGATION, ...TAX_TOOL_NAVIGATION], false).map(item => item.href);
    expect(hidden).not.toContain('/protected?screen=tax-filing-hub');
    expect(hidden).not.toContain('/protected?screen=form-8879');
    expect(hidden).toContain('/protected?screen=income-tracking');
    expect(hidden).toContain('/protected?screen=tax-organizer');
    const shown = visibleNavItems([...RECORD_NAVIGATION, ...TAX_TOOL_NAVIGATION], true).map(item => item.href);
    expect(shown).toContain('/protected?screen=tax-filing-hub');
    expect(shown).toContain('/protected?screen=form-8879');
  });

  it('wires the flag through the signed-in shell and does not load the screen modules there', () => {
    const page = source('app/protected/page.tsx');
    const client = source('app/protected/protected-page-client.tsx');
    expect(page).not.toContain('use client');
    expect(page.indexOf('blockUnreleasedScreen')).toBeGreaterThan(-1);
    expect(page.indexOf('blockUnreleasedScreen')).toBeLessThan(page.indexOf('unreleased-screen-host'));
    expect(client).not.toContain('form-8879-screen');
    expect(client).not.toContain('tax-filing-hub-screen');
    expect(client).toContain('ScreenUnavailable');
    expect(source('app/protected/file-taxes/page.tsx')).not.toContain('use client');
    expect(source('app/protected/file-taxes/page.tsx')).toContain('unreleasedScreensEnabled');
    expect(source('app/protected/layout.tsx')).toContain('unreleasedScreensEnabled()');
    for (const file of ['components/sidebar-nav.tsx', 'components/mobile-nav.tsx']) {
      const nav = source(file);
      expect(nav).toContain('visibleNavItems(RECORD_NAVIGATION, showUnreleasedScreens)');
      expect(nav).toContain('visibleNavItems(TAX_TOOL_NAVIGATION, showUnreleasedScreens)');
    }
    const host = source('components/unreleased-screen-host.tsx');
    expect(host).toContain('form-8879-screen');
    expect(host).toContain('tax-filing-hub-screen');
  });
});

describe('unreleased routes answer not found while the flag is off', () => {
  const calls = [
    ['filing read', filingGet, 'https://writeoffapp.com/api/tax/filing', 'GET'],
    ['filing write', filingPost, 'https://writeoffapp.com/api/tax/filing', 'POST'],
    ['history read', hiddenGet, 'https://writeoffapp.com/api/tax/form-8879', 'GET'],
    ['history write', hiddenPost, 'https://writeoffapp.com/api/tax/form-8879', 'POST'],
  ] as const;

  it.each(calls)('%s does not read stored records for a signed-in caller', async (_name, handler, url, method) => {
    const response = await handler(request(url, method));
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ error: 'Not found' });
    expect(state.touched).toBe(false);
  });

  it.each(calls)('%s still requires a signed-in caller', async (_name, handler, url, method) => {
    state.user = null;
    const response = await handler(request(url, method));
    expect(response.status).toBe(401);
    expect(state.touched).toBe(false);
  });
});
