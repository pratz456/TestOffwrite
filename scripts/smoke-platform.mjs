/**
 * HTTP smoke checks against a LOCAL production build and synthetic Firebase emulators.
 * Does not call paid providers or use production records. See the report for setup.
 * Usage: node scripts/smoke-platform.mjs http://127.0.0.1:3100 [public|authenticated|all]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = new URL(process.argv[2] || 'http://127.0.0.1:3100');
const mode = process.argv[3] || 'all';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:' || !['public', 'authenticated', 'all'].includes(mode)) {
  throw new Error('Smoke tests may run only against an HTTP loopback app and a supported mode.');
}
const project = 'demo-writeoff-security';
const authBase = 'http://127.0.0.1:9099';
const dbBase = `http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents`;
const results = [];
let sequence = 0;
async function check(name, fn) {
  const start = Date.now();
  try { await fn(); results.push({ name, passed: true, durationMs: Date.now() - start }); }
  catch (error) { results.push({ name, passed: false, durationMs: Date.now() - start, error: String(error.message).slice(0, 550) }); }
}
// x-forwarded-proto models the production TLS proxy; local socket remains HTTP.
async function request(route, { method = 'GET', body, token, cookie, headers = {} } = {}) {
  sequence += 1;
  const response = await fetch(new URL(route, base), {
    method, redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': `127.1.${Math.floor(sequence / 250)}.${sequence % 250 + 1}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = null; }
  return { response, text, data };
}
function status(result, expected) { assert.ok([expected].flat().includes(result.response.status), `Expected ${JSON.stringify(expected)}, got ${result.response.status}: ${result.text.slice(0, 250)}`); }
async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : path.join(directory, entry.name)))).flat();
}
const appFiles = await walk(path.join(root, 'app'));
const sourceApis = [];
for (const file of appFiles.filter(file => file.endsWith('/route.ts'))) {
  const code = await fs.readFile(file, 'utf8');
  const route = path.dirname(file).slice(path.join(root, 'app').length).replace(/\[\.\.\.legacyPath\]/g, 'smoke/legacy/missing.png').replace(/\[[^\]]+\]/g, 'smoke-missing');
  for (const match of code.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g)) sourceApis.push({ route, method: match[1] });
}
if (mode !== 'authenticated') {
  const pages = appFiles.filter(file => /\/page\.[jt]sx?$/.test(file));
  for (const file of pages) {
    let route = path.dirname(file).slice(path.join(root, 'app').length) || '/';
    route = route.replace('[slug]', 'crypto-taxes-freelancers-guide').replace(/\[[^\]]+\]/g, 'smoke-missing');
    await check(`page GET ${route}`, async () => {
      const result = await request(route);
      status(result, route === '/login' ? [302, 307, 308] : [200, 302, 307]);
      if (result.response.status === 200) {
        assert.match(result.text, /<html/i);
        assert.ok(!/NEXT_HTTP_ERROR_FALLBACK;500/.test(result.text), 'Server-rendered error shell');
      }
      if (result.response.status === 200) assert.equal(result.response.headers.get('x-content-type-options'), 'nosniff');
    });
  }
  const publicRoutes = new Map([
    ['POST /api/auth/session', [400]], ['POST /api/auth/logout', [200]],
    ['POST /api/contact', [400]], ['POST /api/stripe/webhook', [400, 503]],
    ['POST /api/plaid/webhook', [401]], ['GET /api/plaid/webhook', [200]],
  ]);
  for (const { route, method } of sourceApis) {
    await check(`anonymous ${method} ${route}`, async () => {
      const result = await request(route, { method, ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? { body: {} } : {}) });
      status(result, publicRoutes.get(`${method} ${route}`) || [401, 403]);
      assert.match(result.response.headers.get('cache-control') || '', /no-store/);
      if (!publicRoutes.has(`${method} ${route}`)) assert.ok(result.data?.error || result.data?.success === false, 'Auth rejection should include a usable JSON error');
    });
  }
  await check('unknown page uses 404', async () => status(await request('/smoke-does-not-exist'), 404));
  await check('blocked environment path uses 404', async () => status(await request('/.env'), 404));
}

function firestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, firestoreValue(entry)])) } };
}
async function seed(document, values) {
  const response = await fetch(`${dbBase}/${document}`, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, firestoreValue(value)])) }), signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, 'Synthetic fixture could not be written to the emulator');
}
async function makeUser(name, profile = {}) {
  const email = `smoke-${name}-${Date.now()}@example.invalid`;
  const response = await fetch(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'SyntheticSmokeOnly-2026!', returnSecureToken: true }), signal: AbortSignal.timeout(10000) });
  const data = await response.json(); assert.equal(response.status, 200, 'Synthetic Auth signup failed');
  const verified = await fetch(`${authBase}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts:update`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ localId: data.localId, emailVerified: true }) });
  assert.equal(verified.status, 200, 'Synthetic email verification failed');
  const signedIn = await fetch(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'SyntheticSmokeOnly-2026!', returnSecureToken: true }) });
  assert.equal(signedIn.status, 200, 'Synthetic verified sign-in failed');
  const signedInData = await signedIn.json();

  await seed(`user_profiles/${data.localId}`, { userId: data.localId, name: `Smoke ${name}`, email, profession: 'Designer', business_entity_type: 'sole_proprietor', income: '100000', state: 'TX', filing_status: 'single', onboardingIntroCompleted: true, onboardingPlaidGuideCompleted: true, subscriptionStatus: 'trial', trialStart: new Date(Date.now() - 86400000), trialEnd: new Date(Date.now() + 7 * 86400000), hasHistoricalAccess: true, ...profile });
  return { uid: data.localId, token: signedInData.idToken };
}
// Explicit declarations for synthetic adults only; never application defaults.
function reviewedPersonalDeductionAnswers(taxYear = 2026) {
  return {
    taxYear, filingStatus: 'single', dateOfBirth: '1990-05-20', dependents: '0',
    personalDeductionFacts: JSON.stringify({
      version: 1, taxYear, ordinaryScope: 'yes', taxpayerBlind: 'no', taxpayerDependent: 'no',
      spouseBlind: 'no', spouseDependent: 'no', mfsSpouseItemizes: 'no', mfsSpouseAdditionalEligible: 'no',
      taxpayerSeniorSSN: 'yes', spouseSeniorSSN: 'yes', seniorHasAddbacks: 'no',
    }),
  };
}
function reviewRequired(result, code) {
  status(result, 422);
  assert.equal(result.data?.code, code);
  assert.equal(typeof result.data?.error, 'string');
  assert.match(result.data.error, /Tax Organizer/);
  assert.deepEqual(Object.keys(result.data).sort(), ['code', 'error']);
  assert.match(result.response.headers.get('content-type') || '', /application\/json/);
}
if (mode !== 'public') {
  // The Auth emulator's config endpoint is a hard precondition, not a production fallback.
  const emulator = await fetch(`${authBase}/emulator/v1/projects/${project}/config`, { signal: AbortSignal.timeout(5000) });
  assert.equal(emulator.status, 200, 'Auth emulator must be running');
  const owner = await makeUser('owner');
  const other = await makeUser('other');
  const readOnlyRoutes = [
    '/api/accounts', '/api/database/accounts', '/api/database/transactions', '/api/transactions/paginated?limit=25',
    '/api/transactions/analysis-status', '/api/analysis-status', '/api/monthly-deductions?year=2026', '/api/tax-savings?year=2026',
    '/api/categories', '/api/income/1099?year=2026', '/api/income/gross-receipts?year=2026',
    '/api/tax/deductions?year=2026', '/api/tax/organizer?year=2026', '/api/tax/year-lock?year=2026',
    '/api/tax/schedule-se/auto?year=2026', '/api/tax/schedule-c/calculate?year=2026', '/api/tax/form-8879?year=2026',
    '/api/settings/tax-summary', '/api/plaid/items', '/api/plaid/import-status',
  ];
  for (const route of readOnlyRoutes) {
    await check(`signed-in initial state GET ${route}`, async () => {
      const result = await request(route, { token: owner.token }); status(result, 200); assert.ok(result.data !== null);
    });
  }
  const annualTaxRoutes = [
    { route: '/api/tax/compute-1040?year=2026' },
    { route: '/api/tax/quarterly-reminders?year=2026' },
    { route: '/api/tax/form-1040', method: 'POST', body: { year: 2026 } },
  ];
  for (const { route, ...options } of annualTaxRoutes) {
    await check(`missing personal facts withhold totals/PDF: ${route}`, async () => {
      reviewRequired(await request(route, { ...options, token: owner.token }), 'PERSONAL_DEDUCTION_REVIEW_REQUIRED');
    });
  }
  await check('explicit synthetic personal facts save/read and unlock the supported annual estimate', async () => {
    const answers = reviewedPersonalDeductionAnswers();
    const saved = await request('/api/tax/organizer', { method: 'POST', token: owner.token, body: answers }); status(saved, [200, 201]);
    const loaded = await request('/api/tax/organizer?year=2026', { token: owner.token }); status(loaded, 200);
    assert.equal(loaded.data.organizer.personalDeductionFacts, answers.personalDeductionFacts);
    const annual = await request('/api/tax/compute-1040?year=2026', { token: owner.token }); status(annual, 200);
    assert.equal(annual.data.form1040.standardDeduction, 16100);
    assert.equal(annual.data.form1040.enhancedSeniorDeduction, 0);
  });
  const dependentOwner = await makeUser('dependent-review');
  await seed(`tax_organizers/credit-review-${dependentOwner.uid}`, { ...reviewedPersonalDeductionAnswers(), userId: dependentOwner.uid, dependents: '1', dependentDetails: 'Synthetic dependent parent, age78; qualifying-child facts unavailable' });
  await seed(`gross_receipts/credit-review-${dependentOwner.uid}`, { userId: dependentOwner.uid, taxYear: 2026, date: '2026-01-15', amount: 20000 });
  for (const { route, ...options } of annualTaxRoutes) {
    await check(`dependent parent withholds unsupported credits/totals/PDF: ${route}`, async () => {
      reviewRequired(await request(route, { ...options, token: dependentOwner.token }), 'DEPENDENT_CREDIT_REVIEW_REQUIRED');
    });
  }
  // A zero dependent count still does not establish the remaining EITC facts.
  // Reuse the same synthetic20k income fixture; never affect the normal owner.
  await seed(`tax_organizers/credit-review-${dependentOwner.uid}`, { ...reviewedPersonalDeductionAnswers(), userId: dependentOwner.uid });
  for (const { route, ...options } of annualTaxRoutes) {
    await check(`positive no-child EITC requires eligibility review: ${route}`, async () => {
      reviewRequired(await request(route, { ...options, token: dependentOwner.token }), 'DEPENDENT_CREDIT_REVIEW_REQUIRED');
    });
  }
  let sessionCookie;
  await check('Auth emulator token creates a real Firebase server session', async () => {
    const result = await request('/api/auth/session', { method: 'POST', body: { idToken: owner.token } });
    status(result, 200); assert.equal(result.data?.success, true);
    const headers = result.response.headers.getSetCookie();
    assert.ok(headers.some(cookie => cookie.startsWith('__session=') && /HttpOnly/i.test(cookie)));
    sessionCookie = headers.find(cookie => cookie.startsWith('__session='))?.split(';')[0];
    assert.ok(sessionCookie);
  });
  await check('ID-token authenticated transaction read returns only owner data', async () => {
    const result = await request('/api/transactions?year=2026', { token: owner.token });
    status(result, 200); assert.deepEqual(result.data.transactions, []);
  });
  await check('session-cookie authenticated API read succeeds without bearer token', async () => {
    assert.ok(sessionCookie, 'Session creation failed');
    status(await request('/api/transactions?year=2026', { cookie: sessionCookie }), 200);
  });
  await check('forged ID token is rejected', async () => status(await request('/api/transactions', { token: 'not.a.valid.token' }), 401));
  await check('cross-user mileage reads are rejected', async () => status(await request(`/api/mileage?userId=${other.uid}&year=2026`, { token: owner.token }), 403));
  await check('quarterly payment record survives estimate update and is isolated by user', async () => {
    status(await request('/api/tax/quarterly-payments', { method: 'POST', token: owner.token, body: { quarter: 3, year: 2026, paidAmount: 123.45, paidDate: '2026-09-15', confirmationNumber: 'SYNTHETIC-ONLY' } }), 200);
    status(await request('/api/tax/quarterly-payments', { method: 'PUT', token: owner.token, body: { quarter: 3, year: 2026, estimatedAmount: 120 } }), 200);
    const own = await request('/api/tax/quarterly-payments?year=2026', { token: owner.token }); status(own, 200);
    const records = Array.isArray(own.data) ? own.data : own.data.payments;
    assert.equal(records.find(payment => payment.quarter === 3).paidAmount, 123.45);
    assert.equal(records.find(payment => payment.quarter === 3).status, 'recorded');
    assert.equal(own.data.summary.totalPenalty, null);
    assert.equal(own.data.summary.reviewRequired, true);
    const foreign = await request('/api/tax/quarterly-payments?year=2026', { token: other.token }); status(foreign, 200);
    assert.equal((Array.isArray(foreign.data) ? foreign.data : foreign.data.payments).find(payment => payment.quarter === 3).paidAmount, 0);
  });
  await check('W-2 save/read/delete preserves amounts and owner boundary', async () => {
    const saved = await request('/api/income/w2', { method: 'POST', token: owner.token, body: { taxYear: 2026, employer: 'Synthetic employer', wages: 100000, federalWithheld: 12000, socialSecurityWages: 100000, medicareWages: 100000 } });
    status(saved, 201); assert.ok(saved.data.id);
    const loaded = await request('/api/income/w2?year=2026', { token: owner.token }); status(loaded, 200);
    assert.equal(loaded.data.totalWages, 100000); assert.equal(loaded.data.totalWithheld, 12000);
    status(await request(`/api/income/w2?id=${saved.data.id}`, { method: 'DELETE', token: other.token }), 403);
    const calculated = await request('/api/tax/compute-1040?year=2026', { token: owner.token }); status(calculated, 200); assert.equal(calculated.data.taxYear, 2026);
    status(await request(`/api/income/w2?id=${saved.data.id}`, { method: 'DELETE', token: owner.token }), 200);
    assert.equal((await request('/api/income/w2?year=2026', { token: owner.token })).data.totalWages, 0);
  });
  await check('quarterly summary matches annual estimate and withholds unsupported payment/penalty verdicts', async () => {
    const annual = await request('/api/tax/compute-1040?year=2026', { token: owner.token }); status(annual, 200);
    const quarterly = await request('/api/tax/quarterly-reminders?year=2026', { token: owner.token }); status(quarterly, 200);
    assert.equal(quarterly.data.totalEstimatedTax, annual.data.form1040.totalTax);
    assert.equal(quarterly.data.paymentReview.code, 'QUARTERLY_REVIEW_REQUIRED');
    for (const field of ['perQuarterRecommended', 'safeHarborTotal', 'onTrack', 'estimatedPenaltyRisk']) assert.equal(quarterly.data[field], null);
    assert.ok(quarterly.data.quarters.every(quarter => quarter.recommended === null));
    const voucher = await request('/api/tax/generate-1040es', { method: 'POST', token: owner.token, body: { quarter: 3, taxYear: 2026, taxCalculation: { quarterlyAmount: 1 } } });
    status(voucher, 422); assert.equal(voucher.data.code, 'QUARTERLY_REVIEW_REQUIRED'); assert.ok(voucher.data.error);
    assert.ok(!voucher.response.headers.get('content-type').includes('application/pdf'));
  });
  await check('unverified tax year is rejected explicitly', async () => status(await request('/api/tax/compute-1040?year=2027', { token: owner.token }), 400));
  await check('mileage save/read/delete round trip', async () => {
    const saved = await request('/api/mileage', { method: 'POST', token: owner.token, body: { userId: owner.uid, date: '2026-09-15', startLocation: 'Synthetic home office', endLocation: 'Synthetic customer', miles: 12.5, businessPurpose: 'Client visit', roundTrip: false } });
    status(saved, 200); assert.ok(saved.data.id);
    const read = await request('/api/mileage?year=2026', { token: owner.token }); status(read, 200);
    assert.ok(read.data.some(trip => trip.id === saved.data.id && trip.miles === 12.5));
    status(await request(`/api/mileage/${saved.data.id}`, { method: 'DELETE', token: other.token }), 200);
    assert.ok((await request('/api/mileage?year=2026', { token: owner.token })).data.some(trip => trip.id === saved.data.id), 'Another owner must not delete this trip');
    status(await request(`/api/mileage/${saved.data.id}`, { method: 'DELETE', token: owner.token }), 200);
    assert.ok(!(await request('/api/mileage?year=2026', { token: owner.token })).data.some(trip => trip.id === saved.data.id));
  });
  await check('first-time home-office settings read is an empty state', async () => {
    const result = await request('/api/settings/home-office', { token: owner.token }); status(result, 200); assert.equal(result.data.data, null);
  });
  await check('home-office settings save/read round trip', async () => {
    status(await request('/api/settings/home-office', { method: 'POST', token: owner.token, body: { totalHomeSqFt: 1000, officeSqFt: 100, rentOrMortgageInterest: 12000, utilities: 1200, insurance: 0, repairsMaintenance: 0, propertyTax: 0, other: 0 } }), 200);
    const result = await request('/api/settings/home-office', { token: owner.token }); status(result, 200);
    assert.equal(result.data.data.officeSqFt, 100); assert.equal(result.data.data.totalHomeSqFt, 1000);
  });
  await check('asset save/read/delete round trip', async () => {
    const saved = await request('/api/settings/assets', { method: 'POST', token: owner.token, body: { assets: [{ description: 'Synthetic laptop', cost: 1200, datePlacedInService: '2026-09-15', businessUsePercent: 100, category: 'computer', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false }] } });
    status(saved, 200); const id = saved.data.data[0].id; assert.ok(id);
    const read = await request('/api/settings/assets', { token: owner.token }); status(read, 200); assert.ok(read.data.data.some(asset => asset.id === id && asset.cost === 1200));
    status(await request('/api/settings/assets', { method: 'DELETE', token: owner.token, body: { assetId: id } }), 200);
    assert.ok(!(await request('/api/settings/assets', { token: owner.token })).data.data.some(asset => asset.id === id));
  });
  await check('unsupported Section 179 facts return review-required instead of completed tax totals', async () => {
    const saved = await request('/api/settings/assets', { method: 'POST', token: owner.token, body: { assets: [{ description: 'Synthetic Section 179 election', cost: 1200, datePlacedInService: '2026-09-15', businessUsePercent: 100, category: 'computer', method: 'MACRS_5YR', section179Requested: true, bonusEligible: false }] } });
    status(saved, 200); const id = saved.data.data[0].id;
    try {
      const calculation = await request('/api/tax/compute-1040?year=2026', { token: owner.token }); status(calculation, 422);
      assert.equal(calculation.data.code, 'DEPRECIATION_REVIEW_REQUIRED'); assert.ok(!('totalTax' in calculation.data));
    } finally { status(await request('/api/settings/assets', { method: 'DELETE', token: owner.token, body: { assetId: id } }), 200); }
  });
  let transactionId;
  await check('manual income saves and is isolated across users', async () => {
    const created = await request('/api/transactions/manual', { method: 'POST', token: owner.token, body: { merchant_name: 'Synthetic customer', amount: 125, date: '2026-09-15', type: 'income', notes: 'Local smoke fixture only' } });
    status(created, 201); transactionId = created.data.id; assert.ok(transactionId);
    const own = await request('/api/transactions?year=2026', { token: owner.token }); status(own, 200);
    assert.ok(own.data.transactions.some(transaction => transaction.trans_id === transactionId && transaction.amount === -125));
    const foreign = await request(`/api/transactions/${transactionId}`, { token: other.token }); status(foreign, [403, 404]);
  });
  await check('receipt upload/download uses private local Storage and enforces ownership', async () => {
    assert.ok(transactionId, 'Manual income creation failed');
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4ZkAAAAASUVORK5CYII=', 'base64');
    const data = new FormData(); data.set('transactionId', transactionId); data.set('file', new Blob([bytes], { type: 'image/png' }), 'synthetic.png');
    const uploaded = await request('/api/upload-receipt', { method: 'POST', token: owner.token, body: data }); status(uploaded, 200);
    assert.match(uploaded.data.receiptUrl, /^\/api\/receipts\/[^/]+$/);
    const owned = await request(uploaded.data.receiptUrl, { token: owner.token }); status(owned, 200);
    assert.equal(owned.response.headers.get('content-type'), 'image/png');
    assert.match(owned.response.headers.get('cache-control'), /no-store/);
    status(await request(uploaded.data.receiptUrl, { token: other.token }), [403, 404]);
    status(await request(uploaded.data.receiptUrl), 401);
    status(await request('/api/database/transactions', { method: 'PUT', token: owner.token, body: { transactionId, updates: { receipt_url: uploaded.data.receiptUrl, receipt_filename: 'synthetic.png' } } }), 200);
    const attached = await request('/api/transactions?year=2026', { token: owner.token }); status(attached, 200);
    assert.equal(attached.data.transactions.find(transaction => transaction.trans_id === transactionId).receipt_url, uploaded.data.receiptUrl);
    status(await request('/api/database/transactions', { method: 'PUT', token: owner.token, body: { transactionId, updates: { receipt_url: '', receipt_filename: '' } } }), 200);
    const unlinked = await request('/api/transactions?year=2026', { token: owner.token }); status(unlinked, 200);
    assert.equal(unlinked.data.transactions.find(transaction => transaction.trans_id === transactionId).receipt_url, '');

  });
  await check('saved manual income and business expense reach the profit/loss report with correct signs', async () => {
    assert.ok(transactionId, 'Manual income creation failed');
    await seed(`user_profiles/${owner.uid}/accounts/manual/transactions/synthetic-expense`, { userId: owner.uid, trans_id: 'synthetic-expense', account_id: 'manual', amount: 25, date: '2026-09-15', merchant_name: 'Synthetic supplies', category: 'supplies_small_tools', is_deductible: true });
    const report = await request('/api/reports/profit-loss', { method: 'POST', token: owner.token, body: { year: 2026 } }); status(report, 200);
    assert.equal(report.data.totalIncome, 125); assert.equal(report.data.totalExpenses, 25); assert.equal(report.data.netProfit, 100);
  });
  await check('expense classification persists true, false and unreviewed with zero confidence intact', async () => {
    for (const classification of [true, false, null]) {
      const changed = await request('/api/transactions/synthetic-expense', { method: 'PUT', token: owner.token, body: { is_deductible: classification, deduction_score: 0, deductible_reason: 'Synthetic review' } }); status(changed, 200);
      const read = await request('/api/transactions/synthetic-expense', { token: owner.token }); status(read, 200);
      assert.equal(read.data.transaction.is_deductible, classification); assert.equal(read.data.transaction.deduction_score, 0);
    }
  });
  for (const route of ['/api/transactions/synthetic-expense', '/api/database/transactions']) {
    await check(`transaction owner injection rejected by ${route}`, async () => {
      const updates = { userId: other.uid, user_id: other.uid, account_id: 'foreign' };
      const result = await request(route, { method: 'PUT', token: owner.token, body: route.includes('database') ? { transactionId: 'synthetic-expense', updates } : updates }); status(result, 400);
      const own = await request('/api/transactions/synthetic-expense', { token: owner.token }); status(own, 200); assert.equal(own.data.transaction.userId, owner.uid);
      status(await request('/api/transactions/synthetic-expense', { token: other.token }), 404);
    });
  }
  await check('legacy transaction creation cannot add a second owner alias', async () => {
    status(await request('/api/database/transactions', { method: 'POST', token: owner.token, body: { trans_id: 'forged-owner', account_id: 'manual', merchant_name: 'Synthetic', amount: 10, date: '2026-09-15', user_id: other.uid } }), 400);
  });
  await check('PDF report returns a real PDF for an active trial', async () => {
    const result = await request('/api/reports/profit-loss?format=pdf&year=2026', { token: owner.token }); status(result, 200);
    assert.match(result.response.headers.get('content-type'), /application\/pdf/); assert.ok(result.text.startsWith('%PDF-'));
  });
  await check('profile edits cannot grant subscription entitlements', async () => {
    const result = await request('/api/database/profiles', { method: 'POST', token: owner.token, body: { subscriptionStatus: 'active', hasHistoricalAccess: true, stripeSubscriptionId: 'sub_forged' } }); status(result, 400);
  });
  await check('cross-site session creation and cookie-authenticated mutation are rejected', async () => {
    status(await request('/api/auth/session', { method: 'POST', body: { idToken: owner.token }, headers: { origin: 'https://other.example.invalid', 'sec-fetch-site': 'cross-site' } }), 403);
    assert.ok(sessionCookie);
    status(await request('/api/transactions/manual', { method: 'POST', cookie: sessionCookie, body: { merchant_name: 'Cross-site', amount: 10, date: '2026-09-15', type: 'income' }, headers: { origin: 'https://other.example.invalid', 'sec-fetch-site': 'cross-site' } }), 401);
  });
  await check('organizer caller cannot replace document owner', async () => {
    const result = await request('/api/tax/organizer', { method: 'POST', token: owner.token, body: { taxYear: 2026, userId: other.uid, dependentDetails: 'SYNTHETIC OWNER CHECK' } });
    if (result.response.status >= 400) { status(result, [400, 403]); return; }
    status(result, [200, 201]);
    const otherView = await request('/api/tax/organizer?year=2026', { token: other.token }); status(otherView, 200);
    assert.ok(!otherView.data.organizer, 'Owner override made the organizer visible to another user');
    const ownView = await request('/api/tax/organizer?year=2026', { token: owner.token }); status(ownView, 200);
    assert.equal(ownView.data.organizer?.userId, owner.uid);
  });
  await check('organizer encrypts synthetic SSN/bank data at rest and decrypts it only for the owner', async () => {
    const answers = { taxYear: 2026, taxpayerSSN: '900000001', spouseSSN: '900000002', bankAccount: '000123456789', dependentDetails: 'Synthetic encryption fixture' };
    const saved = await request('/api/tax/organizer', { method: 'POST', token: owner.token, body: answers }); status(saved, [200, 201]); assert.ok(saved.data.id);
    const storedResponse = await fetch(`${dbBase}/tax_organizers/${saved.data.id}`, { headers: { authorization: 'Bearer owner' }, signal: AbortSignal.timeout(10000) });
    assert.equal(storedResponse.status, 200); const stored = await storedResponse.json();
    for (const field of ['taxpayerSSN', 'spouseSSN', 'bankAccount']) {
      const ciphertext = stored.fields[field].stringValue; assert.notEqual(ciphertext, answers[field]); assert.equal(ciphertext.split(':').length, 3);
    }
    const ownerView = await request('/api/tax/organizer?year=2026', { token: owner.token }); status(ownerView, 200);
    for (const field of ['taxpayerSSN', 'spouseSSN', 'bankAccount']) assert.equal(ownerView.data.organizer[field], answers[field]);
    assert.match(ownerView.response.headers.get('cache-control'), /no-store/);
    const otherView = await request('/api/tax/organizer?year=2026', { token: other.token }); status(otherView, 200); assert.equal(otherView.data.organizer, null);
    status(await request('/api/tax/organizer?year=2026'), 401);
  });
  await check('database profile read accepts a valid server-authenticated user', async () => {
    const result = await request('/api/database/profiles', { token: owner.token }); status(result, 200); assert.ok(result.data.profile);
  });
  const future = new Date(Date.now() + 86400000 * 10);
  const past = new Date(Date.now() - 86400000 * 10);
  const paid = { subscriptionStatus: 'active', stripeSubscriptionStatus: 'active', stripeSubscriptionId: 'sub_synthetic_fixture', subscriptionEnd: future };
  const planCases = [
    { name: 'free', access: false, profile: { subscriptionStatus: 'expired', trialEnd: past } },
    { name: 'trial-active', access: true, profile: {} },
    { name: 'trial-expired', access: false, profile: { trialStart: new Date(Date.now() - 86400000 * 40), trialEnd: past } },
    { name: 'premium-active', access: true, profile: paid },
    { name: 'premium-cancel-at-period-end', access: true, profile: { ...paid, cancelAtPeriodEnd: true } },
    { name: 'premium-canceled', access: false, profile: { ...paid, stripeSubscriptionStatus: 'canceled' } },
    { name: 'premium-past-due', access: false, profile: { ...paid, stripeSubscriptionStatus: 'past_due' } },
    { name: 'premium-expired', access: false, profile: { ...paid, subscriptionEnd: past } },
    { name: 'premium-malformed', access: false, profile: { subscriptionStatus: 'active', hasHistoricalAccess: true } },
  ];
  for (const fixture of planCases) {
    const member = await makeUser(fixture.name, fixture.profile);
    await check(`plan ${fixture.name}: saved records remain accessible`, async () => {
      status(await request('/api/transactions?year=2026', { token: member.token }), 200);
      status(await request('/api/mileage?year=2026', { token: member.token }), 200);
    });
    await check(`plan ${fixture.name}: reports ${fixture.access ? 'unlocked' : 'locked'} at server`, async () => {
      const result = await request('/api/reports/profit-loss', { method: 'POST', token: member.token, body: { year: 2026, subscriptionStatus: 'active', hasHistoricalAccess: true } });
      status(result, fixture.access ? 200 : 403);
      if (!fixture.access) { assert.equal(result.data.code, 'SUBSCRIPTION_REQUIRED'); assert.equal(result.data.feature, 'reports'); }
    });
    await check(`plan ${fixture.name}: CSV exports ${fixture.access ? 'unlocked' : 'locked'} at server`, async () => {
      const result = await request('/api/transactions/export-csv?year=2026', { token: member.token });
      status(result, fixture.access ? 200 : 403);
      if (fixture.access) assert.match(result.response.headers.get('content-type'), /text\/csv/);
      else { assert.equal(result.data.code, 'SUBSCRIPTION_REQUIRED'); assert.equal(result.data.feature, 'exports'); }
    });
    if (!('stripeSubscriptionId' in fixture.profile)) {
      await check(`plan ${fixture.name}: access response matches persisted entitlement`, async () => {
        const result = await request('/api/subscriptions/check-access', { token: member.token }); status(result, 200);
        assert.equal(result.data.data.hasAccess, fixture.access);
        for (const feature of ['reports', 'exports', 'extended_history']) assert.equal(result.data.data.entitlements.features[feature], fixture.access);
      });
    }
  }

}
const report = { generatedAt: new Date().toISOString(), baseUrl: base.origin, mode, nodeVersion: process.version, discoveredApiOperations: sourceApis.length, results, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length };
const output = process.env.WRITEOFF_SMOKE_REPORT || `/tmp/writeoff-platform-smoke-${mode}.json`;
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, results: results.filter(result => !result.passed), output }, null, 2));
process.exitCode = report.failed ? 1 : 0;
