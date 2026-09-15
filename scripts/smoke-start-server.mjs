/** Start an existing production build with synthetic Firebase emulator configuration. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
const cwd = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || '3100');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Provide a valid unprivileged localhost port.');
await fs.access(path.join(cwd, '.next/BUILD_ID'));
// Next loads .env files automatically; refuse a checkout that could restore real credentials.
if ((await fs.readdir(cwd)).some(file => /^\.env(?:\.|$)/.test(file) && !/example|sample|template/.test(file))) {
  throw new Error('Use an isolated build directory without .env files. See PLATFORM_SMOKE_REPORT.');
}
const env = { ...process.env };
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY', 'FIREBASE_ADMIN_PROJECT_ID', 'OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PLAID_CLIENT_ID', 'PLAID_SECRET', 'RESEND_API_KEY']) env[key] = '';
Object.assign(env, {
  NODE_ENV: 'production', GCLOUD_PROJECT: 'demo-writeoff-security',
  FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-writeoff-security', storageBucket: 'demo-writeoff-security.appspot.com' }),
  FIREBASE_STORAGE_BUCKET: 'demo-writeoff-security.appspot.com',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9299',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-api-key', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-writeoff-security',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-writeoff-security.firebaseapp.com', NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demo-writeoff-security.appspot.com',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:123456789:web:synthetic', NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123456789',
  NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`, CLOUD_FUNCTION_SECRET: 'local-smoke-only-no-external-calls', PLAID_ENV: 'sandbox',
  SSN_ENCRYPTION_KEY: '1111111111111111111111111111111111111111111111111111111111111111',
});
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
