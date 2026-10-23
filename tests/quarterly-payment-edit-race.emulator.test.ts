/**
 * Two overlapping edits of one legacy payment, against the local Firestore emulator.
 * WRITEOFF_RULES_EMULATOR_TESTS=1 npx vitest run tests/quarterly-payment-edit-race.emulator.test.ts
 * Defaults: Firestore 127.0.0.1:8180, Auth 127.0.0.1:9099, project demo-writeoff-security.
 * Skipped unless that gate is exactly "1". It does not change security rules and
 * deletes only the synthetic user created for this file.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const enabled = process.env.WRITEOFF_RULES_EMULATOR_TESTS === '1';
const projectId = process.env.WRITEOFF_RULES_PROJECT_ID || 'demo-writeoff-security';
const firestorePort = Number(process.env.WRITEOFF_RULES_FIRESTORE_PORT || 8180);
const authPort = Number(process.env.WRITEOFF_RULES_AUTH_PORT || 9099);
if (enabled && (!/^demo-[a-z0-9-]+$/.test(projectId) ||
    [firestorePort, authPort].some(port => !Number.isInteger(port) || port < 1024 || port > 65535))) {
  throw new Error('Payment edit race tests require a demo project and valid local emulator ports.');
}
if (enabled) {
  process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${firestorePort}`;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${authPort}`;
  process.env.GCLOUD_PROJECT = projectId;
  process.env.GOOGLE_CLOUD_PROJECT = projectId;
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
}

const email = 'planner-edit-race@writeoff.example';
const password = 'LocalDemo2026!';
const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let uid = '';
let token = '';
let POST: typeof import('../app/api/tax/quarterly-payments/route').POST;
let getRecordedQuarterlyPayments: typeof import('../lib/firebase/quarterly-payments-server').getRecordedQuarterlyPayments;
let totalRecordedPayments: typeof import('../lib/firebase/quarterly-payments-server').totalRecordedPayments;

function authRequest(route: string, data: unknown, admin = false) {
  return fetch(`http://127.0.0.1:${authPort}/identitytoolkit.googleapis.com/v1${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(admin ? { authorization: 'Bearer owner' } : {}) },
    body: JSON.stringify(data),
  });
}

async function clearPayments() {
  const prefix = `http://127.0.0.1:${firestorePort}/v1/projects/${projectId}/databases/(default)/documents/user_profiles/${uid}/quarterly_payments`;
  const listed = await fetch(prefix, { headers: { authorization: 'Bearer owner' } });
  if (listed.status === 404) return;
  expect(listed.status).toBe(200);
  const body = await listed.json() as { documents?: { name: string }[] };
  await Promise.all((body.documents ?? []).map(document => fetch(`http://127.0.0.1:${firestorePort}/v1/${document.name.replace(/^projects\//, 'projects/')}`, {
    method: 'DELETE', headers: { authorization: 'Bearer owner' },
  })));
}

(enabled ? describe : describe.skip)('concurrent legacy payment edits on the Firestore emulator', () => {
  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let created = await authRequest('/accounts:signUp?key=demo-key', { email, password, returnSecureToken: true });
    if (created.status !== 200) {
      created = await authRequest('/accounts:signInWithPassword?key=demo-key', { email, password, returnSecureToken: true });
    }
    expect(created.status).toBe(200);
    const account = await created.json() as { localId: string; idToken: string };
    uid = account.localId;
    token = account.idToken;
    const verified = await authRequest(`/projects/${projectId}/accounts:update`, { localId: uid, emailVerified: true }, true);
    expect(verified.status).toBe(200);
    const signedIn = await authRequest('/accounts:signInWithPassword?key=demo-key', { email, password, returnSecureToken: true });
    expect(signedIn.status).toBe(200);
    token = (await signedIn.json() as { idToken: string }).idToken;
    ({ POST } = await import('../app/api/tax/quarterly-payments/route'));
    ({ getRecordedQuarterlyPayments, totalRecordedPayments } = await import('../lib/firebase/quarterly-payments-server'));
    await clearPayments();
  });

  afterAll(async () => {
    if (uid) await clearPayments();
    vi.restoreAllMocks();
  });

  it('lets one overlapping edit win and counts that amount once', async () => {
    const legacy = await fetch(`http://127.0.0.1:${firestorePort}/v1/projects/${projectId}/databases/(default)/documents/user_profiles/${uid}/quarterly_payments/Q1_2026`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
      body: JSON.stringify({ fields: {
        quarter: { integerValue: '1' }, year: { integerValue: '2026' },
        paidAmount: { integerValue: '2125' }, paidDate: { stringValue: '2026-04-01' },
        estimatedAmount: { integerValue: '0' },
      } }),
    });
    expect(legacy.status).toBe(200);
    const post = (paymentId: string, paidAmount: number) => POST(new NextRequest('http://127.0.0.1/api/tax/quarterly-payments', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ recordId: 'Q1_2026', paymentId, quarter: 1, year: 2026, paidAmount, paidDate: '2026-04-20' }),
    }));
    const [first, second] = await Promise.all([post(idA, 1800), post(idB, 900)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const rejected = [first, second].find(response => response.status === 409);
    expect(await rejected?.json()).toMatchObject({ error: 'Another edit already saved this payment. Your change wasn\'t saved.' });
    const winner = [first, second].find(response => response.status === 200);
    const winnerBody = await winner?.json() as { paidAmount: number };
    const saved = await getRecordedQuarterlyPayments(uid, 2026);
    const active = saved.filter(payment => payment.paidAmount > 0);
    expect(active).toHaveLength(1);
    expect(totalRecordedPayments(saved)).toBe(winnerBody.paidAmount);
    expect([1800, 900]).toContain(winnerBody.paidAmount);
  }, 20000);
});
