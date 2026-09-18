import { createHash, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto';
import { getPlaidConfig } from './config';

const MAX_AGE_SECONDS = 300;
const CACHE_TTL_MS = 60 * 60 * 1000;
type VerificationKey = JsonWebKey & { kid: string; alg: string; expired_at: number | null };
type Options = {
  fetcher?: typeof fetch;
  now?: () => number;
  config?: () => ReturnType<typeof getPlaidConfig>;
};

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Plaid returns a JWK, and ES256 JWT signatures use IEEE-P1363 encoding, not DER.
 * https://plaid.com/docs/api/webhooks/webhook-verification/
 */
export function createPlaidWebhookVerifier(options: Options = {}) {
  const cache = new Map<string, { key: VerificationKey; fetchedAt: number }>();
  const now = options.now ?? Date.now;
  return async (rawBody: string, signedJwt: string | null): Promise<boolean> => {
    try {
      if (!signedJwt || signedJwt.length > 16_384 || !rawBody) return false;
      const parts = signedJwt.split('.');
      if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
      const header: unknown = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (!object(header) || header.alg !== 'ES256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 256) return false;
      if (!object(payload) || !Number.isInteger(payload.iat)) return false;
      const nowMs = now();
      const nowSeconds = Math.floor(nowMs / 1000);
      const issuedAt = payload.iat as number;
      if (issuedAt > nowSeconds || nowSeconds - issuedAt > MAX_AGE_SECONDS) return false;
      if (payload.exp !== undefined && (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= nowSeconds)) return false;
      if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf) || payload.nbf > nowSeconds)) return false;
      if (typeof payload.request_body_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.request_body_sha256)) return false;
      const expectedHash = createHash('sha256').update(rawBody, 'utf8').digest();
      if (!timingSafeEqual(expectedHash, Buffer.from(payload.request_body_sha256, 'hex'))) return false;
      const signature = Buffer.from(parts[2], 'base64url');
      if (signature.length !== 64) return false;

      const config = (options.config ?? (() => getPlaidConfig(process.env, () => ({}), true)))();
      if (!config.plaidClientId || !config.plaidSecret || !['sandbox', 'production'].includes(config.plaidEnv)) return false;
      const cacheId = `${config.plaidEnv}:${header.kid}`;
      const cached = cache.get(cacheId);
      let key: unknown = cached && nowMs - cached.fetchedAt < CACHE_TTL_MS ? cached.key : undefined;
      if (!key) {
        const response = await (options.fetcher ?? fetch)(`https://${config.plaidEnv}.plaid.com/webhook_verification_key/get`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: config.plaidClientId, secret: config.plaidSecret, key_id: header.kid }),
          signal: AbortSignal.timeout(5000), redirect: 'error',
        });
        if (!response.ok) return false;
        const data: unknown = await response.json();
        key = object(data) ? data.key : undefined;
      }
      if (!object(key) || key.kty !== 'EC' || key.crv !== 'P-256' || key.alg !== 'ES256' || key.kid !== header.kid ||
          (key.use !== undefined && key.use !== 'sig') || typeof key.x !== 'string' || typeof key.y !== 'string' ||
          !(key.expired_at === null || (typeof key.expired_at === 'number' && Number.isFinite(key.expired_at) && key.expired_at > nowSeconds))) return false;
      const publicKey = createPublicKey({ key: key as JsonWebKey, format: 'jwk' });
      if (!verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)) return false;
      if (!cached || nowMs - cached.fetchedAt >= CACHE_TTL_MS) {
        if (cache.size >= 64) cache.delete(cache.keys().next().value!);
        cache.set(cacheId, { key: key as VerificationKey, fetchedAt: nowMs });
      }
      return true;
    } catch {
      // Fail closed without logging provider request objects, which contain secrets.
      return false;
    }
  };
}

export const verifyPlaidWebhook = createPlaidWebhookVerifier();
