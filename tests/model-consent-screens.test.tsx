import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeFirestore, type FakeFirestore } from './fixtures/fake-firestore';
import { ModelDisclosureConsentScreen, ModelReuseConsentScreen } from '@/components/model-consent-screens';
import {
  MODEL_CONSENT_DATE_LINE, MODEL_CONSENT_SAVE_ERROR, MODEL_CONSENT_STATUS_COPY, MODEL_DISCLOSURE_DATA_LIST, MODEL_DISCLOSURE_LENGTH,
  MODEL_DISCLOSURE_PURPOSE, MODEL_DISCLOSURE_RECIPIENT, MODEL_DISCLOSURE_REVPROC_5041A, MODEL_DISCLOSURE_SCREEN_PURPOSE,
  MODEL_DISCLOSURE_TIGTA, MODEL_PURPOSES, MODEL_REUSE_PURPOSE, MODEL_REUSE_REVPROC_5041C, MODEL_REUSE_TITLE,
  defaultConsentExpiry, disclosureAcceptBody, disclosureDeclineBody, formatConsentDate, modelConsentDateLine, reuseAcceptBody,
} from '@/lib/openai/consent-contract';
import { loadModelConsent } from '@/lib/model-consent/use-model-consent';

const state = vi.hoisted(() => ({
  uid: 'owner-1',
  db: null as FakeFirestore | null,
}));

vi.mock('@/lib/firebase/api-auth', () => ({
  getAuthenticatedUser: async () => ({ user: { uid: state.uid, email: 'owner@example.test', emailVerified: true }, error: null }),
}));
vi.mock('@/lib/firebase/admin', () => {
  const db = createFakeFirestore();
  state.db = db;
  return { adminDb: db };
});
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: vi.fn() }));

import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { GET as readConsent, POST as writeConsent } from '@/app/api/settings/model-consent/route';
import { requireModelConsent } from '@/lib/openai/consent';

const db = () => state.db!;
const today = new Date('2026-10-24T12:00:00.000Z');
const evening = new Date('2026-03-11T03:30:00.000Z');
const zone = 'America/Los_Angeles';
const disclosurePath = 'user_profiles/owner-1/model_consents/disclosure';
const reusePath = 'user_profiles/owner-1/model_consents/reuse';
const tag = (html: string, id: string) => html.match(new RegExp(`<(?:input|button)[^>]*id="${id}"[^>]*>`))?.[0] ?? '';

