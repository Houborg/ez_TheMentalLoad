/**
 * Auth utilities using the Web Crypto API so they work in both
 * the Node.js runtime (API routes) and the Edge runtime (middleware).
 * Verifies HS256 JWTs signed by the backend.
 */

export const COOKIE_NAME = 'ml_session';

export interface SessionPayload {
  userId: string;
  familyId: string;
  role: 'admin' | 'member';
}

function getSecret(): string {
  return (
    process.env.AUTH_SECRET ??
    'dev-secret-please-set-AUTH_SECRET-env-in-production'
  );
}

function b64urlDecode(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts as [string, string, string];

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(getSecret()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sig),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    if (!valid) return null;

    const data = JSON.parse(
      new TextDecoder().decode(b64urlDecode(payload)),
    ) as Record<string, unknown>;

    if (typeof data.exp === 'number' && Date.now() / 1000 > data.exp) return null;
    if (typeof data.userId !== 'string' || typeof data.familyId !== 'string') return null;

    return {
      userId: data.userId,
      familyId: data.familyId,
      role: (data.role as 'admin' | 'member') ?? 'admin',
    };
  } catch {
    return null;
  }
}

/**
 * Returns true when the request arrived over HTTPS — either directly
 * or via a reverse proxy that set x-forwarded-proto.
 */
export function isHttpsRequest(headers: Headers, url: string): boolean {
  return headers.get('x-forwarded-proto') === 'https' || url.startsWith('https://');
}
