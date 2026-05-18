import { type NextRequest, NextResponse } from 'next/server';
import { isHttpsRequest } from '@/lib/auth';

function getBackendUrl(): string {
  return (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export async function POST(request: NextRequest) {
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
  const response = NextResponse.json(data, { status: upstream.status });
  const setCookie = upstream.headers.get('set-cookie');
  if (setCookie) {
    const tokenMatch = setCookie.match(/ml_session=([^;]+)/);
    if (tokenMatch) {
      const secure = isHttpsRequest(request.headers, request.url);
      const maxAge = 60 * 60 * 24 * 30;
      const cookieValue = [
        `ml_session=${tokenMatch[1]}`,
        'Path=/',
        'HttpOnly',
        `Max-Age=${maxAge}`,
        'SameSite=Lax',
        ...(secure ? ['Secure'] : []),
      ].join('; ');
      response.headers.set('set-cookie', cookieValue);
    } else {
      response.headers.set('set-cookie', setCookie);
    }
  }
  return response;
}
