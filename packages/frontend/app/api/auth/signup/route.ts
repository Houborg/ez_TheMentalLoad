import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

function getBackendUrl(): string {
  return (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export async function POST(request: Request) {
  const body = await request.text();
  let upstream: Response;
  try {
    upstream = await fetch(`${getBackendUrl()}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch {
    return NextResponse.json({ message: 'Backend unavailable' }, { status: 502 });
  }

  const data = await upstream.json();
  const setCookie = upstream.headers.get('set-cookie');
  const tokenMatch = setCookie?.match(/ml_session=([^;]+)/);

  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (tokenMatch) {
    const maxAge = 60 * 60 * 24 * 30;
    headers.append('Set-Cookie', [
      `${COOKIE_NAME}=${tokenMatch[1]}`,
      'Path=/',
      'HttpOnly',
      `Max-Age=${maxAge}`,
      'SameSite=Lax',
      'Secure',
    ].join('; '));
  }

  return new Response(JSON.stringify(data), { status: upstream.status, headers });
}
