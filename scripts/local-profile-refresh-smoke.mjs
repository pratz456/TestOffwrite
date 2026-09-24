/** Explicit, real-provider smoke test against the isolated local Firebase demo: automatic profile-change refresh only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

if (!process.argv.includes('--run-funded-provider-tests')) throw new Error('Opt in with --run-funded-provider-tests; this makes real AI requests using the local server configuration.');
const project = 'demo-writeoff-security';
const firestore = `http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents`;
const auth = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const app = 'http://127.0.0.1:3000';
const output = process.env.WRITEOFF_PROFILE_REFRESH_SMOKE_OUTPUT || '/tmp/writeoff-profile-refresh-smoke.json';
const run = Date.now().toString();
const account = 'synthetic-bank';
const evidence = { run, checkedAt: new Date().toISOString(), project, cases: [], assertions: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function encode(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, value]) => [k, encode(value)])) } };
}
function decode(v) {
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, value]) => [k, decode(value)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('integerValue' in v) return Number(v.integerValue);
  return v.stringValue ?? v.booleanValue ?? v.doubleValue ?? v.timestampValue;
}
async function authPost(path, body, admin = false) {
  const response = await fetch(auth + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(admin ? { authorization: 'Bearer owner' } : {}) }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, 'Local auth request failed');
  return response.json();
}
async function read(path) {
  const response = await fetch(`${firestore}/${path}`, { headers: { authorization: 'Bearer owner' } });
  if (response.status === 404) { await response.body?.cancel(); return null; }
  assert.equal(response.status, 200);
  return decode({ mapValue: { fields: (await response.json()).fields } });
}
async function write(path, data, merge = false) {
  const query = merge ? '?' + new URLSearchParams(Object.keys(data).map(key => ['updateMask.fieldPaths', key])) : '';
  const response = await fetch(`${firestore}/${path}${query}`, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)])) }) });
  assert.equal(response.status, 200, 'Local fixture write failed');
  await response.arrayBuffer();
}
const email = `profile-refresh-${run}@writeoff.example`;
const password = 'LocalSmoke2026!';
const created = await authPost('/accounts:signUp?key=demo-key', { email, password, returnSecureToken: true });
const uid = created.localId;
await authPost(`/projects/${project}/accounts:update`, { localId: uid, emailVerified: true }, true);
const { idToken } = await authPost('/accounts:signInWithPassword?key=demo-key', { email, password, returnSecureToken: true });
const root = `user_profiles/${uid}`;
await write(root, { userId: uid, name: 'Synthetic AI Smoke', email, profession: 'Graphic designer', state: 'TX', business_entity_type: 'sole_proprietor', subscriptionStatus: 'expired' });
await write(`${root}/accounts/${account}`, { userId: uid, account_id: account, type: 'depository', usageType: 'business', name: 'SYNTHETIC ONLY' });
async function api(path, body) {
  const response = await fetch(app + path, { method: 'POST', headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(100000) });
  const data = await response.json();
  return { status: response.status, data };
}

async function waitFor(check, description) {
  for (let i = 0; i < 120; i++) {
    const result = await check();
    if (result) return result;
    await pause(1000);
  }
  throw new Error(`Timed out: ${description}`);
}
const decisionFields = ['category', 'transaction_kind', 'is_deductible', 'expense_type', 'user_classification_reason', 'deductible_reason', 'review_status', 'review_source', 'review_suggestion_id', 'reviewed_at', 'tax_review_required'];
const decision = record => Object.fromEntries(decisionFields.map(key => [key, record[key]]));
const pathFor = id => `${root}/accounts/${account}/transactions/${id}`;
const initial = new Map();
try {
  for (const id of ['confirmed', 'unreviewed']) {
    await write(pathFor(id), { userId: uid, trans_id: id, account_id: account, amount: 42.75, date: '2026-09-23',
      merchant_name: 'Office supply store', category: 'OTHER', iso_currency_code: 'USD', pending: false,
      is_deductible: null, source: 'plaid', business_purpose: 'Printer paper and pens used exclusively for paid client graphic design projects. No personal use or reimbursement.' });
    const record = await waitFor(async () => {
      const row = await read(pathFor(id));
      return row?.ai_suggestion && row.analysis_status === 'completed' ? row : null;
    }, `initial automatic analysis of ${id}`);
    assert.equal(record.ai_suggestion.status, 'ok');
    initial.set(id, record);
  }
  const confirmation = await api('/api/transactions/confirmed/review', { action: 'confirm', accountId: account, suggestionId: initial.get('confirmed').ai_suggestion.id });
  assert.equal(confirmation.status, 200, JSON.stringify(confirmation.data));
  const savedDecision = decision(await read(pathFor('confirmed')));
  await write(pathFor('pending'), { userId: uid, trans_id: 'pending', account_id: account, amount: 9, date: '2026-09-23',
    merchant_name: 'Pending office purchase', category: 'OTHER', iso_currency_code: 'USD', pending: true, is_deductible: null, source: 'plaid' });
  await waitFor(async () => (await read(`profile_analysis_refresh/${uid}`))?.status === 'completed', 'initial profile scan');
  const oldJob = await read(`profile_analysis_refresh/${uid}`);
  await write(root, { name: 'A different display name', email: `display-${run}@writeoff.example` }, true);
  await pause(2500);
  assert.equal((await read(`profile_analysis_refresh/${uid}`)).generation, oldJob.generation, 'Cosmetic edits must not create a refresh');
  for (const id of initial.keys()) assert.equal((await read(pathFor(id))).ai_suggestion.id, initial.get(id).ai_suggestion.id);
  evidence.assertions.push('Name/email changes do not schedule model work');

  await write(root, { profession: 'Freelance product designer', income: '65000', business_income: 65000 }, true);
  for (const id of initial.keys()) {
    const fresh = await waitFor(async () => {
      const row = await read(pathFor(id));
      return row?.analysis_status === 'completed' && row.ai_suggestion?.id !== initial.get(id).ai_suggestion.id ? row : null;
    }, `profile-triggered reanalysis of ${id}`);
    assert.notEqual(fresh.ai_suggestion.profileHash, initial.get(id).ai_suggestion.profileHash);
    assert.ok(fresh.ai_suggestion.sources.length > 0);
    assert.equal(fresh.analysisRefreshReason, null);
    if (id === 'confirmed') assert.deepEqual(decision(fresh), savedDecision, 'Confirmed decision must be preserved');
    else assert.equal(fresh.is_deductible, null, 'New AI result must not silently confirm');
    evidence.cases.push({ id, model: fresh.ai_suggestion.model, status: fresh.ai_suggestion.status, profileHashChanged: true, suggestionIdChanged: true });
  }
  const completed = await waitFor(async () => {
    const job = await read(`profile_analysis_refresh/${uid}`);
    return job?.status === 'completed' && job.fingerprint !== oldJob.fingerprint ? job : null;
  }, 'durable profile scan completion');
  assert.equal(completed.scanned, 3);
  const progress = await read(`analysis_jobs/${uid}_${account}`);
  assert.equal(progress.total, 2);
  assert.equal(progress.succeeded, 2);
  assert.equal((await read(pathFor('pending'))).ai_suggestion, undefined);
  evidence.assertions.push('A relevant profile change automatically refreshes confirmed and unreviewed transaction suggestions',
    'Latest profile hash and official sources persisted from real OpenAI responses', 'Confirmed classifications remain unchanged',
    'Unreviewed transactions remain unconfirmed', 'Pending bank transactions wait until posted', 'Durable scan completes with two queued records');
  evidence.success = true;
  await fs.writeFile(output, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ success: true, cases: evidence.cases.length, assertions: evidence.assertions.length, output }));
} catch (error) {
  evidence.success = false;
  evidence.error = error instanceof Error ? error.message : String(error);
  await fs.writeFile(output, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  throw error;
}
