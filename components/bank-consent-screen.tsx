'use client';

import React, { useState } from 'react';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import {
  BANK_CONSENT_CHECKBOX, BANK_CONSENT_DECLINE, BANK_CONSENT_SAVE_ERROR, BANK_CONSENT_SCREEN_TITLE, BANK_CONSENT_SUBMIT,
  PLACEHOLDER_BANK_COLLECTION,
} from '@/lib/onboarding/bank-consent-copy';
import { browserTimeZone } from '@/lib/openai/consent-contract';

/** Separate screen shown before Plaid Link opens. The box starts unchecked. */
export function BankConsentScreen({
  onGranted,
  onDecline,
  timeZone = browserTimeZone(),
}: {
  onGranted: () => void;
  onDecline?: () => void;
  timeZone?: string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const grant = async () => {
    if (!acknowledged || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await makeAuthenticatedRequest('/api/settings/bank-consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'grant', acknowledged: true, timeZone }),
      });
      if (!response.ok) throw new Error(BANK_CONSENT_SAVE_ERROR);
      onGranted();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : BANK_CONSENT_SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="bank-consent-title" data-consent-screen="bank" className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
      <h2 id="bank-consent-title" className="text-sm font-medium text-foreground">{BANK_CONSENT_SCREEN_TITLE}</h2>
      <p className="text-sm text-foreground">{PLACEHOLDER_BANK_COLLECTION}</p>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id="bank-data-consent"
          checked={acknowledged}
          onChange={event => setAcknowledged(event.target.checked)}
          className="mt-1 h-5 w-5"
        />
        <label htmlFor="bank-data-consent" className="text-sm text-foreground">{BANK_CONSENT_CHECKBOX}</label>
      </div>
      {message && <p role="alert" className="text-xs text-destructive">{message}</p>}
      <div className="flex flex-wrap gap-2">
        {onDecline && (
          <button type="button" onClick={onDecline} className="rounded-lg border border-border px-3 py-2 text-sm">
            {BANK_CONSENT_DECLINE}
          </button>
        )}
        <button type="button" disabled={!acknowledged || saving} onClick={grant} className="rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">
          {BANK_CONSENT_SUBMIT}
        </button>
      </div>
    </section>
  );
}
