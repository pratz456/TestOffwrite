import { describe, expect, it, vi } from 'vitest';
import { privacyRuntimeCaching } from '../lib/pwa/cache-policy';
import { clearLegacyPrivateCaches } from '../worker/index';

function selectedHandler(path: string, headers: HeadersInit = {}) {
  const url = new URL(path, 'https://writeoff.example');
  const request = new Request(url, { headers });
  const route = privacyRuntimeCaching.find(rule => typeof rule.urlPattern === 'function' && rule.urlPattern({ url, request, sameOrigin: url.origin === 'https://writeoff.example', event: {} as ExtendableEvent }));
  return route?.handler;
}

describe('account data is never a PWA runtime cache candidate', () => {
  it.each([
    '/api/receipts/private.png', '/api/tax/compute-1040?year=2026', '/api',
    '/protected', '/protected/reports', '/protected/transactions?_rsc=secret',
    '/auth/login', '/auth/sign-up-success', '/_next/data/build/protected.json',
    '/settings', '/', '/blog/public-post', '/preparer/snapshot#secret', '/api/preparer-handoffs/snapshot/download',
    'https://firebasestorage.googleapis.com/v0/b/demo/o/receipts%2Fprivate.png?token=example',
    'https://firestore.googleapis.com/v1/projects/demo/databases/default/documents',
    'https://js.stripe.com/v3/',
  ])('uses NetworkOnly for %s', path => { expect(selectedHandler(path)).toBe('NetworkOnly'); });

  it('does not let a static-looking URL override authentication or RSC request protections', () => {
    expect(selectedHandler('/_next/static/example.js', { authorization: 'Bearer synthetic' })).toBe('NetworkOnly');
    expect(selectedHandler('/writeofflogo.png', { RSC: '1' })).toBe('NetworkOnly');
  });

  it('retains caching for explicit public assets', () => {
    expect(selectedHandler('/_next/static/chunks/app.js')).toBe('CacheFirst');
    expect(selectedHandler('/_next/static/media/font.woff2')).toBe('CacheFirst');
    expect(selectedHandler('/writeofflogo.png')).toBe('StaleWhileRevalidate');
    expect(selectedHandler('/arbitrary-receipt.png')).toBe('NetworkOnly');
  });

  it('purges legacy private caches while preserving unrelated and new public caches', async () => {
    const names = ['apis', 'api-cache', 'firebase-cache', 'pages', 'pages-rsc', 'pages-rsc-prefetch', 'pages-cache', 'start-url', 'next-data', 'cross-origin', 'static-image-assets', 'images-cache', 'static-data-assets', 'next-image', 'unrelated-app-cache', 'writeoff-public-next-static-v1', 'workbox-precache-v2'];
    const deleteCache = vi.fn().mockResolvedValue(true);
    await clearLegacyPrivateCaches({ keys: async () => names, delete: deleteCache });
    expect(deleteCache.mock.calls.map(([name]) => name)).toEqual(names.slice(0, 14));
  });

  it('awaits activation cleanup and propagates deletion failures instead of claiming success', async () => {
    await expect(clearLegacyPrivateCaches({ keys: async () => ['apis'], delete: async () => { throw new Error('Cache deletion failed'); } })).rejects.toThrow('Cache deletion failed');
  });
});
