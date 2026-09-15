import type { RuntimeCaching } from 'workbox-build';

/** Only explicitly public assets enter runtime caches. Workbox ignores HTTP no-store. */
export const privacyRuntimeCaching: RuntimeCaching[] = [
  {
    // First-match precedence also protects receipt URLs ending in image extensions.
    urlPattern: ({ url, request, sameOrigin }) => !sameOrigin
      || /^\/(?:api|protected|auth)(?:\/|$)/.test(url.pathname)
      || url.pathname.startsWith('/_next/data/')
      || request.headers.has('authorization')
      || request.headers.get('RSC') === '1',
    handler: 'NetworkOnly',
    options: {},
  },
  {
    urlPattern: ({ url, sameOrigin }) => Boolean(sameOrigin && url.pathname.startsWith('/_next/static/')),
    handler: 'CacheFirst',
    options: { cacheName: 'writeoff-public-next-static-v1', expiration: { maxEntries: 128, maxAgeSeconds: 30 * 24 * 60 * 60 } },
  },
  {
    urlPattern: ({ url, sameOrigin }) => Boolean(sameOrigin && ['/writeofflogo.png', '/og-image.png', '/manifest.json'].includes(url.pathname)),
    handler: 'StaleWhileRevalidate',
    options: { cacheName: 'writeoff-public-brand-v1', expiration: { maxEntries: 8, maxAgeSeconds: 7 * 24 * 60 * 60 } },
  },
  {
    // Includes public HTML: a public route can still render account-specific state.
    urlPattern: () => true,
    handler: 'NetworkOnly',
    options: {},
  },
];
