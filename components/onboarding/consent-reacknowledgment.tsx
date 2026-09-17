'use client';

import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LogoutButton } from '@/components/logout-button';
import { ConsentCheckboxes, NoticeAtCollection } from '@/components/onboarding/consent-checkboxes';
import {
  buildConsentRecord, CONSENT_TERMS_VERSION, hasAcknowledgedRequiredConsents, NO_CONSENTS, requiredConsentsAccepted, type ConsentChoices,
} from '@/lib/onboarding/consents';
import { CONSENT_SAVE_ERROR, persistConsentRecord } from '@/lib/onboarding/consents-client';

/**
 * Accounts created before the current terms version, or before acknowledgments were
 * recorded at all, have no usable consent record. The protected layout shows this in
 * place of the app until the required acknowledgments are saved through the profile API.
 */
export function needsConsentReacknowledgment(profile: { consents?: unknown } | null | undefined): boolean {
  return !!profile && !hasAcknowledgedRequiredConsents(profile.consents);
}

interface ConsentReacknowledgmentProps {
  /** Called after the server accepted the record so the layout can reload the profile. */
  onRecorded: () => void;
  persist?: typeof persistConsentRecord;
}

export function ConsentReacknowledgment({ onRecorded, persist = persistConsentRecord }: ConsentReacknowledgmentProps) {
  const [choices, setChoices] = useState<ConsentChoices>(NO_CONSENTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    const record = buildConsentRecord(choices, 'reacknowledgment');
    if (!record) return;
    setSaving(true);
    setError(null);
    try {
      await persist(record);
      onRecorded();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : CONSENT_SAVE_ERROR);
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="consent-reack-title" className="mx-auto w-full max-w-xl px-4 py-6">
      <h1 id="consent-reack-title" className="text-xl font-semibold">Please review our updated acknowledgments</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Our terms were updated on {CONSENT_TERMS_VERSION}. Your saved records are unchanged. To keep using WriteOff, confirm the acknowledgments below; they are saved to your account, and you can review our policies at any time.
      </p>
      <NoticeAtCollection className="mt-4" />
      <div className="mt-4">
        <ConsentCheckboxes idPrefix="reack" values={choices} disabled={saving} onChange={(key, checked) => setChoices(prev => ({ ...prev, [key]: checked }))} />
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
      {saving && !error && <p role="status" className="mt-3 text-xs text-muted-foreground">Saving your acknowledgments…</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <LogoutButton variant="outline" className="min-h-11 rounded-xl px-4" />
        <Button type="button" onClick={handleContinue} disabled={!requiredConsentsAccepted(choices) || saving} className="min-h-11 rounded-xl px-5">
          {saving ? 'Saving...' : 'Agree and continue'}<ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}
