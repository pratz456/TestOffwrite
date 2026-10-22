import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

const navigation = vi.hoisted(() => ({
  search: new URLSearchParams(),
}));

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>('next/navigation');
  return {
    ...actual,
    useRouter: () => ({ push() {}, replace() {}, back() {}, prefetch() {} }),
    useSearchParams: () => navigation.search,
  };
});

import ProtectedPage from '../app/protected/page';
import FileTaxesPage from '../app/protected/file-taxes/page';

const root = path.resolve(__dirname, '..');

function redirectTarget(error: unknown): string | null {
  const digest = error && typeof error === 'object' && 'digest' in error ? String(error.digest) : '';
  if (!digest.startsWith('NEXT_REDIRECT;')) return null;
  return digest.split(';').slice(2, -2).join(';');
}

function markup(node: ReactElement) {
  return renderToStaticMarkup(node);
}

beforeEach(() => {
  navigation.search = new URLSearchParams();
  vi.stubEnv('FEATURE_UNRELEASED_SCREENS', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('unreleased server pages', () => {
  it.each(['form-8879', 'tax-filing-hub', 'tax-form-wizard'])(
    'renders a not-available screen for %s when the flag is off',
    async (screen) => {
      const html = markup(await ProtectedPage({ searchParams: Promise.resolve({ screen }) }));
      expect(html).toContain('This screen is not available');
      expect(html).toContain('href="/protected"');
      expect(html).toContain('<section');
      expect(html).not.toContain('<main');
    },
  );

  it.each(['form-8879', 'tax-filing-hub'])(
    'renders the signed-in page for %s when the flag is on',
    async (screen) => {
      vi.stubEnv('FEATURE_UNRELEASED_SCREENS', 'true');
      navigation.search = new URLSearchParams({ screen });
      const page = await ProtectedPage({ searchParams: Promise.resolve({ screen }) });
      const html = markup(page);
      expect(html).not.toContain('This screen is not available');
      expect(html).toContain('Loading');
      expect(page.props.unreleasedHost).toBeTruthy();
    },
  );

  it('still renders the signed-in home page when the flag is off', async () => {
    const html = markup(await ProtectedPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain('This screen is not available');
    expect(html).toContain('Loading');
  });

  it('renders a not-available screen for the direct route when the flag is off', () => {
    const html = markup(FileTaxesPage());
    expect(html).toContain('This screen is not available');
    expect(html).toContain('<section');
    expect(html).not.toContain('<main');
  });

  it('redirects the direct route when the flag is on', () => {
    vi.stubEnv('FEATURE_UNRELEASED_SCREENS', 'true');
    try {
      FileTaxesPage();
      expect.fail('expected a redirect');
    } catch (error) {
      expect(redirectTarget(error)).toBe('/protected?screen=tax-filing-hub');
    }
  });
});

describe('in-app links to unreleased screens', () => {
  const allowed = new Set([
    'app/api/ai/account-assistant/route.ts',
    'app/api/tax/filing/route.ts',
    'app/api/tax/form-8879/route.ts',
    'app/protected/file-taxes/page.tsx',
    'app/protected/protected-page-client.tsx',
    'components/embedded-filing-card.tsx',
    'components/form-8879-screen.tsx',
    'components/tax-filing-hub-screen.tsx',
    'components/unreleased-screen-host.tsx',
    'lib/features/unreleased-screens.ts',
    'lib/navigation/app-navigation.ts',
    'lib/navigation/protected-screens.ts',
    'lib/firebase/delete-user-data.ts',
    'lib/tax-assistant/account-contract.ts',
    'scripts/smoke-platform.mjs',
  ]);

  it('only appear in the flag, the screens it mounts, or callers the flag already covers', () => {
    const hits: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const full = path.join(directory, entry);
        if (statSync(full).isDirectory()) {
          if (entry === 'node_modules' || entry === '.next') continue;
          walk(full);
          continue;
        }
        if (!/\.(tsx?|mjs|jsx?)$/.test(entry)) continue;
        const relative = path.relative(root, full);
        const source = readFileSync(full, 'utf8');
        if (/tax-filing-hub|form-8879|tax-form-wizard|file-taxes|\/api\/tax\/filing|form_8879|tax_filing_connections|filing_security_metadata/.test(source)) {
          hits.push(relative);
        }
      }
    };
    for (const directory of ['app', 'components', 'lib', 'functions', 'scripts']) walk(path.join(root, directory));
    expect(hits.filter(file => !allowed.has(file)).sort()).toEqual([]);
  });
});
