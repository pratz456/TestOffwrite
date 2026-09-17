'use client';

import React, { useState } from 'react';
import { AlertCircle, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hasDocumentImportConsent, parseConsentRecord, signDocumentImportConsent, type ConsentRecord } from '@/lib/onboarding/consents';
import { CONSENT_SAVE_ERROR, persistConsentRecord } from '@/lib/onboarding/consents-client';
import {
  DOCUMENT_IMPORT_CONSENT_DATE_BLANK, DOCUMENT_IMPORT_CONSENT_NAME_BLANK, DOCUMENT_IMPORT_CONSENT_TEXT,
} from '@/lib/onboarding/document-import-consent';

export type DocumentImageFallbackReason = 'ocr_unavailable' | 'ocr_low_confidence' | 'model_requested_image';

interface DocumentImageConsentProps {
  /** The account's current consent record (profile.consents); null while loading or when none exists. */
  record: unknown;
  reason: DocumentImageFallbackReason;
  onAuthorized: (record: ConsentRecord) => void;
  onCancel: () => void;
  persist?: typeof persistConsentRecord;
  today?: Date;
}

const REASONS: Record<DocumentImageFallbackReason, string> = {
  ocr_unavailable: 'WriteOff cannot read this file type as text on its own server.',
  ocr_low_confidence: 'WriteOff read this document on its own server, but the text was not clear enough to extract the amounts.',
  model_requested_image: 'WriteOff read this document on its own server and removed identification numbers from the text, but the amounts could not be extracted from that text.',
};

const formatDate = (date: Date) => date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/**
 * Own screen for the IRC §7216 consent (Rev. Proc. 2013-14 format): the checkbox
 * label is the consent text verbatim, the typed full name is the signature and is
 * never pre-filled, the date is shown, and a printable copy is one click away.
 */
export function DocumentImageConsent({ record, reason, onAuthorized, onCancel, persist = persistConsentRecord, today = new Date() }: DocumentImageConsentProps) {
  const current = parseConsentRecord(record);
  const onFile = hasDocumentImportConsent(record) ? current?.document_import_signature ?? null : null;
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const date = formatDate(today);
  const typedName = name.trim();
  // The label stays the drafted wording; the two blanks are completed by the person, not pre-filled.
  const signerName = onFile?.signed_name || typedName || DOCUMENT_IMPORT_CONSENT_NAME_BLANK;
  const label = DOCUMENT_IMPORT_CONSENT_TEXT
    .replace(DOCUMENT_IMPORT_CONSENT_NAME_BLANK, () => signerName)
    .replace(DOCUMENT_IMPORT_CONSENT_DATE_BLANK, () => date);
  const canContinue = agreed && !saving && (onFile !== null || typedName.length > 0);

  const handleContinue = async () => {
    if (!canContinue) return;
    if (onFile && current) { onAuthorized(current); return; }
    const signed = signDocumentImportConsent(record, typedName, today);
    if (!signed) { setError('Your account acknowledgments must be current before this consent can be signed. Reload the page and try again.'); return; }
    setSaving(true); setError(null);
    try {
      await persist(signed);
      onAuthorized(signed);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : CONSENT_SAVE_ERROR);
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="document-image-consent-title" className="space-y-4 print:text-black">
      <div className="space-y-1 print:hidden">
        <h2 id="document-image-consent-title" className="text-lg font-semibold">Consent to send this document&apos;s full image to OpenAI</h2>
        <p className="text-sm text-muted-foreground">
          {REASONS[reason]} To continue, WriteOff would send the full image, including any Social Security, identification and account numbers printed on it, to OpenAI. Federal law (IRC §7216) requires your signed consent first. You can instead cancel and retake the photo or enter the amounts by hand.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
        <input
          type="checkbox"
          id="document-image-consent"
          checked={agreed}
          disabled={saving}
          onChange={event => setAgreed(event.target.checked)}
          className="mt-1 h-5 w-5 flex-shrink-0 print:hidden"
        />
        <label htmlFor="document-image-consent" className="whitespace-pre-wrap text-sm leading-relaxed text-foreground sm:text-base">{label}</label>
      </div>

      {onFile ? (
        <p className="text-sm text-muted-foreground">
          Signed by {onFile.signed_name} on {formatDate(new Date(onFile.signed_at))}. You can withdraw this consent at any time in Settings &gt; Data &amp; Privacy.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end print:hidden">
          <div className="space-y-1.5">
            <label htmlFor="document-image-consent-name" className="text-sm font-medium">Signature (type your full name)</label>
            <Input id="document-image-consent-name" value={name} autoComplete="off" disabled={saving} onChange={event => setName(event.target.value)} className="bg-background" maxLength={200} />
          </div>
          <p className="text-sm text-muted-foreground">Date: {date}</p>
        </div>
      )}

      {error && <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />Print this consent
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button>
          <Button type="button" disabled={!canContinue} onClick={handleContinue} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {onFile ? 'Send the image' : 'Sign and send the image'}
          </Button>
        </div>
      </div>
    </section>
  );
}
