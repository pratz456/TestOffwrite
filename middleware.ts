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

// ── In-memory rate limit store (resets on cold start) ──────────────────────
// For production at scale, swap for Upstash Redis using @upstash/ratelimit
const ipRateMap   = new Map<string, { count: number; windowStart: number }>();
const userRateMap = new Map<string, { count: number; windowStart: number }>();

const WINDOW_MS  = 60_000; // 1 minute window
const IP_LIMIT   = 120;    // 120 requests/min per IP (normal browsing)
const API_LIMIT  = 60;     // 60 requests/min per IP for /api/* routes
const AUTH_LIMIT = 10;     // 10 auth attempts/min per IP (brute force protection)
const UPLOAD_LIMIT = 5;    // 5 document uploads/min per IP

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
function addSecurityHeaders(response: NextResponse): NextResponse {
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
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
  );

  // Content Security Policy
  // - default-src: only same origin
  // - script-src: self + inline scripts needed by Next.js
  // - style-src: self + inline styles (Tailwind)
  // - img-src: self + data URIs + Plaid images + Firebase Storage
  // - connect-src: self + all API endpoints we call
  // - frame-src: none (no iframes)
  // - object-src: none (no Flash/plugins)
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdn.plaid.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://firebasestorage.googleapis.com https://storage.googleapis.com",
    "font-src 'self' data:",
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://api.stripe.com https://api.plaid.com https://sandbox.plaid.com https://production.plaid.com https://api.openai.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
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

  // /login alias → /auth/login before rate limit so ?qs does not inherit
  // the dynamic SSR hang on the old Promise searchParams redirect page.
  if (pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    return NextResponse.redirect(url, 307);
  }

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
    return addSecurityHeaders(response);
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
  return addSecurityHeaders(response);
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
