// packages/backend/src/aula/aula-auth.ts
import { AulaTokens, AulaLoginError } from './aula-types.js';

const AULA_TOKEN_URL = 'https://login.aula.dk/simplesaml/module.php/oidc/token.php';
const AULA_CLIENT_ID = '_99949a54b8b65423862aac1bf629599ed64231607a';
const SIDECAR_URL = process.env.AULA_SIDECAR_URL ?? 'http://localhost:8765';

// ── Login via Python sidecar ──────────────────────────────────────────────────
// The MitID TOKEN auth uses SRP-6a (Secure Remote Password) which is
// implemented in the nickknissen/aula Python library. We delegate to it.

// Start an APP-method auth session — returns session_id, then poll for QR + completion
export async function aulaAuthStart(username: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${SIDECAR_URL}/authenticate/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
  } catch (err) {
    throw new AulaLoginError(
      `Aula sidecar unreachable: ${err instanceof Error ? err.message : String(err)}`,
      'network_error',
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'unknown' })) as { detail?: string };
    throw new AulaLoginError(body.detail ?? 'Failed to start auth', 'unknown');
  }
  const data = await res.json() as { session_id: string };
  return data.session_id;
}

export type AulaPollResult =
  | { status: 'pending' }
  | { status: 'qr_ready'; qrCodes: unknown[] }
  | { status: 'completed'; tokens: AulaTokens; qrCodes?: unknown[] }
  | { status: 'error'; error: string };

export async function aulaAuthPoll(sessionId: string): Promise<AulaPollResult> {
  let res: Response;
  try {
    res = await fetch(`${SIDECAR_URL}/authenticate/poll/${sessionId}`);
  } catch (err) {
    throw new AulaLoginError(
      `Aula sidecar unreachable: ${err instanceof Error ? err.message : String(err)}`,
      'network_error',
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'unknown' })) as { detail?: string };
    throw new AulaLoginError(body.detail ?? 'Poll failed', 'unknown');
  }

  const data = await res.json() as {
    status: string;
    qr_codes?: unknown[];
    access_token?: string;
    refresh_token?: string;
    expires_at?: string;
    error?: string;
  };

  if (data.status === 'completed' && data.access_token && data.refresh_token) {
    return {
      status: 'completed',
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_at ?? new Date(Date.now() + 3600_000).toISOString(),
      },
      qrCodes: data.qr_codes ?? [],  // children are passed via qr_codes field from sidecar
    };
  }
  if (data.status === 'qr_ready') return { status: 'qr_ready', qrCodes: data.qr_codes ?? [] };
  if (data.status === 'error') return { status: 'error', error: data.error ?? 'Unknown error' };
  return { status: 'pending' };
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
