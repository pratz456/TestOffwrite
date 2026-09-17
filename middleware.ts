/**
 * Next.js Middleware — Security Layer
 *
 * Applied to every request before it reaches any route handler:
 *  1. Security headers (CSP, HSTS, X-Frame-Options, etc.)
 *  2. Rate limiting per IP and per user
 *  3. Sensitive route protection
 *  4. Request size enforcement
 *
 * Sources:
 *  - OWASP Top 10 Web Application Security Risks
 *  - NIST SP 800-204A (API Security)
 *  - Next.js security documentation
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveLocalEmulatorConfig } from './lib/firebase/local-emulator-config';
import { gaMeasurementId, GOOGLE_TAG_CSP_SOURCES } from './lib/analytics/ga-measurement-id';

// ── In-memory rate limit store (resets on cold start) ──────────────────────
// First line only. Middleware runs in the edge runtime, so it cannot use
// firebase-admin, and each hosting instance keeps its own counters: an
// attacker spread across instances or cold starts is bounded per instance, not
// globally. The authoritative, durable per-owner limits live in the route
// handlers through lib/security/rate-limit.ts (Firestore `rate_limits`).
const ipRateMap   = new Map<string, { count: number; windowStart: number }>();
const userRateMap = new Map<string, { count: number; windowStart: number }>();

// These counters live in one instance's memory, so they are a per-IP flood ceiling,
// not the abuse control: costly routes enforce durable per-user limits in
// lib/security/rate-limit.ts. A single dashboard load fans out to a dozen API calls
// and many customers share one NAT address, so the ceilings must sit well above
// legitimate bursts.
const WINDOW_MS  = 60_000; // 1 minute window
const IP_LIMIT   = 600;    // page and RSC/prefetch requests per minute per IP
const API_LIMIT  = 600;    // /api/* requests per minute per IP
const AUTH_LIMIT = 30;     // session create/renew per minute per IP (Firebase Auth throttles credential guessing itself)
const UPLOAD_LIMIT = 10;   // document-import (vision) uploads per minute per IP

function rateLimit(map: Map<string, { count: number; windowStart: number }>, key: string, limit: number): boolean {
  const now = Date.now();
  const entry = map.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    map.set(key, { count: 1, windowStart: now });
    return true; // allowed
  }

  if (entry.count >= limit) return false; // blocked

  entry.count++;
  return true; // allowed
}

function getClientIP(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1'
  );
}

// ── Security headers applied to every response ────────────────────────────
function addSecurityHeaders(response: NextResponse, hostname: string): NextResponse {
  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');

  // Prevent MIME sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Force HTTPS for 1 year, include subdomains
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // Disable referrer for cross-origin requests (privacy)
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Restrict browser features
  response.headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
  );

  // Content Security Policy
  // - default-src: only same origin
  // - script-src: self + inline scripts needed by Next.js
  // - style-src: self + inline styles (Tailwind)
  // - img-src: self + data URIs + Plaid images + Firebase Storage
  // - connect-src: self + all API endpoints we call
  // - frame-src: Plaid Link, Stripe, and the configured Firebase Auth helper
  // - object-src: none (no Flash/plugins)
  const filingSandbox = process.env.COLUMN_TAX_MODE === 'sandbox' && process.env.COLUMN_TAX_SANDBOX_APPROVED === 'true'
    && process.env.WRITEOFF_ENV === 'staging' && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === 'writeoff-production-testing';
  const filingOrigin = filingSandbox ? ' https://app-sandbox.columnapi.com' : '';
  // Failed local configuration receives the normal restrictive policy. The
  // client rejects it before initializing Firebase; never expand production CSP.
  let localEmulators = null;
  try {
    localEmulators = resolveLocalEmulatorConfig({ enabled: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS,
      nodeEnv: process.env.NODE_ENV, appEnv: process.env.NEXT_PUBLIC_APP_ENV,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID, authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET }, hostname);
  } catch { /* Keep the default CSP when an emulator guard fails. */ }
  const localConnections = localEmulators ? ` ${localEmulators.authOrigin} ${localEmulators.firestoreOrigin} ${localEmulators.storageOrigin}` : '';
  // Google tag origins are admitted only when app/layout.tsx renders the tag
  // (NEXT_PUBLIC_GA_MEASUREMENT_ID set at build time, not staging).
  const googleTag = gaMeasurementId() ? GOOGLE_TAG_CSP_SOURCES : null;
  const googleTagSources = (key: keyof typeof GOOGLE_TAG_CSP_SOURCES) => googleTag ? ` ${googleTag[key].join(' ')}` : '';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdn.plaid.com https://apis.google.com${filingOrigin}${googleTagSources('scriptSrc')}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://firebasestorage.googleapis.com https://storage.googleapis.com${localEmulators ? ` ${localEmulators.storageOrigin}` : ''}${googleTagSources('imgSrc')}`,
    "font-src 'self' data:",
    `connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://api.stripe.com https://api.plaid.com https://sandbox.plaid.com https://production.plaid.com https://api.openai.com${localConnections}${googleTagSources('connectSrc')}`,
    `frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://cdn.plaid.com https://${process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'writeoff-23910.firebaseapp.com'}${filingOrigin}${localEmulators ? ` ${localEmulators.authOrigin}` : ''}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(!localEmulators ? ["upgrade-insecure-requests"] : []),
  ].join('; ');

  response.headers.set('Content-Security-Policy', csp);

  // Remove server identification
  response.headers.delete('X-Powered-By');
  response.headers.delete('Server');

  return response;
}

// ── Blocked paths (return 404 to avoid enumeration) ──────────────────────
const BLOCKED_PATHS = [
  '/wp-admin',
  '/wp-login',
  '/.env',
  '/.git',
  '/phpinfo',
  '/admin',
  '/config',
  '/backup',
  '/.well-known/security.txt', // handled separately if needed
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ip = getClientIP(request);

  // ── Block common attack paths ─────────────────────────────────────────
  for (const blocked of BLOCKED_PATHS) {
    if (pathname.startsWith(blocked)) {
      return new NextResponse(null, { status: 404 });
    }
  }

  // Block requests with suspicious patterns (SQL injection, path traversal)
  const suspiciousPatterns = [
    /\.\.\//,             // path traversal
    /<script/i,           // XSS in URL
    /union.*select/i,     // SQL injection
    /exec\s*\(/i,         // command injection
    /%2e%2e/i,            // encoded path traversal
  ];
  const fullUrl = request.url;
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(fullUrl)) {
      return new NextResponse('Bad Request', { status: 400 });
    }
  }

  // ── Rate limiting ─────────────────────────────────────────────────────
  if (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/user/delete')) {
    // Strict limit on auth and destructive endpoints
    if (!rateLimit(ipRateMap, `auth:${ip}`, AUTH_LIMIT)) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '60', 'Content-Type': 'text/plain' },
      });
    }
  } else if (pathname.startsWith('/api/tax/import-document')) {
    // Limit document uploads (GPT-4o vision is expensive)
    if (!rateLimit(ipRateMap, `upload:${ip}`, UPLOAD_LIMIT)) {
      return new NextResponse(JSON.stringify({ error: 'Too many document uploads. Please wait 1 minute.' }), {
        status: 429,
        headers: { 'Retry-After': '60', 'Content-Type': 'application/json' },
      });
    }
  } else if (pathname.startsWith('/api/')) {
    // General API rate limit
    if (!rateLimit(ipRateMap, `api:${ip}`, API_LIMIT)) {
      return new NextResponse(JSON.stringify({ error: 'Too many requests. Please slow down.' }), {
        status: 429,
        headers: { 'Retry-After': '60', 'Content-Type': 'application/json' },
      });
    }
  } else {
    // Page-level rate limit
    if (!rateLimit(ipRateMap, `page:${ip}`, IP_LIMIT)) {
      return new NextResponse('Too Many Requests', { status: 429 });
    }
  }

  // ── Allow webhooks without auth headers (they have their own sig verification) ──
  if (
    pathname === '/api/stripe/webhook' ||
    pathname === '/api/plaid/webhook' ||
    pathname === '/api/plaid/sync-transactions-internal'
  ) {
    const response = NextResponse.next();
    return addSecurityHeaders(response, request.nextUrl.hostname);
  }

  // ── Enforce HTTPS in production ────────────────────────────────────────
  if (process.env.NODE_ENV === 'production') {
    const proto = request.headers.get('x-forwarded-proto');
    if (proto && proto !== 'https') {
      const httpsUrl = request.url.replace('http://', 'https://');
      return NextResponse.redirect(httpsUrl, { status: 301 });
    }
  }

  // ── Apply security headers to all responses ───────────────────────────
  const response = NextResponse.next();
  return addSecurityHeaders(response, request.nextUrl.hostname);
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (Next.js image optimization)
     * - favicon.ico
     * - public folder files (icons, manifests)
     */
    '/((?!_next/static|_next/image|favicon.ico|icons/|manifest|sw\\.js|workbox).*)',
  ],
};
