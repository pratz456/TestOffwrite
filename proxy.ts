import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  // Add Permissions-Policy headers to fix console violations
  // These features are requested by Plaid but not critical for functionality
  // Setting them to empty allows the browser to handle them gracefully
  response.headers.set(
    'Permissions-Policy',
    'accelerometer=(), encrypted-media=(), geolocation=(), microphone=(), camera=()'
  );

  return response;
}

// Only run proxy on non-static routes
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)).*)',
  ],
};
