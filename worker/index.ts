/// <reference lib="webworker" />

// Exact cache names previously used by WriteOff's next-pwa defaults or old worker.
// Do not remove unrelated Cache Storage databases or Workbox's static precache.
const LEGACY_CACHES = new Set([
  'apis', 'api-cache', 'firebase-cache', 'pages', 'pages-cache',
  'pages-rsc', 'pages-rsc-prefetch', 'next-data', 'start-url', 'cross-origin',
  'static-image-assets', 'images-cache', 'static-data-assets', 'next-image',
]);

export async function clearLegacyPrivateCaches(storage: Pick<CacheStorage, 'keys' | 'delete'>): Promise<void> {
  const names = await storage.keys();
  await Promise.all(names.filter(name => LEGACY_CACHES.has(name)).map(name => storage.delete(name)));
}

declare const self: ServiceWorkerGlobalScope;
if (typeof self !== 'undefined' && 'registration' in self) {
  self.addEventListener('activate', event => {
    event.waitUntil(clearLegacyPrivateCaches(self.caches));
  });
}
