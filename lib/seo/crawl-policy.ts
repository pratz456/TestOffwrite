/**
 * Public crawl policy for https://writeoffapp.com.
 *
 * Allow `/` so marketing, legal, tools, and blog routes stay crawlable.
 * Disallow prefixes are the signed-in product, auth-only pages, and API
 * handlers that exist under `app/`:
 *
 * - `/api/` — route handlers in `app/api`
 * - `/protected/` — signed-in product (`app/protected`, noindex layout)
 * - `/auth/` — sign-in, sign-up, password, and email-action pages (`app/auth`, noindex layout)
 * - `/login` — alias that redirects to `/auth/login` (`app/login`)
 * - `/plaid/` — bank OAuth and reconnect (`app/plaid`, sign-in required)
 * - `/stripe/` — checkout return pages (`app/stripe`, noindex layout)
 */
export const CANONICAL_SITE_URL = "https://writeoffapp.com";

export const DISALLOWED_CRAWL_PATHS = [
  "/api/",
  "/protected/",
  "/auth/",
  "/login",
  "/plaid/",
  "/stripe/",
] as const;

export function publicSiteUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NEXT_PUBLIC_APP_ENV === "staging") {
    const configured = env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
    if (configured && configured.startsWith("https://")) return configured;
  }
  return CANONICAL_SITE_URL;
}
