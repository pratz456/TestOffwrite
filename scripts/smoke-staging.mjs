/** Real Firebase staging checks. Uses only newly created synthetic accounts.
 * Stripe and Plaid are intentionally excluded until test credentials are configured.
 * Run from this worktree: node scripts/smoke-staging.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const projectId = 'writeoff-production-testing';
const base = `https://${projectId}.web.app`;
const env = require('dotenv').parse(await fs.readFile(`${root}.env.local`));
assert.equal(env.WRITEOFF_ENV, 'staging');
assert.equal(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, projectId);
assert.equal(env.NEXT_PUBLIC_SITE_URL, base);
const cliAuth = require('firebase-tools/lib/auth');
const account = cliAuth.getGlobalDefaultAccount();
assert.ok(account, 'Sign in to Firebase CLI before running staging checks');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const app = initializeApp({ projectId, credential: { getAccessToken: async () => {
  const token = await cliAuth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  return { access_token: token.access_token, expires_in: 3600 };
} } }, 'staging-smoke');
const auth = getAuth(app);
const db = getFirestore(app);
const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: String(error.message).slice(0, 400) }); }
  console.log(`${results.at(-1).passed ? 'PASS' : 'FAIL'} ${name}`);
}
async function request(route, { method = 'GET', body, token, cookie, headers = {} } = {}) {
  assert.ok(route.startsWith('/') && !route.startsWith('//'));
  const response = await fetch(`${base}${route}`, { method, redirect: 'manual', signal: AbortSignal.timeout(60000),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}),
      ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  let data; try { data = JSON.parse(bytes.toString()); } catch { data = null; }
  return { response, bytes, data };
}
function status(result, expected) {
  assert.ok([expected].flat().includes(result.response.status), `Expected ${expected}; got ${result.response.status}; ${JSON.stringify(result.data)?.slice(0, 220)}`);
}
async function makeUser(role) {
  const uid = `staging-smoke-${role}-${randomUUID()}`;
  const email = `${uid}@example.com`;
  const password = `${randomUUID()}-Synthetic!`;
  await auth.createUser({ uid, email, password, emailVerified: role !== 'unverified', displayName: 'Synthetic staging test' });
  const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await signIn.json();
  assert.equal(signIn.status, 200, `Staging email sign-in failed: ${data.error?.message}`);
  return { uid, email, password, token: data.idToken };
}

const owner = await makeUser('owner');
const other = await makeUser('other');
const unverified = await makeUser('unverified');
await fs.writeFile('/tmp/writeoff-staging-smoke-accounts.json', JSON.stringify({ projectId, owner, other, unverified }), { mode: 0o600 });
await check('unverified email cannot open account API', async () => status(await request('/api/user/profile', { token: unverified.token }), 401));
await check('fresh verified account has no profile', async () => {
  const r = await request('/api/user/profile', { token: owner.token }); status(r, 200); assert.equal(r.data.profile, null);
});
const profile = { name: 'Synthetic staging test', email: owner.email, profession: 'Designer', business_entity_type: 'sole_proprietor',
  income: '100000', state: 'TX', filing_status: 'single', onboardingIntroCompleted: true, onboardingPlaidGuideCompleted: true };
await check('save onboarding profile', async () => status(await request('/api/database/profiles', { method: 'POST', token: owner.token, body: profile }), 200));
await check('profile rejects subscription escalation', async () => status(await request('/api/database/profiles', { method: 'POST', token: owner.token, body: { subscriptionStatus: 'active' } }), 400));
let cookie;
await check('verified login creates secure session cookie', async () => {
  const r = await request('/api/auth/session', { method: 'POST', body: { idToken: owner.token }, headers: { origin: base } });
  status(r, 200); const setCookie = r.response.headers.get('set-cookie');
  assert.match(setCookie || '', /__session=/); assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /Secure/i);
  cookie = setCookie.match(/__session=([^;]+)/)?.[0]; assert.ok(cookie);
});
await check('session cookie reads correct profile after reload', async () => {
  assert.ok(cookie); const r = await request('/api/user/profile', { cookie }); status(r, 200); assert.equal(r.data.profile.id, owner.uid);
});
await check('cross-site cookie mutation rejected', async () => {
  assert.ok(cookie); status(await request('/api/database/profiles', { method: 'POST', cookie, body: { name: 'Must not save' }, headers: { origin: 'https://example.net', 'sec-fetch-site': 'cross-site' } }), [401, 403]);
});
let incomeId;
await check('manual income saves without a linked bank', async () => {
  const r = await request('/api/transactions/manual', { method: 'POST', token: owner.token, body: { merchant_name: 'Synthetic client', amount: 100000, date: '2026-09-01', type: 'income' } });
  status(r, 201); incomeId = r.data.id; assert.ok(incomeId);
});
await check('another account cannot read the transaction', async () => {
  assert.ok(incomeId); status(await request(`/api/transactions/${incomeId}`, { token: other.token }), [403, 404]);
});
await check('free account cannot export', async () => status(await request('/api/transactions/export-csv', { token: owner.token }), 403));
// This changes only the synthetic test fixture; it does not simulate Stripe verification.
await db.doc(`user_profiles/${owner.uid}`).set({ subscriptionStatus: 'trial', trialStart: new Date(), trialEnd: new Date(Date.now() + 86400000), hasHistoricalAccess: true }, { merge: true });
await check('trial account can export CSV', async () => {
  const r = await request('/api/transactions/export-csv', { token: owner.token }); status(r, 200); assert.match(r.response.headers.get('content-type') || '', /csv/); assert.match(r.bytes.toString(), /Synthetic client/);
});
let receiptUrl;
await check('new account can save a receipt with manually confirmed fields', async () => {
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64');
  const form = new FormData(); form.set('file', new Blob([image], { type: 'image/png' }), 'synthetic-receipt.png');
  form.set('mode', 'commit'); form.set('receiptType', 'expense');
  form.set('receiptData', JSON.stringify({ merchant: 'Synthetic supplies', amount: 25, date: '2026-09-02', category: 'office_expense' }));
  const r = await request('/api/receipts/process', { method: 'POST', token: other.token, body: form }); status(r, 200);
  const receipts = await db.collection('receipts').where('userId', '==', other.uid).get();
  assert.equal(receipts.size, 1); const receipt = receipts.docs[0];
  assert.ok(receipt.data().storagePath); assert.ok(!receipt.data().image && !receipt.data().base64);
  receiptUrl = `/api/receipts/${receipt.id}`;
});
await check('receipt owner can retrieve private image', async () => {
  assert.ok(receiptUrl); const r = await request(receiptUrl, { token: other.token }); status(r, 200);
  assert.match(r.response.headers.get('content-type') || '', /image\/png/); assert.match(r.response.headers.get('cache-control') || '', /private.*no-store/);
});
await check('receipt denied to another user and anonymous visitor', async () => {
  assert.ok(receiptUrl); status(await request(receiptUrl, { token: owner.token }), [403, 404]); status(await request(receiptUrl), 401);
});
await check('2027 calculation is rejected', async () => status(await request('/api/tax/compute-1040?year=2027', { token: owner.token }), [400, 422]));
await check('staging pages and resource are available without production analytics', async () => {
  for (const route of ['/', '/auth/login', '/resources/freelance-expense-reset']) {
    const r = await request(route); status(r, 200); assert.match(r.response.headers.get('x-robots-tag') || '', /noindex/);
    assert.ok(!r.bytes.toString().includes('gtag/js?id=G-1P3GNBHB9J'));
  }
});
await check('robots prevents staging indexing', async () => {
  const r = await request('/robots.txt'); status(r, 200); assert.match(r.bytes.toString(), /Disallow: \/(?:\s|$)/);
});
const report = { checkedAt: new Date().toISOString(), projectId, base, passed: results.filter(x => x.passed).length,
  failed: results.filter(x => !x.passed).length, results, pending: ['Stripe test-mode checkout/webhooks', 'Plaid Sandbox linking/import', 'Fresh Google OAuth login', 'Browser onboarding and receipt editing', 'Broad tax-scope validation'] };
await fs.writeFile('/tmp/writeoff-staging-smoke-results.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, report: '/tmp/writeoff-staging-smoke-results.json' }));
process.exitCode = report.failed ? 1 : 0;
