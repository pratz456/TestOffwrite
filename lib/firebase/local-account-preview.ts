import { isLoopbackHostname } from './local-emulator-config';

type Environment = Record<string, string | undefined>;
const PROJECT = 'writeoff-23910';

/**
 * Explicit development-only access to the real account, without bank-provider
 * operations or the legacy bank migration that ordinarily runs during reads.
 * This is not a read-only application: authenticated review/AI actions still
 * use the user's real records. Never enable it on a hosted deployment.
 */
export function isLocalAccountPreview(env: Environment = process.env): boolean {
  const flag = env.WRITEOFF_LOCAL_ACCOUNT_PREVIEW;
  if (flag === undefined || flag === '' || flag === 'false') return false;
  if (flag !== 'true') throw new Error('Local account preview must explicitly be true or false.');
  if (env.NODE_ENV !== 'development' || env.WRITEOFF_ENV !== 'local-account-preview'
      || env.NEXT_PUBLIC_APP_ENV !== 'local-account-preview'
      || env.NEXT_PUBLIC_AUTO_SYNC_ON_VISIT !== 'false'
      || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT || env.FIREBASE_ADMIN_PROJECT_ID !== PROJECT) {
    throw new Error('Local account preview requires its explicit development and production-account configuration.');
  }
  if (!env.WRITEOFF_LOCAL_ACCOUNT_PREVIEW_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.WRITEOFF_LOCAL_ACCOUNT_PREVIEW_EMAIL)) {
    throw new Error('Local account preview requires an explicit account email.');
  }
  for (const name of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT']) {
    if (env[name] && env[name] !== PROJECT) throw new Error('Local account preview has a conflicting Firebase project.');
  }
  if (env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS && env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== 'false'
      || ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FUNCTIONS_EMULATOR']
        .some(name => Boolean(env[name]) && env[name] !== 'false')) {
    throw new Error('Local account preview cannot use Firebase emulators.');
  }
  try {
    const site = new URL(env.NEXT_PUBLIC_SITE_URL ?? '');
    if (site.protocol !== 'http:' || !isLoopbackHostname(site.hostname) || site.username || site.password
        || site.pathname !== '/' || site.search || site.hash) throw new Error();
  } catch {
    throw new Error('Local account preview requires an HTTP loopback site origin.');
  }
  return true;
}

/** Includes provider webhooks and internal sync; checking only authenticated mutations is insufficient. */
export function localAccountPreviewBlocksBankRequest(request: Pick<Request, 'url'>, env: Environment = process.env): boolean {
  if (!isLocalAccountPreview(env)) return false;
  const pathname = new URL(request.url).pathname;
  return pathname === '/api/plaid' || pathname.startsWith('/api/plaid/');
}
