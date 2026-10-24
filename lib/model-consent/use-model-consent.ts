'use client';

import { useEffect, useState } from 'react';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { MODEL_CONSENT_UNAVAILABLE, type ConsentStatus } from '@/lib/openai/consent-contract';

export { MODEL_CONSENT_UNAVAILABLE };

export type ModelConsentStatus = ConsentStatus | 'unknown';

/** Fail closed: uploads stay hidden until a granted disclosure is loaded. */
export function useModelConsent() {
  const [status, setStatus] = useState<ModelConsentStatus>('unknown');
  useEffect(() => {
    let cancel = false;
    makeAuthenticatedRequest('/api/settings/model-consent')
      .then(async response => {
        const body = await response.json().catch(() => null);
        const next = response.ok && (body?.status === 'granted' || body?.status === 'withdrawn' || body?.status === 'declined')
          ? body.status as ConsentStatus
          : 'declined';
        if (!cancel) setStatus(next);
      })
      .catch(() => { if (!cancel) setStatus('declined'); });
    return () => { cancel = true; };
  }, []);
  return { status, granted: status === 'granted', loaded: status !== 'unknown' };
}
