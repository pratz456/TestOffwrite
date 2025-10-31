import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });

  try {
    // Enforce canonical domain in production
    if (process.env.NODE_ENV === 'production') {
      const host = request.headers.get('host')?.toLowerCase() || '';
      const isCanonical = host === 'writeoffapp.com';
      const shouldRedirectToCanonical = !isCanonical && (
        host === 'www.writeoffapp.com' || host.endsWith('.web.app') || host.endsWith('.firebaseapp.com')
      );

      if (shouldRedirectToCanonical) {
        const url = request.nextUrl.clone();
        url.host = 'writeoffapp.com';
        url.protocol = 'https:';
        return NextResponse.redirect(url, { status: 301 });
      }
    }

    // Skip middleware for static assets and API routes
    if (isStaticAsset(request) || isApiRoute(request)) {
      return response;
    }

    // Accept either server-set session or client-readable token
    const serverSession = request.cookies.get('__session')?.value;
    const firebaseToken = request.cookies.get('firebase-auth-token')?.value;

    // Debug logging for production troubleshooting
    if (process.env.NODE_ENV === 'production') {
      console.log('[middleware] Processing request:', request.nextUrl.pathname);
      console.log('[middleware] Has __session cookie:', !!serverSession);
      console.log('[middleware] Has firebase-auth-token cookie:', !!firebaseToken);
      console.log('[middleware] All cookies:', Array.from(request.cookies.getAll()).map(c => c.name));
    }

    // Only redirect to login for protected routes without token
    const isAuthenticated = Boolean(serverSession || firebaseToken);
    if (!isAuthenticated && request.nextUrl.pathname.startsWith("/protected")) {
      console.log('[middleware] No auth token found, redirecting to login for protected route:', request.nextUrl.pathname);
      const url = request.nextUrl.clone();
      url.pathname = "/auth/login";
      url.searchParams.set('redirect', request.nextUrl.pathname);
      return NextResponse.redirect(url);
    }

    return response;
  } catch (error) {
    console.error('Error in middleware:', error);
    return response;
  }
}

function isStaticAsset(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname;
  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon.ico') ||
    !!pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/)
  );
}

function isApiRoute(request: NextRequest): boolean {
  return request.nextUrl.pathname.startsWith('/api/');
}
