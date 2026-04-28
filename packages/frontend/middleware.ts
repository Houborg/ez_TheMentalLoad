import { type NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, COOKIE_NAME } from '@/lib/auth';

/** Paths that are accessible without authentication. */
const PUBLIC_PREFIXES = ['/login', '/api/auth/'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow all public paths through without checking auth.
  if (PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(COOKIE_NAME)?.value;

  if (sessionToken && (await verifySessionToken(sessionToken))) {
    return NextResponse.next();
  }

  // Not authenticated — redirect to login, preserving the intended destination.
  const loginUrl = new URL('/login', request.url);
  if (pathname !== '/') {
    loginUrl.searchParams.set('from', pathname);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on all routes except Next.js internals and static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
