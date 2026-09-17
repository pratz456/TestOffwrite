type Environment = Record<string, string | undefined>;
type LegacyPlaidConfig = { client_id?: string; clientId?: string; secret?: string; env?: string };
export type PlaidEnvironment = 'sandbox' | 'production';

function appEnvironment(env: Environment) {
  const projects = [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT, env.GCP_PROJECT,
    env.FIREBASE_ADMIN_PROJECT_ID, env.NEXT_PUBLIC_FIREBASE_PROJECT_ID];
  // Firebase's runtime value is normally inline JSON. File-based credentials are
  // intentionally not read here; the Admin SDK's project guard owns those.
  if (env.FIREBASE_CONFIG?.trim().startsWith('{')) {
    try { projects.push(JSON.parse(env.FIREBASE_CONFIG).projectId); }
    catch { throw new Error('Plaid requires a valid Firebase environment configuration'); }
  }
  let hostname = '';
  if (env.NEXT_PUBLIC_SITE_URL) {
    try { hostname = new URL(env.NEXT_PUBLIC_SITE_URL).hostname; }
    catch { throw new Error('Plaid requires a valid application site URL'); }
  }
  const staging = env.WRITEOFF_ENV === 'staging' || env.NEXT_PUBLIC_APP_ENV === 'staging' ||
    projects.includes('writeoff-production-testing') || ['writeoff-production-testing.web.app', 'writeoff-production-testing.firebaseapp.com'].includes(hostname);
  const production = env.WRITEOFF_ENV === 'production' || env.NEXT_PUBLIC_APP_ENV === 'production' ||
    projects.includes('writeoff-23910') || ['writeoffapp.com', 'www.writeoffapp.com', 'writeoff-23910.web.app', 'writeoff-23910.firebaseapp.com'].includes(hostname);
  if (staging && production) throw new Error('Plaid app environment markers conflict');
  const local = env.WRITEOFF_ENV === 'local' || projects.some(project => typeof project === 'string' && project.startsWith('demo-')) ||
    ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  return { staging, production: production || (env.NODE_ENV === 'production' && !staging && !local) };
}

export function getPlaidConfig(
  env: Environment = process.env,
  // Keep the old call shape during migration, but never read legacy credentials.
  _readLegacy?: () => LegacyPlaidConfig,
  _preferEnvironment?: boolean,
) {
  void _readLegacy;
  void _preferEnvironment;
  const { staging, production } = appEnvironment(env);
  if (staging && env.PLAID_ENV !== 'sandbox') throw new Error('Staging isolation: PLAID_ENV must be sandbox');
  if (production && env.PLAID_ENV !== 'production') throw new Error('Production banking requires PLAID_ENV=production');
  if (env.PLAID_ENV !== 'sandbox' && env.PLAID_ENV !== 'production') {
    throw new Error('PLAID_ENV must explicitly select sandbox or production');
  }
  const plaidEnv: PlaidEnvironment = env.PLAID_ENV;
  return { plaidClientId: env.PLAID_CLIENT_ID?.trim() || undefined,
    plaidSecret: env.PLAID_SECRET?.trim() || undefined, plaidEnv };
}
