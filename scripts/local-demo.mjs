/** Isolated localhost walkthrough. OpenAI can be explicitly connected; Firebase stays local. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analysisWorkerEnvFile, localDemoAIEnvironment } from './local-demo-ai.mjs';
import { randomBytes } from 'node:crypto';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const aiEnvironment = await localDemoAIEnvironment(process.argv.slice(2), source);
const automaticAnalysis = !!aiEnvironment.OPENAI_API_KEY;
const workerSecret = automaticAnalysis ? randomBytes(32).toString('hex') : null;
const project = 'demo-writeoff-security';
const base = 'http://localhost:3000';
const password = 'LocalDemo2026!';
const children = [];
let closing = false;
for (const port of [3000, 9099, 8180, 9299, 4400, 9150, ...(automaticAnalysis ? [5001, 9298] : [])]) {
  await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', () => reject(new Error(`Local demo port ${port} is occupied. Stop its owner before restarting.`)));
    socket.listen(port, '127.0.0.1', () => socket.close(resolve));
  });
}
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'writeoff-local-demo-'));
const appDirectory = path.join(directory, 'app');
await fs.mkdir(appDirectory);
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: source, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const file of new Set(files)) {
  if (file.split('/').some(part => part.startsWith('.env') || part === '.vercel') || /(?:^|\/)(?:users\.json|secretskey\.md)$|(?:credential|service-account|private-key)|\.(?:pem|p12|pfx|key)$/i.test(file)) continue;
  const from = path.join(source, file);
  if (!(await fs.lstat(from)).isFile()) continue;
  await fs.mkdir(path.dirname(path.join(appDirectory, file)), { recursive: true });
  await fs.copyFile(from, path.join(appDirectory, file));
}
await fs.symlink(await fs.realpath(path.join(source, 'node_modules')), path.join(appDirectory, 'node_modules'), 'dir');
assert.ok(!(await fs.readdir(appDirectory)).some(name => /^\.env(?:\.|$)/.test(name)));
if (automaticAnalysis) {
  const workerDirectory = path.join(appDirectory, 'functions-analysis');
  await fs.symlink(await fs.realpath(path.join(source, 'node_modules')), path.join(workerDirectory, 'node_modules'), 'dir');
  execFileSync(process.execPath, [path.join(source, 'node_modules/typescript/bin/tsc')], { cwd: workerDirectory, stdio: 'pipe' });
  await fs.writeFile(path.join(workerDirectory, '.secret.local'), `ANALYSIS_WORKER_SECRET=${workerSecret}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(workerDirectory, '.env.local'), analysisWorkerEnvFile('http://127.0.0.1:3000'), { mode: 0o600 });
}
const configPath = path.join(directory, 'firebase.json');
await fs.writeFile(configPath, JSON.stringify({
  firestore: { rules: path.join(appDirectory, 'firestore.rules') },
  storage: { rules: path.join(appDirectory, 'storage.rules') },
  ...(automaticAnalysis ? { functions: [{ source: 'app/functions-analysis', codebase: 'analysis' }] } : {}),
  emulators: {
    auth: { host: '127.0.0.1', port: 9099 }, firestore: { host: '127.0.0.1', port: 8180 },
    storage: { host: '127.0.0.1', port: 9299 }, hub: { host: '127.0.0.1', port: 4400 },
    logging: { host: '127.0.0.1', port: 9150 }, ui: { enabled: false }, singleProjectMode: true,
    ...(automaticAnalysis ? { functions: { host: '127.0.0.1', port: 5001 }, eventarc: { host: '127.0.0.1', port: 9298 } } : {}),
  },
}, null, 2));
// An allowlist prevents inherited credentials from reaching the preview processes.
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'JAVA_HOME', 'LANG', 'TERM'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, {
  NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', CI: 'true',
  WRITEOFF_ENV: 'local', NEXT_PUBLIC_APP_ENV: 'local', NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true',
  GCLOUD_PROJECT: project, GOOGLE_CLOUD_PROJECT: project,
  XDG_CONFIG_HOME: path.join(directory, 'isolated-cli-config'),
  GOOGLE_APPLICATION_CREDENTIALS: path.join(directory, 'no-cloud-credentials.json'),
  FIREBASE_CONFIG: JSON.stringify({ projectId: project, storageBucket: `${project}.appspot.com` }),
  FIREBASE_STORAGE_BUCKET: `${project}.appspot.com`,
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9299',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-key', NEXT_PUBLIC_FIREBASE_PROJECT_ID: project,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`, NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${project}.appspot.com`,
  NEXT_PUBLIC_FIREBASE_APP_ID: 'demo-app', NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123456789',
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: '', NEXT_PUBLIC_SITE_URL: base, PLAID_ENV: 'sandbox',
  CLOUD_FUNCTION_SECRET: 'local-demo-only-no-external-calls',
  SSN_ENCRYPTION_KEY: '1111111111111111111111111111111111111111111111111111111111111111',
});
async function start(label, args, cwd, extraEnvironment = {}) {
  const log = await fs.open(path.join(directory, `${label}.log`), 'a', 0o600);
  if (closing) {
    await log.close();
    throw new Error('Local demo startup was stopped.');
  }
  const child = spawn(process.execPath, args, { cwd, env: { ...env, ...extraEnvironment }, stdio: ['ignore', log.fd, log.fd] });
  children.push(child);
  child.once('exit', code => { if (!closing) { console.error(`${label} stopped (${code}); see ${directory}/${label}.log`); stop(code || 1); } });
  await log.close();
  return child;
}
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
async function waitFor(url, expected, attempts = 90, headers = {}) {
  for (let i = 0; i < attempts && !closing; i++) {
    try { const response = await fetch(url, { headers, signal: AbortSignal.timeout(1000) }); if (response.status === expected) return; } catch { /* Startup only. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Local service did not become ready. Inspect ${directory}.`);
}
async function waitForAnalysisFunctions() {
  for (let i = 0; i < 90 && !closing; i++) {
    try {
      const response = await fetch('http://127.0.0.1:5001/backends', { signal: AbortSignal.timeout(1000) });
      const data = await response.json();
      const names = data.backends?.flatMap(backend => backend.functionTriggers?.map(trigger => trigger.entryPoint) || []) || [];
      if (['queueBankTransactionAnalysis', 'processBankTransactionAnalysis'].every(name => names.includes(name))) return;
    } catch { /* Startup only. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Local analysis functions did not load. Inspect ${directory}/emulators.log.`);
}
const authBase = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
async function authRequest(route, data, admin = false) {
  const response = await fetch(authBase + route, { method: 'POST', headers: { 'content-type': 'application/json', ...(admin ? { authorization: 'Bearer owner' } : {}) }, body: JSON.stringify(data), signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, 'Local Auth fixture request failed');
  return response.json();
}
function value(v) {
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, item]) => [k, value(item)])) } };
}
async function seed(document, data) {
  const response = await fetch(`http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents/${document}`, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([key, v]) => [key, value(v)])) }), signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, 'Local Firestore fixture request failed');
}
try {
  console.log(`Preparing isolated local demo in ${directory}`);
  await start('emulators', [path.join(source, 'node_modules/firebase-tools/lib/bin/firebase.js'), 'emulators:start', '--project', project, '--config', configPath, '--only', automaticAnalysis ? 'auth,firestore,storage,functions,eventarc' : 'auth,firestore,storage', '--non-interactive'], directory);
  await waitFor(`http://127.0.0.1:9099/emulator/v1/projects/${project}/config`, 200);
  await waitFor(`http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents/user_profiles`, 200, 90, { authorization: 'Bearer owner' });
  if (automaticAnalysis) await waitForAnalysisFunctions();
  const accounts = [];
  for (const role of ['new', 'demo', 'free']) {
    const email = `${role}@writeoff.example`;
    const created = await authRequest('/accounts:signUp?key=demo-key', { email, password, returnSecureToken: true });
    const uid = created.localId;
    await authRequest(`/projects/${project}/accounts:update`, { localId: uid, emailVerified: true, displayName: role === 'new' ? 'New Demo User' : 'Jordan Demo' }, true);
    accounts.push({ role, uid, email });
    if (role === 'new') continue;
    await seed(`user_profiles/${uid}`, {
      userId: uid, name: 'Jordan Demo', email, profession: 'Designer', business_entity_type: 'sole_proprietor', income: '100000', state: 'TX', filing_status: 'single',
      onboardingIntroCompleted: true, onboardingPlaidGuideCompleted: true,
      subscriptionStatus: role === 'free' ? 'expired' : 'trial', trialStart: new Date(Date.now() - 86400000 * 8), trialEnd: new Date(Date.now() + (role === 'free' ? -1 : 7) * 86400000), hasHistoricalAccess: role !== 'free',
    });
    await seed(`user_profiles/${uid}/accounts/manual`, { userId: uid, account_id: 'manual', name: 'Manual entries', type: 'depository', subtype: 'checking', mask: 'DEMO' });
    const records = [
      ['client', 'Design project payments', -100000, 'INCOME', false, false],
      ['supplies', 'Studio supplies', 100, 'OFFICE_SUPPLIES', true, false],
      ['refund', 'Studio supplies refund', -20, 'OFFICE_SUPPLIES', true, false],
      ['meal', 'Client meeting meal', 10.01, 'FOOD_AND_DRINK_RESTAURANT', true, false],
      ['software', 'Design software', 240, 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', true, false],
      ['personal', 'Personal groceries', 90, 'FOOD_AND_DRINK_GROCERIES', false, false],
      ['review', 'Review this purchase', 63.25, 'OTHER', null, false],
      ['pending', 'Pending equipment order', 500, 'GENERAL_MERCHANDISE', true, true],
    ];
    for (const [id, merchant_name, amount, category, is_deductible, pending] of records) await seed(`user_profiles/${uid}/accounts/manual/transactions/${id}`, {
      userId: uid, trans_id: id, account_id: 'manual', merchant_name, amount, category, is_deductible, pending,
      date: '2026-09-02', iso_currency_code: 'USD', type: id === 'client' ? 'income' : 'expense', source: 'manual', analysis_status: 'completed',
      business_purpose: 'Synthetic demo record; review classification before tax use', notes: 'LOCAL DEMO - fictitious data',
    });
    await seed(`tax_organizers/demo-${uid}`, {
      userId: uid, taxYear: 2026, taxpayerName: 'Jordan Demo', filingStatus: 'single', dateOfBirth: '1990-05-20', dependents: '0',
      personalDeductionFacts: JSON.stringify({ version: 1, taxYear: 2026, ordinaryScope: 'yes', taxpayerBlind: 'no', taxpayerDependent: 'no', spouseBlind: 'no', spouseDependent: 'no', mfsSpouseItemizes: 'no', mfsSpouseAdditionalEligible: 'no', taxpayerSeniorSSN: 'yes', spouseSeniorSSN: 'yes', seniorHasAddbacks: 'no' }),
    });
  }
  await fs.writeFile(path.join(directory, 'demo-accounts.json'), JSON.stringify({ project, base, password, accounts }, null, 2), { mode: 0o600 });
  await start('app', ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3000'], appDirectory, { ...aiEnvironment, ...(workerSecret ? { ANALYSIS_WORKER_SECRET: workerSecret } : {}) });
  await waitFor(`${base}/auth/login`, 200, 120);
  await fs.writeFile(path.join(directory, 'ready.json'), JSON.stringify({ source, appDirectory, project, base, accounts: accounts.map(({ role, email }) => ({ role, email })), password, readyAt: new Date().toISOString() }, null, 2));
  console.log(`READY ${base}\nOnboarding: new@writeoff.example\nTrial: demo@writeoff.example\nExpired/free: free@writeoff.example\nLocal-only password: ${password}\nLogs: ${directory}\nOpenAI: ${aiEnvironment.OPENAI_API_KEY ? 'explicitly connected; requests require provider credit' : 'not connected'}\nCtrl+C stops this demo. Firebase, banking, and payments are isolated from production.`);
} catch (error) { console.error(error.message); stop(1); }
