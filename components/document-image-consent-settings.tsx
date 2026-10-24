'use client';

import React, { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { parseConsentRecord, withdrawDocumentImportConsent } from '@/lib/onboarding/consents';
import { formatConsentCalendarDate } from '@/lib/onboarding/document-import-consent';
import { CONSENT_SAVE_ERROR, persistConsentRecord } from '@/lib/onboarding/consents-client';

interface DocumentImageConsentSettingsProps {
  userId: string;
  persist?: typeof persistConsentRecord;
  /** When set, render this record instead of loading the profile. Tests use it to pin a stored zone. */
  record?: unknown;
  /** Browser zone used when the signature has no stored signing zone. */
  timeZone?: string;
}

/** Settings > Data & Privacy: shows whether the §7216 document-image consent is signed and lets the person withdraw it. */
export function DocumentImageConsentSettings({ userId, persist = persistConsentRecord, record: suppliedRecord, timeZone }: DocumentImageConsentSettingsProps) {
  const supplied = suppliedRecord !== undefined;
  const [record, setRecord] = useState<unknown>(supplied ? suppliedRecord : null);
  const [loaded, setLoaded] = useState(supplied);
  const [withdrawing, setWithdrawing] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (supplied) return;
    let cancelled = false;
    setLoaded(false);
    makeAuthenticatedRequest('/api/database/profiles')
      .then(async response => {
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setRecord(data.profile?.consents ?? null);
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [userId, supplied]);

  const current = parseConsentRecord(record);
  const signature = current?.document_import ? current.document_import_signature : undefined;

  const withdraw = async () => {
    const withdrawn = withdrawDocumentImportConsent(record);
    if (!withdrawn || withdrawing) return;
    setWithdrawing(true); setMessage(null);
    try {
      await persist(withdrawn);
      setRecord(withdrawn);
      setMessage({ tone: 'ok', text: 'Consent withdrawn. Document images are no longer sent to OpenAI; text extraction with identification numbers removed continues to work.' });
    } catch (cause) {
      setMessage({ tone: 'error', text: cause instanceof Error && cause.message ? cause.message : CONSENT_SAVE_ERROR });
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground"><FileText className="h-4 w-4" />Document image consent (IRC §7216)</p>
      {!loaded ? (
        <p className="text-xs text-muted-foreground">Checking your consent record…</p>
      ) : signature ? (
        <>
          <p className="text-xs text-muted-foreground">
            Signed by {signature.signed_name} on {formatConsentCalendarDate(new Date(signature.signed_at), signature.signed_time_zone ?? timeZone)}. It lets WriteOff send the full image of a tax document you upload to OpenAI when the text cannot be read on WriteOff&apos;s own server.
          </p>
          <Button type="button" variant="outline" size="sm" disabled={withdrawing} onClick={withdraw} className="gap-2">
            {withdrawing && <Loader2 className="h-4 w-4 animate-spin" />}Withdraw consent
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          No consent on file. Uploaded tax documents are read on WriteOff&apos;s own server and only text with identification numbers removed is sent to OpenAI. You will be asked to sign this consent only if a document&apos;s text cannot be read and you choose to send the image.
        </p>
      )}
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-xs ${message.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{message.text}</p>}
    </div>
  );
}
