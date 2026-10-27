import { format } from 'node:url';
import querystring from 'node:querystring';
import { describe, expect, it } from 'vitest';
import { buildCustomRoute } from 'next/dist/lib/build-custom-route';
import { getRedirectStatus } from 'next/dist/lib/redirect-status';
import { prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination';
import nextConfig from '../next.config';

type RedirectRule = {
  source: string;
  destination: string;
  permanent?: boolean;
  statusCode?: number;
};

const SIGN_UP_SOURCES = ['/signup', '/sign-up', '/register'] as const;
const PRESERVED_QUERY = 'ref=abc&utm_source=x&creatorRef=y';

async function loadRedirects(): Promise<RedirectRule[]> {
  const redirects = (nextConfig as { redirects?: () => Promise<RedirectRule[]> | RedirectRule[] }).redirects;
  if (!redirects) throw new Error('next.config redirects() is missing');
  return redirects();
}

function rule(redirects: RedirectRule[], source: string): RedirectRule {
  const match = redirects.find((entry) => entry.source === source);
  if (!match) throw new Error(`missing redirect for ${source}`);
  return match;
}

// Same query merge Next uses when it applies a redirects() rule:
// incoming query first, destination query second, then querystring.stringify.
function locationFor(route: RedirectRule, query: Record<string, string>): string {
  const { parsedDestination } = prepareDestination({
    appendParamsToQuery: false,
    destination: route.destination,
    params: {},
    query,
  });
  const merged = parsedDestination.query;
  delete parsedDestination.query;
  parsedDestination.search = querystring.stringify(merged);
  return format(parsedDestination);
}

describe('sign-up entry redirects', () => {
  it.each(SIGN_UP_SOURCES)('returns 307 from %s to /auth/sign-up', async (source) => {
    const redirects = await loadRedirects();
    const route = rule(redirects, source);
    expect(route).toEqual({ source, destination: '/auth/sign-up', permanent: false });
    expect(getRedirectStatus(route)).toBe(307);
    expect(route.destination).not.toContain('?');
  });

  it('keeps ref, utm_source, and creatorRef exactly', async () => {
    const redirects = await loadRedirects();
    const query = { ref: 'abc', utm_source: 'x', creatorRef: 'y' };
    for (const source of SIGN_UP_SOURCES) {
      expect(locationFor(rule(redirects, source), query)).toBe(`/auth/sign-up?${PRESERVED_QUERY}`);
    }
  });

  it('matches a trailing slash the same way /login does', async () => {
    const redirects = await loadRedirects();
    const login = buildCustomRoute('redirect', rule(redirects, '/login'));
    expect(login.regex).toBe('^/login(?:/)?$');
    expect(new RegExp(login.regex).test('/login/')).toBe(true);
    for (const source of SIGN_UP_SOURCES) {
      const compiled = buildCustomRoute('redirect', rule(redirects, source));
      expect(compiled.statusCode).toBe(307);
      expect(compiled.regex).toBe(`^${source}(?:/)?$`);
      expect(new RegExp(compiled.regex).test(source)).toBe(true);
      expect(new RegExp(compiled.regex).test(`${source}/`)).toBe(true);
      expect(new RegExp(compiled.regex).test('/auth/sign-up')).toBe(false);
      expect(locationFor(rule(redirects, source), { ref: 'abc', utm_source: 'x', creatorRef: 'y' })).toBe(
        `/auth/sign-up?${PRESERVED_QUERY}`,
      );
    }
  });

  it('does not redirect /auth/sign-up', async () => {
    const redirects = await loadRedirects();
    const compiled = redirects.map((entry) => buildCustomRoute('redirect', entry));
    expect(compiled.some((entry) => new RegExp(entry.regex).test('/auth/sign-up'))).toBe(false);
    expect(compiled.some((entry) => new RegExp(entry.regex).test('/auth/sign-up/'))).toBe(false);
    expect(redirects.some((entry) => entry.destination === '/signup' || entry.destination === '/sign-up' || entry.destination === '/register')).toBe(false);
  });
});
