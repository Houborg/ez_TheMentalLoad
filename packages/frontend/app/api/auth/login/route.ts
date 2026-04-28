import { type NextRequest, NextResponse } from 'next/server';
import { createSessionToken, validateCredentials, COOKIE_NAME } from '@/lib/auth';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
  }

  const { username, password } = (body ?? {}) as { username?: string; password?: string };

  if (typeof username !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ message: 'username and password are required' }, { status: 400 });
  }

  const valid = validateCredentials(username, password);

  if (!valid) {
    // Artificial delay so timing attacks learn nothing useful.
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 200));
    return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
  }

  const token = await createSessionToken();

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return response;
}
