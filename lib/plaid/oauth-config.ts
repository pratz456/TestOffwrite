import { getPlaidConfig } from './config';

export const PLAID_OAUTH_PATH = '/plaid/oauth';
type Environment = Record<string, string | undefined>;

/** Never derive an OAuth destination from a caller-supplied host or URL. */
export function getPlaidOAuthRedirectUri(env: Environment = process.env, requestOrigin?: string | null): string | undefined {
  const configured = env.PLAID_REDIRECT_URI?.trim();
  if (!configured) return undefined; // Existing popup flows remain available until the callback is registered.
  const { plaidEnv } = getPlaidConfig(env);
  const uri = new URL(configured);
  if (uri.username || uri.password || uri.search || uri.hash || uri.pathname !== PLAID_OAUTH_PATH || uri.href !== configured) {
    throw new Error('Invalid bank OAuth callback');
  }
  const projects = [env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, env.FIREBASE_ADMIN_PROJECT_ID, env.GOOGLE_CLOUD_PROJECT, env.GCLOUD_PROJECT];
  const staging = env.WRITEOFF_ENV === 'staging' || env.NEXT_PUBLIC_APP_ENV === 'staging' || projects.includes('writeoff-production-testing');
  const production = env.WRITEOFF_ENV === 'production' || env.NEXT_PUBLIC_APP_ENV === 'production' || projects.includes('writeoff-23910');
  const allowed = staging && !production && plaidEnv === 'sandbox'
    ? uri.origin === 'https://writeoff-production-testing.web.app'
    : production && !staging && plaidEnv === 'production'
      ? uri.origin === 'https://writeoffapp.com'
      : !staging && !production && plaidEnv === 'sandbox' && env.NODE_ENV !== 'production'
        && env.WRITEOFF_ENV === 'local' && uri.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(uri.hostname);
  if (!allowed || (requestOrigin && requestOrigin !== uri.origin)) throw new Error('Bank OAuth environment mismatch');
  return uri.href;
}
