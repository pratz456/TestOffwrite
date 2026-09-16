/** Explicit, real-provider smoke test against the isolated local Firebase demo only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

if (!process.argv.includes('--run-funded-provider-tests')) throw new Error('Opt in with --run-funded-provider-tests; this makes real AI requests using the local server configuration.');
const project = 'demo-writeoff-security';
const firestore = `http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents`;
const auth = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const app = 'http://127.0.0.1:3000';
const output = process.env.WRITEOFF_AI_SMOKE_OUTPUT || '/tmp/writeoff-ai-native-smoke.json';
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
const email = `ai-smoke-${run}@writeoff.example`;
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
const cases = [
  { id: 'supplies', amount: 63.25, merchant_name: 'Office supply store', business_purpose: 'Printer paper and pens used exclusively for paid client graphic design projects. No personal use or reimbursement.', expectKind: 'expense', expectCategory: 'supplies_small_tools' },
  { id: 'meal', amount: 90, merchant_name: 'Restaurant', business_purpose: 'Dinner meeting with client to discuss their brand design project.', expectKind: 'expense', expectCategory: 'meals_50', unresolved: true },
  { id: 'ambiguous', amount: 78.50, merchant_name: 'Amazon', business_purpose: '', unresolved: true },
  { id: 'vehicle', amount: 48000, merchant_name: 'Car dealer', business_purpose: 'Bought a 7000 pound SUV. I want to write it off.', unresolved: true },
  { id: 'personal', amount: 65, merchant_name: 'Grocery store', business_purpose: 'Groceries for my family at home, entirely personal use.', expectKind: 'personal', expectedDeductible: false },
  { id: 'income', amount: -1200, merchant_name: 'Client invoice 1042', business_purpose: 'Customer payment for completed graphic design work, invoice 1042; no loan or refund.', expectKind: 'income', expectedDeductible: false },
  { id: 'refund', amount: -15, merchant_name: 'Office supply refund', business_purpose: 'Refund for returned printer paper. Original purchase date and tax year not available.', expectKind: 'refund', unresolved: true },
  { id: 'transfer', amount: -500, merchant_name: 'Bank transfer', business_purpose: 'Money moved between my accounts from my own savings account to my own checking account.', expectKind: 'transfer', expectedDeductible: false },
  { id: 'future', amount: 240, merchant_name: 'Design software', business_purpose: 'Annual graphic design software subscription used exclusively for client projects.', date: '2027-02-01', expectCategory: 'software_subscriptions', unresolved: true },
];
const saved = new Map();
try {
  for (const scenario of cases) {
    const path = `${root}/accounts/${account}/transactions/${scenario.id}`;
    const data = { userId: uid, trans_id: scenario.id, account_id: account, merchant_name: scenario.merchant_name, amount: scenario.amount, date: scenario.date || '2026-09-16', category: 'OTHER', business_purpose: scenario.business_purpose, iso_currency_code: 'USD', pending: true, is_deductible: null, source: 'plaid', description: 'Synthetic test record, not a real bank transaction' };
    await write(path, data);
    const taskId = createHash('sha256').update(JSON.stringify([uid, account, scenario.id])).digest('hex');
    await pause(1000);
    assert.equal(await read(`analysis_tasks/${taskId}`), null, 'Pending transaction must wait');
    await write(path, { pending: false }, true);
    let record;
    for (let i = 0; i < 100; i++) {
      record = await read(path);
      if (record.ai_suggestion || record.analysis_status === 'failed') break;
      await pause(1000);
    }
    const suggestion = record.ai_suggestion;
    const task = await read(`analysis_tasks/${taskId}`);
    evidence.cases.push({ id: scenario.id, automatic: true, taskStatus: task?.status, analysisStatus: record.analysis_status, errorCode: record.analysisErrorCode, suggestion });
    await fs.writeFile(output, JSON.stringify(evidence, null, 2), { mode: 0o600 });
    assert.ok(suggestion, `${scenario.id}: no saved AI suggestion (${record.analysisErrorCode || task?.status})`);
    assert.equal(record.is_deductible, null, 'AI must not silently confirm tax decisions');
    assert.ok(suggestion.sources.length > 0, 'Official sources required');
    assert.ok(suggestion.sources.every(source => /^(www\.)?irs\.gov$|^uscode\.house\.gov$/.test(new URL(source.url).hostname)));
    if (scenario.expectKind) assert.equal(suggestion.transactionKind, scenario.expectKind, `${scenario.id}: kind`);
    if (scenario.expectCategory) assert.equal(suggestion.category, scenario.expectCategory, `${scenario.id}: category`);
    if (scenario.unresolved) assert.equal(suggestion.isDeductible, null, `${scenario.id}: must withhold eligibility`);
    if ('expectedDeductible' in scenario) assert.equal(suggestion.isDeductible, scenario.expectedDeductible);
    saved.set(scenario.id, { data, record, path });
    console.log(JSON.stringify({ id: scenario.id, task: task?.status, kind: suggestion.transactionKind, category: suggestion.category, status: suggestion.status, model: suggestion.model }));
  }
  for (const id of ['supplies', 'meal']) {
    const fixture = saved.get(id);
    const response = await api(`/api/transactions/${id}/review`, { action: 'confirm', accountId: account, suggestionId: fixture.record.ai_suggestion.id });
    assert.equal(response.status, 200, `${id}: confirm response`);
    assert.equal(response.data.transaction.review_status, 'confirmed');
    if (id === 'supplies' && fixture.record.ai_suggestion.isDeductible === true) assert.equal(response.data.transaction.is_deductible, true, 'Unchanged supporting profile should permit the reviewed suggestion');
    if (id === 'meal') {
      assert.equal(response.data.transaction.is_deductible, null);
      assert.equal(response.data.transaction.tax_review_required, true);
    }
    const duplicate = await api(`/api/transactions/${id}/review`, { action: 'confirm', accountId: account, suggestionId: fixture.record.ai_suggestion.id });
    assert.equal(duplicate.status, 200, 'Idempotent repeat confirmation');
    evidence.assertions.push(`${id}: confirmed and idempotent; unresolved meal excluded from deductions`);
  }
  const stale = saved.get('vehicle');
  await write(stale.path, { notes: 'New facts arrived after AI analysis' }, true);
  const staleResponse = await api('/api/transactions/vehicle/review', { action: 'confirm', accountId: account, suggestionId: stale.record.ai_suggestion.id });
  assert.equal(staleResponse.status, 409);
  evidence.assertions.push('Changed transaction cannot confirm stale suggestion (409)');
  const manual = saved.get('ambiguous');
  const manualResult = await api('/api/ai/analyze-transaction', { transactionId: 'ambiguous', transaction: manual.data });
  assert.equal(manualResult.status, 200, 'Manual retry must succeed with actual provider');
  assert.ok(manualResult.data.ai_suggestion?.id);
  evidence.assertions.push('Actual manual AI retry works for free user and returns persisted suggestion');
  evidence.success = true;
} catch (error) {
  evidence.success = false;
  evidence.failure = error.message;
  throw error;
} finally {
  evidence.finishedAt = new Date().toISOString();
  await fs.writeFile(output, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(`Evidence saved: ${output}`);
}
