// packages/frontend/lib/aula-api.ts

export interface AulaChild {
  id: number;
  name: string;
  institutionName: string;
}

export interface AulaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface AulaChildMapping {
  aulaChildId: number;
  aulaChildName: string;
  mentalLoadMemberId: string;
  calendarId: string;
}

export interface AulaSyncOptions {
  importToCalendar: boolean;
  calendarEvents: boolean;
  dailyOverview: boolean;
  posts: boolean;
  messages: boolean;
  muTasks: boolean;
  presence: boolean;
}

export interface AulaConnectionPublic {
  id: string;
  isConnected: boolean;
  aulaUsername: string;
  expiresAt: string;
  childMappings: AulaChildMapping[];
  syncOptions: AulaSyncOptions;
  syncIntervalMinutes: number;
  lastSyncAt?: string;
  lastSyncStats?: { entriesCreated: number; itemsCreated: number };
  createdAt: string;
}

export interface AulaItem {
  id: string;
  aula_id: string;
  type: 'post' | 'message' | 'daily_overview' | 'weekplan_lesson' | 'mu_task' | 'presence';
  title?: string;
  body?: string;
  author?: string;
  member_id?: string;
  published_at?: string;
  created_at: string;
  raw_json?: Record<string, unknown>;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  const method = (init?.method ?? 'GET').toUpperCase();
  let body = init?.body;
  // Workaround: empty-body POST/PUT/PATCH over HTTP/2 through the Cloudflare tunnel
  // hangs (the body stream never closes). Send a valid empty JSON object instead
  // and set Content-Type so Fastify accepts it. DELETE stays body-less since
  // Fastify rejects empty JSON bodies on DELETE (FST_ERR_CTP_EMPTY_JSON_BODY).
  if (body == null && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    body = '{}';
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  } else if (body != null && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; code?: string };
    throw Object.assign(new Error(err.error ?? 'Request failed'), { status: res.status, code: err.code });
  }
  return res.json() as Promise<T>;
}

export async function aulaAuthStart(username: string): Promise<{ sessionId: string }> {
  return apiFetch('/v1/aula/auth/start', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
}

export type AulaPollResult =
  | { status: 'pending' }
  | { status: 'qr_ready'; qrCodes: unknown[] }
  | { status: 'completed'; tokens: AulaTokens; children: AulaChild[] }
  | { status: 'error'; error: string };

export async function aulaAuthPoll(sessionId: string): Promise<AulaPollResult> {
  return apiFetch(`/v1/aula/auth/poll/${sessionId}`);
}

export async function aulaConnect(payload: {
  tokens: AulaTokens;
  tokenData?: Record<string, unknown>;
  aulaUsername: string;
  childMappings: AulaChildMapping[];
  syncOptions: AulaSyncOptions;
  syncIntervalMinutes?: number;
}): Promise<{ connection: AulaConnectionPublic }> {
  return apiFetch('/v1/aula/connect', { method: 'POST', body: JSON.stringify(payload) });
}

export async function aulaGetConnection(): Promise<{ connection: AulaConnectionPublic | null }> {
  return apiFetch('/v1/aula/connection');
}

export async function aulaDisconnect(): Promise<void> {
  await apiFetch('/v1/aula/connection', { method: 'DELETE' });
}

export async function aulaTriggerSync(): Promise<{ stats: { entriesCreated: number; itemsCreated: number } }> {
  return apiFetch('/v1/aula/sync', { method: 'POST' });
}

export async function aulaGetItems(opts?: {
  type?: string;
  memberId?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: AulaItem[] }> {
  const params = new URLSearchParams();
  if (opts?.type) params.set('type', opts.type);
  if (opts?.memberId) params.set('memberId', opts.memberId);
  if (opts?.page != null) params.set('page', String(opts.page));
  if (opts?.pageSize != null) params.set('pageSize', String(opts.pageSize));
  return apiFetch(`/v1/aula/items?${params}`);
}

export async function aulaDeleteItem(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/aula/items/${id}`, { method: 'DELETE' });
}
