import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: vi.fn(async () => ({ ok: false })) }));

import { DocumentImageConsent } from '@/components/document-image-consent';
import { DocumentImageConsentSettings } from '@/components/document-image-consent-settings';
import { DocumentImportScreen } from '@/components/document-import-screen';
import { CONSENT_TERMS_VERSION } from '@/lib/onboarding/consents';
import { DOCUMENT_IMPORT_CONSENT_DATE_BLANK, DOCUMENT_IMPORT_CONSENT_TEXT, DOCUMENT_IMPORT_CONSENT_VERSION } from '@/lib/onboarding/document-import-consent';

const record = { version: CONSENT_TERMS_VERSION, source: 'sign-up', accepted_at: '2026-09-17T12:00:00.000Z', bank_data: true, ai_review: true, communications: false, document_import: false };
const signed = { ...record, document_import: true, document_import_signature: { version: DOCUMENT_IMPORT_CONSENT_VERSION, signed_name: 'Synthetic Signer', signed_at: '2026-09-18T09:00:00.000Z' } };
const today = new Date('2026-09-19T15:00:00.000Z');
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const labelText = (html: string) => unescape(html.match(/<label for="document-image-consent"[^>]*>([\s\S]*?)<\/label>/)![1]);

describe('§7216 document-image consent screen', () => {
  it('uses the drafted consent text verbatim as the checkbox label, with only the date completed', () => {
    const html = renderToStaticMarkup(<DocumentImageConsent record={record} reason="ocr_low_confidence" onAuthorized={() => {}} onCancel={() => {}} today={today} />);
    expect(labelText(html)).toBe(DOCUMENT_IMPORT_CONSENT_TEXT.replace(DOCUMENT_IMPORT_CONSENT_DATE_BLANK, 'September 19, 2026'));
    expect(html).toContain('[type your full name]');
    expect(html).toContain('Date: September 19, 2026');
  });
  it('starts unchecked and unsigned, with the signature field empty and the send button disabled', () => {
    const html = renderToStaticMarkup(<DocumentImageConsent record={record} reason="model_requested_image" onAuthorized={() => {}} onCancel={() => {}} today={today} />);
    expect(html).not.toMatch(/checked=""/);
    expect(html).toMatch(/<input[^>]*id="document-image-consent-name"[^>]*value=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Sign and send the image/);
    expect(html).toContain('Print this consent');
    expect(html).toContain('Cancel');
    expect(html).toContain('Federal law (IRC §7216) requires your signed consent first.');
    expect(html).not.toMatch(/maximi[sz]e|guarantee|file your taxes/i);
  });
  it('shows the signature on file instead of a new signature field when the consent is already signed', () => {
    const html = renderToStaticMarkup(<DocumentImageConsent record={signed} reason="ocr_unavailable" onAuthorized={() => {}} onCancel={() => {}} today={today} />);
    expect(html).toContain('Signed by Synthetic Signer on September 18, 2026');
    expect(html).not.toContain('id="document-image-consent-name"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send the image/);
    expect(labelText(html)).toContain('I, Synthetic Signer, authorize WriteOff');
  });
});

describe('document import copy and settings withdrawal block', () => {
  it('explains the redact-first pipeline on the upload screen without showing the consent until it is needed', () => {
    const html = renderToStaticMarkup(<DocumentImportScreen user={{ id: 'owner' }} onBack={() => {}} />);
    expect(html).toContain('removes Social Security, ITIN and employer identification numbers before sending only that text to OpenAI');
    expect(html).toContain('only with your signed consent');
    expect(html).not.toContain('CONSENT TO DISCLOSURE OF TAX RETURN INFORMATION');
    expect(html).not.toMatch(/AI extracts every field/);
  });
  it('renders the settings block that reports and withdraws the consent', () => {
    const html = renderToStaticMarkup(<DocumentImageConsentSettings userId="owner" />);
    expect(html).toContain('Document image consent (IRC §7216)');
    expect(html).not.toMatch(/maximi[sz]e|guarantee|file your taxes/i);
  });
});