function post(body: unknown) {
  return writeConsent(new NextRequest('http://localhost/api/settings/model-consent', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  state.uid = 'owner-1';
  db().records.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('disclosure and reuse consent screens', () => {
  it('starts the disclosure box unchecked and the typed name empty', () => {
    const html = renderToStaticMarkup(<ModelDisclosureConsentScreen today={today} timeZone="UTC" />);
    expect(tag(html, 'model-disclosure-consent')).not.toContain('checked');
    expect(tag(html, 'model-disclosure-consent-name')).toContain('value=""');
    expect(tag(html, 'model-disclosure-consent-submit')).toContain('disabled');
    expect(tag(html, 'model-disclosure-consent-decline')).not.toContain('disabled');
    expect(html).toContain(MODEL_DISCLOSURE_RECIPIENT);
    expect(html.match(/OpenAI/g)).toEqual(['OpenAI']);
    expect(html).toContain(MODEL_DISCLOSURE_PURPOSE);
    expect(html).toContain(modelConsentDateLine(today, 'UTC'));
    expect(html).toContain(MODEL_CONSENT_STATUS_COPY.unknown);
    expect(html).toContain('data-consent-screen="disclosure"');
    expect(html).toContain(MODEL_DISCLOSURE_TIGTA);
    expect(html).toContain(MODEL_DISCLOSURE_LENGTH);
    for (const sentence of MODEL_DISCLOSURE_REVPROC_5041A) expect(html).toContain(sentence);
    expect(html).not.toContain(MODEL_REUSE_TITLE);
    expect(html).not.toContain('1-800-366-4484');
    expect(html).not.toContain('Federal law requires this consent form');
  });

  it('keeps reuse on its own screen, off by default', () => {
    const html = renderToStaticMarkup(<ModelReuseConsentScreen />);
    expect(tag(html, 'model-reuse-consent')).not.toContain('checked');
    expect(tag(html, 'model-reuse-consent-submit')).toContain('disabled');
    expect(html).toContain(MODEL_REUSE_REVPROC_5041C);
    expect(html).toContain(MODEL_REUSE_PURPOSE);
    expect(html).not.toContain(MODEL_DISCLOSURE_RECIPIENT);
    expect(html).not.toContain('data-field=');
    expect(html).toContain('data-consent-screen="reuse"');
    expect(html).toContain(MODEL_CONSENT_STATUS_COPY.unknown);
    expect(reuseAcceptBody(false, 'UTC')).toBeNull();
  });

  it('lists disclosure data without an SSN field', () => {
    const html = renderToStaticMarkup(<ModelDisclosureConsentScreen today={today} />);
    const banned = /ssn|social security|taxpayer identification/i;
    expect(MODEL_DISCLOSURE_DATA_LIST.length).toBeGreaterThan(0);
    for (const item of MODEL_DISCLOSURE_DATA_LIST) {
      expect(item.id).not.toMatch(banned);
      expect(item.label).not.toMatch(banned);
      expect(html).toContain(`data-field="${item.id}"`);
    }
    expect(html).not.toMatch(banned);
  });

  it('refuses disclosure unless the box is checked and a name is typed, and decline sends no name', () => {
    expect(disclosureAcceptBody(false, 'Synthetic Owner', MODEL_DISCLOSURE_SCREEN_PURPOSE, zone)).toBeNull();
    expect(disclosureAcceptBody(true, '', MODEL_DISCLOSURE_SCREEN_PURPOSE, zone)).toBeNull();
    expect(disclosureAcceptBody(true, '   ', MODEL_DISCLOSURE_SCREEN_PURPOSE, zone)).toBeNull();
    expect(disclosureAcceptBody(true, ' Synthetic Owner ', MODEL_DISCLOSURE_SCREEN_PURPOSE, zone)).toEqual({
      action: 'accept', acknowledged: true, signedName: 'Synthetic Owner', purpose: MODEL_DISCLOSURE_SCREEN_PURPOSE, timeZone: zone,
    });
    expect(disclosureDeclineBody()).toEqual({ action: 'decline' });
    expect(disclosureDeclineBody()).not.toHaveProperty('signedName');
  });

  it('stores a signed disclosure separately from reuse, and a one tap decline needs no name', async () => {
    for (const body of [
      { action: 'accept', acknowledged: false, signedName: 'Synthetic Owner' },
      { action: 'accept', acknowledged: true, signedName: '   ' },
      { action: 'accept', signedName: 'Synthetic Owner' },
      { action: 'grant', uid: 'someone-else' },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(db().records.has(disclosurePath)).toBe(false);
    expect(db().records.has(reusePath)).toBe(false);

    const declined = await post({ action: 'decline' });
    expect(declined.status).toBe(200);
    expect(await declined.json()).toMatchObject({ status: 'declined' });
    expect(db().records.get(disclosurePath)).toMatchObject({ status: 'declined', recordType: 'disclosure' });
    expect(db().records.get(disclosurePath)).not.toHaveProperty('signedName');
    expect(db().records.has(reusePath)).toBe(false);

    const accepted = await post({ action: 'accept', acknowledged: true, signedName: ' Synthetic Owner ', purpose: MODEL_DISCLOSURE_SCREEN_PURPOSE, timeZone: 'UTC' });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ status: 'granted', recordType: 'disclosure', purposes: [MODEL_DISCLOSURE_SCREEN_PURPOSE] });
    expect(db().records.get(disclosurePath)).toMatchObject({ status: 'granted', signedName: 'Synthetic Owner', recordType: 'disclosure', consentLength: MODEL_DISCLOSURE_LENGTH, purposes: [MODEL_DISCLOSURE_SCREEN_PURPOSE], timeZone: 'UTC' });
    const stored = db().records.get(disclosurePath)!;
    expect(stored.expiresAt).toBeInstanceOf(Date);
    expect((stored.expiresAt as Date).getTime()).toBe(defaultConsentExpiry(stored.signedAt as Date, 'UTC').getTime());
    expect(stored.purposes).not.toEqual([...MODEL_PURPOSES]);
    expect(db().records.has(reusePath)).toBe(false);

    const withdrawn = await post({ action: 'withdraw' });
    expect(withdrawn.status).toBe(200);
    const withdrawnBody = await withdrawn.json();
    expect(withdrawnBody).toMatchObject({ status: 'withdrawn', recordType: 'disclosure' });
    expect(JSON.stringify(withdrawnBody)).not.toMatch(/301\.7216|Rev\. Proc/);
    expect(db().records.has(reusePath)).toBe(false);
  });

  it('keeps reuse off by default and stores an opt in on the reuse document only', async () => {
    const missing = await readConsent(new NextRequest('http://localhost/api/settings/model-consent'));
    expect(missing.status).toBe(200);
    expect(await missing.json()).toMatchObject({ status: 'declined', purposes: [], reuse: { status: 'declined', recordType: null } });

    expect((await post({ action: 'accept_reuse', acknowledged: false })).status).toBe(400);
    expect(db().records.has(reusePath)).toBe(false);

    const reuse = await post({ action: 'accept_reuse', acknowledged: true, timeZone: 'UTC' });
    expect(reuse.status).toBe(200);
    expect(await reuse.json()).toMatchObject({ status: 'granted', recordType: 'reuse' });
    expect(db().records.get(reusePath)).toMatchObject({ status: 'granted', recordType: 'reuse' });
    expect(db().records.has(disclosurePath)).toBe(false);
    await expect(requireModelConsent(state.uid, 'voice_command', new Date())).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });

    const bundle = await readConsent(new NextRequest('http://localhost/api/settings/model-consent'));
    expect(await bundle.json()).toMatchObject({ status: 'declined', recordType: null, reuse: { status: 'granted', recordType: 'reuse' } });
  });

  it('shows 8:30 PM America/Los_Angeles as that same local day and expires one year from it', async () => {
    const html = renderToStaticMarkup(<ModelDisclosureConsentScreen today={evening} timeZone={zone} />);
    expect(formatConsentDate(evening, zone)).toBe('March 10, 2026');
    expect(formatConsentDate(evening, 'UTC')).toBe('March 11, 2026');
    expect(html).toContain(modelConsentDateLine(evening, zone));
    expect(html).toContain('March 10, 2026');
    expect(html).not.toContain('March 11, 2026');
    expect(html).not.toContain(`${MODEL_CONSENT_DATE_LINE}:`);
    expect(MODEL_CONSENT_SAVE_ERROR.startsWith('[PLACEHOLDER]')).toBe(true);

    vi.useFakeTimers();
    vi.setSystemTime(evening);
    const accepted = await post({
      action: 'accept', acknowledged: true, signedName: 'Synthetic Owner', purpose: MODEL_DISCLOSURE_SCREEN_PURPOSE, timeZone: zone,
    });
    expect(accepted.status).toBe(200);
    const stored = db().records.get(disclosurePath)!;
    expect((stored.signedAt as Date).toISOString()).toBe(evening.toISOString());
    expect(stored.timeZone).toBe(zone);
    const expiry = defaultConsentExpiry(evening, zone);
    expect((stored.expiresAt as Date).toISOString()).toBe(expiry.toISOString());
    expect(expiry.toISOString()).not.toBe(defaultConsentExpiry(evening).toISOString());
    expect(formatConsentDate(stored.signedAt as Date, String(stored.timeZone))).toBe('March 10, 2026');
    vi.useRealTimers();
  });

  it('grants only the purpose the disclosure screen names and refuses the other eight', async () => {
    const accepted = await post({
      action: 'accept', acknowledged: true, signedName: 'Synthetic Owner', purpose: MODEL_DISCLOSURE_SCREEN_PURPOSE, timeZone: 'UTC',
    });
    expect(accepted.status).toBe(200);
    const now = new Date();
    await expect(requireModelConsent(state.uid, MODEL_DISCLOSURE_SCREEN_PURPOSE, now)).resolves.toMatchObject({ purposes: [MODEL_DISCLOSURE_SCREEN_PURPOSE] });
    const others = MODEL_PURPOSES.filter(purpose => purpose !== MODEL_DISCLOSURE_SCREEN_PURPOSE);
    expect(others).toHaveLength(8);
    for (const purpose of others) {
      await expect(requireModelConsent(state.uid, purpose, now)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED', reason: 'purpose' });
    }
  });

  it('reads GET status and keeps disclosure and reuse on different routes', async () => {
    const request = makeAuthenticatedRequest as unknown as ReturnType<typeof vi.fn>;
    request.mockResolvedValue(new Response(JSON.stringify({
      status: 'granted', purposes: [MODEL_DISCLOSURE_SCREEN_PURPOSE], reuse: { status: 'declined', purposes: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(loadModelConsent()).resolves.toMatchObject({ status: 'granted', reuse: { status: 'declined' } });
    const root = path.resolve(__dirname, '..');
    const settings = readFileSync(path.join(root, 'components/settings-screen.tsx'), 'utf8');
    const disclosurePage = readFileSync(path.join(root, 'app/protected/settings/model-disclosure/page.tsx'), 'utf8');
    const reusePage = readFileSync(path.join(root, 'app/protected/settings/model-reuse/page.tsx'), 'utf8');
    const screenSource = readFileSync(path.join(root, 'components/model-consent-screens.tsx'), 'utf8');
    expect(settings).not.toContain('<ModelDisclosureConsentScreen');
    expect(settings).not.toContain('<ModelReuseConsentScreen');
    expect(disclosurePage).toContain('<ModelDisclosureConsentScreen');
    expect(disclosurePage).not.toContain('ModelReuseConsentScreen');
    expect(reusePage).toContain('<ModelReuseConsentScreen');
    expect(reusePage).not.toContain('ModelDisclosureConsentScreen');
    expect(screenSource).toContain('useModelConsent');
    expect(screenSource).not.toContain('Consent could not be saved.');
    expect(screenSource).not.toContain('DATE_LABEL}:');
  });
});
