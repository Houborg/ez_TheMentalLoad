import { type NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, isHttpsRequest } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const secure = isHttpsRequest(request.headers, request.url);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return response;
}
