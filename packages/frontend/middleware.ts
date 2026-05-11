import { type NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, COOKIE_NAME } from '@/lib/auth';

const PUBLIC_PREFIXES = [
  '/login',
  '/signup',
  '/setup',
  '/forgot-password',
  '/reset-password',
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
