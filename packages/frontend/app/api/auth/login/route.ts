import { type NextRequest, NextResponse } from 'next/server';
import { isHttpsRequest } from '@/lib/auth';

function getBackendUrl(): string {
  return (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
  }

  const { email, password } = (body ?? {}) as { email?: string; password?: string };

  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ message: 'email and password are required' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${getBackendUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return NextResponse.json({ message: 'Backend unavailable' }, { status: 502 });
  }

  const data = await upstream.json() as { ok?: boolean; message?: string };

  if (!upstream.ok) {
    return NextResponse.json({ message: data.message ?? 'Login failed' }, { status: upstream.status });
  }

  const response = NextResponse.json({ ok: true });
  const setCookie = upstream.headers.get('set-cookie');
  if (setCookie) {
    const tokenMatch = setCookie.match(/ml_session=([^;]+)/);
    if (tokenMatch) {
      const secure = isHttpsRequest(request.headers, request.url);
      response.cookies.set('ml_session', tokenMatch[1], {
        path: '/',
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 30, // 30 days
        sameSite: 'lax',
        secure,
      });
    } else {
      response.headers.set('set-cookie', setCookie);
    }
  }

  return response;
}
