import { type NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

function getBackendUrl(): string {
  return (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const cookie = request.cookies.get(COOKIE_NAME)?.value ?? '';
  try {
    const upstream = await fetch(`${getBackendUrl()}/api/auth/setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `${COOKIE_NAME}=${cookie}`,
      },
      body,
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json({ message: 'Backend unavailable' }, { status: 502 });
  }
}
