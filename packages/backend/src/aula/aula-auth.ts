// packages/backend/src/aula/aula-auth.ts
import { AulaTokens, AulaLoginError } from './aula-types.js';

const AULA_TOKEN_URL = 'https://login.aula.dk/simplesaml/module.php/oidc/token.php';
const AULA_CLIENT_ID = '_99949a54b8b65423862aac1bf629599ed64231607a';
const SIDECAR_URL = process.env.AULA_SIDECAR_URL ?? 'http://localhost:8765';

// ── Login via Python sidecar ──────────────────────────────────────────────────
// The MitID TOKEN auth uses SRP-6a (Secure Remote Password) which is
// implemented in the nickknissen/aula Python library. We delegate to it.

export async function aulaLogin(
  username: string,
  password: string,
  totpCode: string,
): Promise<AulaTokens> {
  let res: Response;
  try {
    res = await fetch(`${SIDECAR_URL}/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, totp_code: totpCode }),
    });
  } catch (err) {
    throw new AulaLoginError(
      `Aula sidecar unreachable: ${err instanceof Error ? err.message : String(err)}`,
      'network_error',
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'unknown error' })) as { detail?: string };
    const detail = body.detail ?? 'unknown error';
    const code =
      detail.toLowerCase().includes('password') || detail.toLowerCase().includes('credentials')
        ? 'invalid_credentials'
        : detail.toLowerCase().includes('token') || detail.toLowerCase().includes('totp')
          ? 'expired_code'
          : 'unknown';
    throw new AulaLoginError(detail, code);
  }

  const data = await res.json() as { access_token?: string; refresh_token?: string; expires_at?: string };

  if (!data.access_token || !data.refresh_token) {
    throw new AulaLoginError('Sidecar returned incomplete tokens', 'unknown');
  }

  const expiresAt = data.expires_at
    ? new Date(data.expires_at).toISOString()
    : new Date(Date.now() + 3600 * 1000).toISOString();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
  };
}

// ── Token refresh (standard OAuth2, no SRP needed) ───────────────────────────

export async function aulaRefresh(refreshToken: string): Promise<AulaTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: AULA_CLIENT_ID,
  });

  const res = await fetch(AULA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Aula token refresh failed: ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const accessToken = data['access_token'] as string | undefined;
  const newRefreshToken = (data['refresh_token'] as string | undefined) ?? refreshToken;
  const expiresIn = data['expires_in'] as number | undefined;

  if (!accessToken) throw new Error('Refresh response missing access_token');

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt: new Date(Date.now() + (expiresIn ?? 3600) * 1000).toISOString(),
  };
}
