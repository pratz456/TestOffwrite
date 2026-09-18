/** Firebase Hosting terminates TLS and may give Next an internal request URL.
 * Trust configured application origins, never caller-supplied forwarding headers.
 */
export function isTrustedApplicationRequest(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const allowed = new Set([new URL(request.url).origin]);
  if (env.NEXT_PUBLIC_SITE_URL) {
    try {
      const site = new URL(env.NEXT_PUBLIC_SITE_URL);
      if (site.protocol === 'https:' || (site.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname))) {
        allowed.add(site.origin);
        if (['writeoffapp.com', 'www.writeoffapp.com'].includes(site.hostname) && site.protocol === 'https:') {
          allowed.add('https://writeoffapp.com');
          allowed.add('https://www.writeoffapp.com');
        }
      }
    } catch { /* Invalid configuration must never broaden the allowlist. */ }
  }
  const project = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (project && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) {
    allowed.add(`https://${project}.web.app`);
    allowed.add(`https://${project}.firebaseapp.com`);
  }
  return allowed.has(origin);
}
