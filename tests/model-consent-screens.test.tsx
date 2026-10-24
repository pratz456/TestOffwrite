import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeFirestore, type FakeFirestore } from './fixtures/fake-firestore';
import { ModelDisclosureConsentScreen, ModelReuseConsentScreen } from '@/components/model-consent-screens';
import {
  MODEL_DISCLOSURE_DATA_LIST, MODEL_DISCLOSURE_DATE_LABEL, MODEL_DISCLOSURE_PURPOSE,
  MODEL_DISCLOSURE_RECIPIENT, MODEL_DISCLOSURE_REVPROC_5041A, MODEL_DISCLOSURE_TIGTA, MODEL_REUSE_PURPOSE,
  MODEL_REUSE_REVPROC_5041C, MODEL_REUSE_TITLE, disclosureAcceptBody, disclosureDeclineBody, formatConsentDate,
  reuseAcceptBody,
} from '@/lib/openai/consent-contract';

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

import { GET as readConsent, POST as writeConsent } from '@/app/api/settings/model-consent/route';
import { requireModelConsent } from '@/lib/openai/consent';

const db = () => state.db!;
const today = new Date('2026-10-24T12:00:00.000Z');
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
    const html = renderToStaticMarkup(<ModelDisclosureConsentScreen today={today} />);
    expect(tag(html, 'model-disclosure-consent')).not.toContain('checked');
    expect(tag(html, 'model-disclosure-consent-name')).toContain('value=""');
    expect(tag(html, 'model-disclosure-consent-submit')).toContain('disabled');
    expect(tag(html, 'model-disclosure-consent-decline')).not.toContain('disabled');
    expect(html).toContain(MODEL_DISCLOSURE_RECIPIENT);
    expect(html.match(/OpenAI/g)).toEqual(['OpenAI']);
    expect(html).toContain(MODEL_DISCLOSURE_PURPOSE);
    expect(html).toContain(`${MODEL_DISCLOSURE_DATE_LABEL}: ${formatConsentDate(today)}`);
    expect(html).toContain(MODEL_DISCLOSURE_TIGTA);
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
    expect(reuseAcceptBody(false)).toBeNull();
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
    expect(disclosureAcceptBody(false, 'Synthetic Owner')).toBeNull();
    expect(disclosureAcceptBody(true, '')).toBeNull();
    expect(disclosureAcceptBody(true, '   ')).toBeNull();
    expect(disclosureAcceptBody(true, ' Synthetic Owner ')).toEqual({ action: 'accept', acknowledged: true, signedName: 'Synthetic Owner' });
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

    const accepted = await post({ action: 'accept', acknowledged: true, signedName: ' Synthetic Owner ' });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ status: 'granted', recordType: 'disclosure' });
    expect(db().records.get(disclosurePath)).toMatchObject({ status: 'granted', signedName: 'Synthetic Owner', recordType: 'disclosure' });
    expect(db().records.has(reusePath)).toBe(false);

    const withdrawn = await post({ action: 'withdraw' });
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.json()).toMatchObject({ status: 'withdrawn', recordType: 'disclosure' });
    expect(db().records.has(reusePath)).toBe(false);
  });

  it('keeps reuse off by default and stores an opt in on the reuse document only', async () => {
    const missing = await readConsent(new NextRequest('http://localhost/api/settings/model-consent'));
    expect(missing.status).toBe(200);
    expect(await missing.json()).toMatchObject({ status: 'declined', purposes: [], reuse: { status: 'declined', recordType: null } });

    expect((await post({ action: 'accept_reuse', acknowledged: false })).status).toBe(400);
    expect(db().records.has(reusePath)).toBe(false);

    const reuse = await post({ action: 'accept_reuse', acknowledged: true });
    expect(reuse.status).toBe(200);
    expect(await reuse.json()).toMatchObject({ status: 'granted', recordType: 'reuse' });
    expect(db().records.get(reusePath)).toMatchObject({ status: 'granted', recordType: 'reuse' });
    expect(db().records.has(disclosurePath)).toBe(false);
    await expect(requireModelConsent(state.uid, 'voice_command', new Date())).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });

    const bundle = await readConsent(new NextRequest('http://localhost/api/settings/model-consent'));
    expect(await bundle.json()).toMatchObject({ status: 'declined', recordType: null, reuse: { status: 'granted', recordType: 'reuse' } });
  });
});
