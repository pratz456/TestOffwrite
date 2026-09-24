import { isLoopbackHostname } from '@/lib/firebase/local-emulator-config';

export type BillingDestination = '/protected/settings?tab=payment' | '/protected/subscriptions';

/** Keep provider mutations on the live origin while previewing the real account locally. */
export function openLocalPreviewBilling(destination: BillingDestination = '/protected/settings?tab=payment'): boolean {
  if (process.env.NODE_ENV !== 'development' || process.env.NEXT_PUBLIC_APP_ENV !== 'local-account-preview'
      || typeof window === 'undefined' || !isLoopbackHostname(window.location.hostname)) return false;
  const path = destination === '/protected/subscriptions' ? '/protected/subscriptions' : '/protected/settings?tab=payment';
  // No identity, credentials, or provider session is passed between origins.
  window.open(`https://writeoffapp.com${path}`, '_blank', 'noopener,noreferrer');
  return true;
}
