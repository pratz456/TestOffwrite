/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate, CacheFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { privacyRuntimeCaching } from '../lib/pwa/cache-policy';
import '../worker/index';

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

// Precache all static assets
precacheAndRoute(self.__WB_MANIFEST);

// Clean up outdated caches
cleanupOutdatedCaches();

// Keep this alternative worker entry aligned with the generated next-pwa worker.
// Only public static assets are cached; account data and HTML always use network.
const [privateRequests, staticFiles, brandAssets, remainingRequests] = privacyRuntimeCaching;
registerRoute(privateRequests.urlPattern, new NetworkOnly());
registerRoute(staticFiles.urlPattern, new CacheFirst({
  cacheName: staticFiles.options?.cacheName ?? undefined,
  plugins: [new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 30 * 24 * 60 * 60 })],
}));
registerRoute(brandAssets.urlPattern, new StaleWhileRevalidate({
  cacheName: brandAssets.options?.cacheName ?? undefined,
  plugins: [new ExpirationPlugin({ maxEntries: 8, maxAgeSeconds: 7 * 24 * 60 * 60 })],
}));
registerRoute(remainingRequests.urlPattern, new NetworkOnly());

// Background sync for offline transactions
self.addEventListener('sync' as any, (event: ExtendableEvent & { tag?: string }) => {
  if (event.tag === 'background-sync-transactions') {
    event.waitUntil(syncOfflineTransactions());
  }
});

// Push notifications for tax deadlines
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: '/writeofflogo.png',
      badge: '/writeofflogo.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: data.primaryKey || 1,
        url: data.url || '/'
      },
      actions: [
        {
          action: 'explore',
          title: 'View Details',
          icon: '/writeofflogo.png'
        },
        {
          action: 'close',
          title: 'Close',
          icon: '/writeofflogo.png'
        }
      ]
    };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      self.clients.openWindow(event.notification.data.url)
    );
  } else if (event.action === 'close') {
    // Just close the notification
    return;
  } else {
    // Default action - open the app
    event.waitUntil(
      self.clients.openWindow('/')
    );
  }
});

// Sync offline transactions when back online
async function syncOfflineTransactions() {
  try {
    // Get offline transactions from IndexedDB
    const offlineTransactions = await getOfflineTransactions();
    
    for (const transaction of offlineTransactions) {
      try {
        // Attempt to sync each transaction
        await fetch('/api/transactions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(transaction),
        });
        
        // Remove from offline storage if successful
        await removeOfflineTransaction(transaction.id);
      } catch (error) {
        console.error('Failed to sync transaction:', error);
      }
    }
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

// Helper functions for offline storage
async function getOfflineTransactions(): Promise<Array<{ id: string; [key: string]: unknown }>> {
  // Implementation would use IndexedDB
  return [];
}

async function removeOfflineTransaction(id: string) {
  // Implementation would remove from IndexedDB
}

// Install event
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(self.clients.claim());
});

// Message handling for communication with main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
