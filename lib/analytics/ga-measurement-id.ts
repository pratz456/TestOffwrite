/**
 * Single source of truth for whether Google Analytics loads and, therefore,
 * whether the browser policy admits the Google tag origins.
 *
 * Two measurement IDs exist in the codebase history (the layout's hard-coded
 * gtag ID and the Firebase config measurementId). Neither is chosen here: the
 * tag renders only when NEXT_PUBLIC_GA_MEASUREMENT_ID is set at build time,
 * and the CSP grows by the same condition. See docs/PRELAUNCH_READINESS.md.
 */
const GA4_MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;

export interface AnalyticsEnv {
  NEXT_PUBLIC_GA_MEASUREMENT_ID?: string;
  NEXT_PUBLIC_APP_ENV?: string;
}

/** The configured GA4 measurement ID, or null when analytics must not load. */
export function gaMeasurementId(env: AnalyticsEnv = {
  NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
}): string | null {
  // The staging site never reports to production analytics, whatever is configured.
  if (env.NEXT_PUBLIC_APP_ENV === 'staging') return null;
  const value = env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim().toUpperCase() ?? '';
  return GA4_MEASUREMENT_ID.test(value) ? value : null;
}

/** Origins gtag.js needs (Google's published CSP guidance for GA4), grouped by CSP directive. */
export const GOOGLE_TAG_CSP_SOURCES = {
  scriptSrc: ['https://*.googletagmanager.com'],
  imgSrc: ['https://*.google-analytics.com', 'https://*.googletagmanager.com'],
  connectSrc: ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'],
} as const;
