import { type NextRequest, NextResponse } from 'next/server';

function getBackendUrl(): string {
  return (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  try {
    const upstream = await fetch(`${getBackendUrl()}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json({ message: 'Backend unavailable' }, { status: 502 });
  }
}
