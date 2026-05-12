import { type NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, COOKIE_NAME } from '@/lib/auth';

const PUBLIC_PREFIXES = [
  '/login',
  '/signup',
  '/setup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/api/auth/',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(COOKIE_NAME)?.value;

  if (sessionToken) {
    const payload = await verifySessionToken(sessionToken);
    if (payload) {
      // Check email verification for page routes only (avoid loops on API calls)
      if (!pathname.startsWith('/api/')) {
        try {
          const backendUrl = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
          const me = await fetch(`${backendUrl}/api/auth/me`, {
            headers: { 'Cookie': `${COOKIE_NAME}=${sessionToken}` },
            signal: AbortSignal.timeout(3000),
          });
          if (me.status === 403) {
            return NextResponse.redirect(new URL('/verify-email', request.url));
          }
        } catch {
          // Backend unreachable — let the request through, don't block on network errors
        }
      }
      return NextResponse.next();
    }
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  if (pathname !== '/') {
    loginUrl.searchParams.set('from', pathname);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
