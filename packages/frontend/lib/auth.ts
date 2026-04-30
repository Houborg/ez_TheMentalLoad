/**
 * Auth utilities using the Web Crypto API so they work in both
 * the Node.js runtime (API routes) and the Edge runtime (middleware).
 */

export const COOKIE_NAME = 'ml_session';

const SESSION_PAYLOAD = 'ml:authenticated';

function getSecret(): string {
  return (
    process.env.AUTH_SECRET ??
    'dev-secret-please-set-AUTH_SECRET-env-in-production'
  );
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createSessionToken(): Promise<string> {
  const key = await importKey(getSecret());
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(SESSION_PAYLOAD),
  );
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const key = await importKey(getSecret());
    const sigBytes = new Uint8Array(
      token.match(/.{2}/g)?.map(h => parseInt(h, 16)) ?? [],
    );
    return crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(SESSION_PAYLOAD),
    );
  } catch {
    return false;
  }
}

export function validateCredentials(username: string, password: string): boolean {
  const validUsername = process.env.AUTH_USERNAME ?? 'DEV';
  const validPassword = process.env.AUTH_PASSWORD ?? 'TheMentalLoad2026';

  const checkField = (input: string, valid: string): boolean => {
    let diff = input.length ^ valid.length;
    const len = Math.max(input.length, valid.length);
    for (let i = 0; i < len; i++) {
      diff |= (input.charCodeAt(i) || 0) ^ (valid.charCodeAt(i) || 0);
    }
    return diff === 0;
  };

  const usernameOk = checkField(username, validUsername);
  const passwordOk = checkField(password, validPassword);
  return usernameOk && passwordOk;
}

/**
 * Returns true when the request arrived over HTTPS — either directly
 * or via a reverse proxy that set x-forwarded-proto.
 * Used to decide whether to mark cookies as Secure.
 */
export function isHttpsRequest(headers: Headers, url: string): boolean {
  return headers.get('x-forwarded-proto') === 'https' || url.startsWith('https://');
}
