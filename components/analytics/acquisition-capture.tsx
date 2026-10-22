'use client';

import { useEffect } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import { captureFirstTouch } from '@/lib/analytics/acquisition';
import { attributeSignup, type SignupMethod } from '@/lib/analytics/sign-up';

const RECENT_ACCOUNT_MS = 15 * 60 * 1000;

/**
 * Captures the landing source on every page load. Email account creation records
 * it from signUpUser. Google account creation shares the sign-in function, so a
 * brand-new Google user is recorded from here instead of that shared function.
 */
export function AcquisitionCapture() {
  useEffect(() => {
    try {
      captureFirstTouch(window.localStorage, Date.now(), {
        search: window.location.search,
        referrer: document.referrer,
        pathname: window.location.pathname,
        hostname: window.location.hostname,
      });
    } catch {
      // Storage can be blocked. Account creation still succeeds without a source.
    }
    return onIdTokenChanged(auth, user => {
      if (!user) return;
      const created = Date.parse(user.metadata?.creationTime ?? '');
      if (!Number.isFinite(created) || Date.now() - created > RECENT_ACCOUNT_MS) return;
      const method: SignupMethod = user.providerData.some(entry => entry.providerId === 'google.com') ? 'google' : 'email';
      void attributeSignup(method, user);
    });
  }, []);
  return null;
}
