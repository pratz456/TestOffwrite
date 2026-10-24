'use client';

import React, { useState } from 'react';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import {
  MODEL_DISCLOSURE_CHECKBOX, MODEL_DISCLOSURE_DATA_LIST, MODEL_DISCLOSURE_DATE_LABEL, MODEL_DISCLOSURE_DECLINE,
  MODEL_DISCLOSURE_LENGTH, MODEL_DISCLOSURE_NAME_LABEL, MODEL_DISCLOSURE_PURPOSE, MODEL_DISCLOSURE_RECIPIENT, MODEL_DISCLOSURE_REVPROC_5041A,
  MODEL_DISCLOSURE_SUBMIT, MODEL_DISCLOSURE_TIGTA, MODEL_DISCLOSURE_TITLE, MODEL_REUSE_CHECKBOX, MODEL_REUSE_PURPOSE,
  MODEL_REUSE_REVPROC_5041C, MODEL_REUSE_SUBMIT, MODEL_REUSE_TITLE, disclosureAcceptBody, disclosureDeclineBody,
  formatConsentDate, reuseAcceptBody,
} from '@/lib/openai/consent-contract';

type SubmitConsent = (body: Record<string, unknown>) => Promise<void>;

async function postConsent(body: Record<string, unknown>) {
  const response = await makeAuthenticatedRequest('/api/settings/model-consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Consent could not be saved.');
}

/**
 * Disclosure only. The box starts unchecked and the name starts empty.
 * Decline does not send the name. Reuse is a different screen.
 */
export function ModelDisclosureConsentScreen({ today = new Date(), submit = postConsent }: { today?: Date; submit?: SubmitConsent }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [signedName, setSignedName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const date = formatConsentDate(today);
  const acceptBody = disclosureAcceptBody(acknowledged, signedName);

  const accept = async () => {
    if (!acceptBody) return;
    setMessage(null);
    try { await submit(acceptBody); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Consent could not be saved.'); }
  };
  const decline = async () => {
    setMessage(null);
    try { await submit(disclosureDeclineBody()); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Consent could not be saved.'); }
  };

  return (
    <section aria-labelledby="model-disclosure-consent-title" className="space-y-4 rounded-lg border border-border bg-muted/30 p-3">
      <h2 id="model-disclosure-consent-title" className="text-sm font-medium text-foreground">{MODEL_DISCLOSURE_TITLE}</h2>
      <p className="text-sm text-foreground">{MODEL_DISCLOSURE_RECIPIENT}</p>
      <p className="text-sm text-foreground">{MODEL_DISCLOSURE_PURPOSE}</p>
      {MODEL_DISCLOSURE_REVPROC_5041A.map(sentence => <p key={sentence} className="text-sm text-foreground">{sentence}</p>)}
      <ul aria-label={MODEL_DISCLOSURE_TITLE} className="list-disc space-y-1 pl-5 text-sm text-foreground">
        {MODEL_DISCLOSURE_DATA_LIST.map(item => <li key={item.id} data-field={item.id}>{item.label}</li>)}
      </ul>
      <p className="text-sm text-foreground">{MODEL_DISCLOSURE_TIGTA}</p>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id="model-disclosure-consent"
          checked={acknowledged}
          onChange={event => setAcknowledged(event.target.checked)}
          className="mt-1 h-5 w-5"
        />
        <label htmlFor="model-disclosure-consent" className="text-sm text-foreground">{MODEL_DISCLOSURE_CHECKBOX}</label>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="model-disclosure-consent-name" className="text-sm font-medium">{MODEL_DISCLOSURE_NAME_LABEL}</label>
        <input
          id="model-disclosure-consent-name"
          value={signedName}
          autoComplete="off"
          maxLength={200}
          onChange={event => setSignedName(event.target.value)}
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
        />
      </div>
      <p className="text-sm text-muted-foreground">{MODEL_DISCLOSURE_DATE_LABEL}: {date}</p>
      <p className="text-sm text-foreground">{MODEL_DISCLOSURE_LENGTH}</p>
      {message && <p role="alert" className="text-xs text-destructive">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" id="model-disclosure-consent-decline" onClick={decline} className="rounded-lg border border-border px-3 py-2 text-sm">
          {MODEL_DISCLOSURE_DECLINE}
        </button>
        <button type="button" id="model-disclosure-consent-submit" disabled={acceptBody === null} onClick={accept} className="rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">
          {MODEL_DISCLOSURE_SUBMIT}
        </button>
      </div>
    </section>
  );
}

/** Separate screen. Its box starts unchecked, and saving it writes only the reuse record. */
export function ModelReuseConsentScreen({ submit = postConsent }: { submit?: SubmitConsent }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const body = reuseAcceptBody(acknowledged);

  const accept = async () => {
    if (!body) return;
    setMessage(null);
    try { await submit(body); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Consent could not be saved.'); }
  };

  return (
    <section aria-labelledby="model-reuse-consent-title" className="space-y-4 rounded-lg border border-border bg-muted/30 p-3">
      <h2 id="model-reuse-consent-title" className="text-sm font-medium text-foreground">{MODEL_REUSE_TITLE}</h2>
      <p className="text-sm text-foreground">{MODEL_REUSE_REVPROC_5041C}</p>
      <p className="text-sm text-foreground">{MODEL_REUSE_PURPOSE}</p>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id="model-reuse-consent"
          checked={acknowledged}
          onChange={event => setAcknowledged(event.target.checked)}
          className="mt-1 h-5 w-5"
        />
        <label htmlFor="model-reuse-consent" className="text-sm text-foreground">{MODEL_REUSE_CHECKBOX}</label>
      </div>
      {message && <p role="alert" className="text-xs text-destructive">{message}</p>}
      <button type="button" id="model-reuse-consent-submit" disabled={body === null} onClick={accept} className="rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">
        {MODEL_REUSE_SUBMIT}
      </button>
    </section>
  );
}
