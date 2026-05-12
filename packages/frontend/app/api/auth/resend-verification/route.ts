import { type NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

function getBackendUrl(): string {
  return (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export async function POST(request: NextRequest) {
  const cookie = request.cookies.get(COOKIE_NAME)?.value ?? '';
  try {
    const upstream = await fetch(`${getBackendUrl()}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Cookie': `${COOKIE_NAME}=${cookie}` },
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json({ message: 'Backend unavailable' }, { status: 502 });
  }
}
