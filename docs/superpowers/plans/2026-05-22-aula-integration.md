# Aula Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Aula school data (calendar events, posts, messages, daily overviews) into MentalLoad via a custom TypeScript client and a guided 5-step mobile settings wizard.

**Architecture:** Custom thin TypeScript Aula client (`aula-auth.ts` + `aula-client.ts`) — no external Aula library. MitID TOKEN method (username + password + 6-digit code). Dedicated `AulaConnectionService`, `AulaSyncService`, and Fastify plugin. Sync worker extended with a parallel Aula loop. Mobile wizard mirrors the Apple Calendar setup flow.

**Tech Stack:** Node.js `fetch` + manual cookie jar, Node.js `crypto` for PKCE, PostgreSQL, Fastify, Next.js/React, TypeScript. Reference impl: https://github.com/scaarup/aula

---

## File Map

**Create:**
- `packages/backend/migrations/013_aula_items.sql`
- `packages/backend/src/aula/aula-types.ts` — shared interfaces (AulaConnection, AulaChild, AulaTokens, AulaItem)
- `packages/backend/src/aula/aula-auth.ts` — 8-step PKCE/SAML/OAuth2 login + token refresh + CookieJar
- `packages/backend/src/aula/aula-client.ts` — authenticated Aula REST API methods
- `packages/backend/src/aula/aula-connection-service.ts` — CRUD for aula_connection in settings_json
- `packages/backend/src/aula/aula-connection-service.test.ts`
- `packages/backend/src/aula/aula-sync-service.ts` — sync logic (events → entries, items → aula_items)
- `packages/backend/src/aula/aula-routes.ts` — Fastify plugin with all /api/v1/aula/* routes
- `packages/frontend/lib/aula-api.ts` — frontend fetch helpers
- `packages/frontend/components/mobile/mobile-aula-settings.tsx` — 5-step wizard + connected state

**Modify:**
- `packages/backend/src/workers/sync-worker.ts` — add Aula sync loop
- `packages/backend/src/app.ts` — register aula-routes plugin
- `packages/frontend/components/mobile/mobile-settings-content.tsx` — add Aula tab

---

## Task 1: Migration — aula_items table

**Files:**
- Create: `packages/backend/migrations/013_aula_items.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 013_aula_items.sql
-- Stores non-calendar Aula data: posts, messages, daily overviews.
-- Calendar events go directly into the entries table via externalUid dedup.

create table if not exists aula_items (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  aula_id      text not null,
  type         text not null check (type in ('post', 'message', 'daily_overview')),
  title        text,
  body         text,
  author       text,
  member_id    uuid references members(id) on delete set null,
  published_at timestamptz,
  raw_json     jsonb,
  created_at   timestamptz not null default now(),
  unique(family_id, aula_id, type)
);

create index if not exists idx_aula_items_family
  on aula_items(family_id);

create index if not exists idx_aula_items_published
  on aula_items(family_id, published_at desc);
```

- [ ] **Step 2: Verify migration runs**

```bash
cd packages/backend && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mental_load npm run migrate
```

Expected: `Database migrations applied successfully.`

- [ ] **Step 3: Commit**

```bash
git add packages/backend/migrations/013_aula_items.sql
git commit -m "feat: migration 013 — aula_items table"
```

---

## Task 2: Types

**Files:**
- Create: `packages/backend/src/aula/aula-types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// packages/backend/src/aula/aula-types.ts

export interface AulaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
}

export interface AulaChildMapping {
  aulaChildId: number;
  aulaChildName: string;
  mentalLoadMemberId: string;
  calendarId: string;
}

export interface AulaSyncOptions {
  importToCalendar: boolean; // master gate — off by default during dev
  calendarEvents: boolean;
  dailyOverview: boolean;
  posts: boolean;
  messages: boolean;
}

export interface AulaConnection extends AulaTokens {
  id: string;
  isConnected: boolean;
  aulaUsername: string;
  childMappings: AulaChildMapping[];
  syncOptions: AulaSyncOptions;
  syncIntervalMinutes: number;
  lastSyncAt?: string;
  lastSyncStats?: {
    entriesCreated: number;
    itemsCreated: number;
  };
  createdAt: string;
}

// Public view — tokens stripped
export type AulaConnectionPublic = Omit<AulaConnection, 'accessToken' | 'refreshToken'>;

export interface AulaChild {
  id: number;
  name: string;
  institutionName: string;
}

export interface AulaCalendarEvent {
  id: string | number;
  title: string;
  startTime: string;   // ISO
  endTime: string;     // ISO
  allDay: boolean;
  location?: string;
  description?: string;
  childId: number;
}

export interface AulaPost {
  id: string | number;
  title?: string;
  body: string;
  author?: string;
  publishedAt?: string;
}

export interface AulaMessage {
  id: string | number;
  threadId: number;
  subject?: string;
  body: string;
  author?: string;
  sentAt?: string;
}

export interface AulaDailyOverview {
  childId: number;
  date: string; // YYYY-MM-DD
  status?: string;
  entryTime?: string;
  exitTime?: string;
}

export class AulaAuthExpiredError extends Error {
  constructor() {
    super('Aula token refresh failed — re-authentication required');
    this.name = 'AulaAuthExpiredError';
  }
}

export class AulaLoginError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid_credentials' | 'expired_code' | 'network_error' | 'unknown',
  ) {
    super(message);
    this.name = 'AulaLoginError';
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/backend && npm run typecheck 2>&1 | grep "aula-types" | head -5
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/aula/aula-types.ts
git commit -m "feat: Aula type definitions"
```

---

## Task 3: Aula auth module

**Files:**
- Create: `packages/backend/src/aula/aula-auth.ts`

The 8-step login flow follows the scaarup/aula Python reference. Each step is a named private method so failures are easy to trace. The `CookieJar` class accumulates cookies across all HTTP calls without any external dependency.

> **Note:** This module must be tested manually with real Aula credentials during development. The unit tests below mock at the `fetch` level to verify the structure only — real auth validation requires live credentials.

- [ ] **Step 1: Write aula-auth.ts**

```typescript
// packages/backend/src/aula/aula-auth.ts
import crypto from 'node:crypto';
import { AulaTokens, AulaLoginError } from './aula-types.js';

const AULA_CLIENT_ID = '_99949a54b8b65423862aac1bf629599ed64231607a';
const AULA_REDIRECT_URI = 'https://www.aula.dk/portal/oauth2callback.php';
const AULA_AUTHORIZE_URL = 'https://login.aula.dk/simplesaml/module.php/oidc/authorize.php';
const AULA_TOKEN_URL = 'https://login.aula.dk/simplesaml/module.php/oidc/token.php';
const MITID_INITIALIZE_URL = 'https://nemlog-in.mitid.dk/login/mitid/initialize';
const BROKER_URL = 'https://broker.unilogin.dk';

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36';

// ── Cookie jar ──────────────────────────────────────────────────────────────

class CookieJar {
  private cookies = new Map<string, string>();

  update(response: Response): void {
    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const header of setCookie) {
      const [nameValue] = header.split(';');
      if (!nameValue) continue;
      const eq = nameValue.indexOf('=');
      if (eq < 0) continue;
      const name = nameValue.slice(0, eq).trim();
      const value = nameValue.slice(eq + 1).trim();
      this.cookies.set(name, value);
    }
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ── HTML form parser ─────────────────────────────────────────────────────────

function extractFormAction(html: string): string | null {
  const match = html.match(/<form[^>]+action=["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

function extractHiddenInputs(html: string): Record<string, string> {
  const inputs: Record<string, string> = {};
  const re = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const nameMatch = m[0].match(/name=["']([^"']+)["']/i);
    const valueMatch = m[0].match(/value=["']([^"']*)["']/i);
    if (nameMatch?.[1]) {
      inputs[nameMatch[1]] = valueMatch?.[1] ?? '';
    }
  }
  return inputs;
}

function extractQueryParam(url: string, param: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get(param);
  } catch {
    return null;
  }
}

// ── Main login flow ──────────────────────────────────────────────────────────

export async function aulaLogin(
  username: string,
  password: string,
  totpCode: string,
): Promise<AulaTokens> {
  const jar = new CookieJar();
  const { verifier, challenge } = generatePkce();

  try {
    // Step 1-2: Visit authorize URL, follow SAML redirect chain to broker
    const brokerUrl = await step_followAuthorizationRedirects(jar, challenge);

    // Step 3: At broker — select MitID identity provider
    const mitidStartUrl = await step_selectMitIdAtBroker(jar, brokerUrl);

    // Step 4: Initialize MitID session
    const { authSessionId, verificationToken } = await step_initializeMitId(jar, mitidStartUrl);

    // Step 5: Authenticate with TOKEN method (username + password + TOTP code)
    const samlPayload = await step_authenticateToken(
      jar, authSessionId, verificationToken, username, password, totpCode,
    );

    // Step 6: POST SAML response to broker, handle role selection (KONTAKT)
    const aulaSamlPayload = await step_processBrokerSaml(jar, samlPayload);

    // Step 7: POST SAML to Aula ACS, follow redirects to get OAuth code
    const oauthCode = await step_processAulaSaml(jar, aulaSamlPayload);

    // Step 8: Exchange code for tokens
    return await step_exchangeCodeForTokens(oauthCode, verifier);
  } catch (err) {
    if (err instanceof AulaLoginError) throw err;
    throw new AulaLoginError(
      `Unexpected error during Aula login: ${err instanceof Error ? err.message : String(err)}`,
      'unknown',
    );
  }
}

async function step_followAuthorizationRedirects(jar: CookieJar, challenge: string): Promise<string> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: AULA_CLIENT_ID,
    redirect_uri: AULA_REDIRECT_URI,
    scope: 'aula-sensitive',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: crypto.randomBytes(16).toString('hex'),
  });

  let currentUrl = `${AULA_AUTHORIZE_URL}?${params}`;

  // Follow redirect chain manually until we reach broker.unilogin.dk
  for (let i = 0; i < 10; i++) {
    const res = await fetch(currentUrl, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Cookie: jar.header() },
    });
    jar.update(res);

    if (res.status === 200) {
      // At broker — return current URL
      return currentUrl;
    }

    const location = res.headers.get('location');
    if (!location) throw new AulaLoginError('Lost redirect chain at authorization step', 'unknown');

    currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;

    if (currentUrl.includes('broker.unilogin.dk')) {
      return currentUrl;
    }
  }

  throw new AulaLoginError('Too many redirects in authorization step', 'unknown');
}

async function step_selectMitIdAtBroker(jar: CookieJar, brokerUrl: string): Promise<string> {
  const res = await fetch(brokerUrl, {
    headers: { 'User-Agent': USER_AGENT, Cookie: jar.header() },
  });
  jar.update(res);
  const html = await res.text();

  // Find the MitID option link/form — look for nemlog-in.mitid.dk in href or action
  const mitidMatch = html.match(/href=["'](https:\/\/nemlog-in\.mitid\.dk[^"']+)["']/i)
    ?? html.match(/action=["'](https:\/\/nemlog-in\.mitid\.dk[^"']+)["']/i);

  if (!mitidMatch?.[1]) {
    // Try submitting the form to select KONTAKT role / MitID provider
    const action = extractFormAction(html);
    const inputs = extractHiddenInputs(html);

    // Select MitID (nemlogin3) identity provider
    const body = new URLSearchParams({ ...inputs });
    const formRes = await fetch(action ?? brokerUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: jar.header(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    jar.update(formRes);
    const location = formRes.headers.get('location');
    if (location?.includes('nemlog-in.mitid.dk')) return location;
    throw new AulaLoginError('Could not find MitID start URL at broker', 'unknown');
  }

  return mitidMatch[1];
}

async function step_initializeMitId(
  jar: CookieJar,
  mitidUrl: string,
): Promise<{ authSessionId: string; verificationToken: string }> {
  // Follow redirects to mitid initialize
  let currentUrl = mitidUrl;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(currentUrl, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Cookie: jar.header() },
    });
    jar.update(res);
    if (res.status === 200) {
      const html = await res.text();
      // Extract verification token from page
      const vtMatch = html.match(/verificationToken["'\s:]+["']([^"']+)["']/i);
      if (!vtMatch?.[1]) throw new AulaLoginError('No verificationToken in MitID init page', 'unknown');

      // POST to initialize endpoint
      const initRes = await fetch(MITID_INITIALIZE_URL, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          Cookie: jar.header(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ verificationToken: vtMatch[1] }),
      });
      jar.update(initRes);
      const data = await initRes.json() as Record<string, unknown>;
      const authSessionId = data['authenticationSessionId'] as string | undefined;
      if (!authSessionId) throw new AulaLoginError('No authenticationSessionId from MitID', 'unknown');
      return { authSessionId, verificationToken: vtMatch[1] };
    }
    const location = res.headers.get('location');
    if (!location) throw new AulaLoginError('Lost redirect at MitID init', 'unknown');
    currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
  }
  throw new AulaLoginError('Could not reach MitID initialization page', 'unknown');
}

async function step_authenticateToken(
  jar: CookieJar,
  authSessionId: string,
  verificationToken: string,
  username: string,
  password: string,
  totpCode: string,
): Promise<{ action: string; inputs: Record<string, string> }> {
  // Submit username
  const usernameRes = await fetch(
    `https://nemlog-in.mitid.dk/login/mitid/username`,
    {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: jar.header(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, authenticationSessionId: authSessionId, verificationToken }),
    },
  );
  jar.update(usernameRes);
  if (!usernameRes.ok) {
    throw new AulaLoginError('Invalid MitID username', 'invalid_credentials');
  }

  // Submit password
  const passwordRes = await fetch(
    `https://nemlog-in.mitid.dk/login/mitid/password`,
    {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: jar.header(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password, authenticationSessionId: authSessionId }),
    },
  );
  jar.update(passwordRes);
  if (!passwordRes.ok) {
    throw new AulaLoginError('Invalid MitID password', 'invalid_credentials');
  }

  // Submit TOTP code
  const totpRes = await fetch(
    `https://nemlog-in.mitid.dk/login/mitid/totp`,
    {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: jar.header(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ totpCode, authenticationSessionId: authSessionId }),
    },
  );
  jar.update(totpRes);
  if (!totpRes.ok) {
    const body = await totpRes.text().catch(() => '');
    const code = body.includes('expired') ? 'expired_code' : 'invalid_credentials';
    throw new AulaLoginError('MitID TOTP code rejected', code);
  }

  // Complete MitID — get SAML response page
  const completeRes = await fetch(
    `https://nemlog-in.mitid.dk/login/mitid`,
    {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: jar.header(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ authenticationSessionId: authSessionId, verificationToken }),
    },
  );
  jar.update(completeRes);
  const html = await completeRes.text();
  const action = extractFormAction(html);
  const inputs = extractHiddenInputs(html);
  if (!action || !inputs['SAMLResponse']) {
    throw new AulaLoginError('No SAML response after MitID authentication', 'unknown');
  }
  return { action, inputs };
}

async function step_processBrokerSaml(
  jar: CookieJar,
  samlPayload: { action: string; inputs: Record<string, string> },
): Promise<{ action: string; inputs: Record<string, string> }> {
  const body = new URLSearchParams(samlPayload.inputs);
  const res = await fetch(samlPayload.action, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Cookie: jar.header(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  jar.update(res);
  const html = await res.text();

  // May need to select KONTAKT role — look for role selection form
  if (html.includes('KONTAKT') || html.includes('role')) {
    const action = extractFormAction(html);
    const inputs = extractHiddenInputs(html);
    // Pick KONTAKT role
    const roleBody = new URLSearchParams({ ...inputs, role: 'KONTAKT' });
    const roleRes = await fetch(action ?? samlPayload.action, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: jar.header(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: roleBody.toString(),
    });
    jar.update(roleRes);
    const roleHtml = await roleRes.text();
    const finalAction = extractFormAction(roleHtml);
    const finalInputs = extractHiddenInputs(roleHtml);
    if (!finalAction || !finalInputs['SAMLResponse']) {
      throw new AulaLoginError('No SAML after broker role selection', 'unknown');
    }
    return { action: finalAction, inputs: finalInputs };
  }

  const action = extractFormAction(html);
  const inputs = extractHiddenInputs(html);
  if (!action || !inputs['SAMLResponse']) {
    throw new AulaLoginError('No SAML response from broker', 'unknown');
  }
  return { action, inputs };
}

async function step_processAulaSaml(
  jar: CookieJar,
  samlPayload: { action: string; inputs: Record<string, string> },
): Promise<string> {
  const body = new URLSearchParams(samlPayload.inputs);
  let res = await fetch(samlPayload.action, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'User-Agent': USER_AGENT,
      Cookie: jar.header(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  jar.update(res);

  // Follow redirects until we see the OAuth callback with ?code=
  for (let i = 0; i < 10; i++) {
    const location = res.headers.get('location');
    if (!location) break;

    const code = extractQueryParam(location, 'code');
    if (code) return code;

    res = await fetch(location, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Cookie: jar.header() },
    });
    jar.update(res);
  }

  throw new AulaLoginError('Could not extract OAuth code from Aula SAML flow', 'unknown');
}

async function step_exchangeCodeForTokens(code: string, verifier: string): Promise<AulaTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: AULA_REDIRECT_URI,
    client_id: AULA_CLIENT_ID,
    code_verifier: verifier,
  });

  const res = await fetch(AULA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new AulaLoginError(`Token exchange failed: ${res.status}`, 'unknown');
  }

  const data = await res.json() as Record<string, unknown>;
  const accessToken = data['access_token'] as string | undefined;
  const refreshToken = data['refresh_token'] as string | undefined;
  const expiresIn = data['expires_in'] as number | undefined;

  if (!accessToken || !refreshToken) {
    throw new AulaLoginError('Token response missing access_token or refresh_token', 'unknown');
  }

  const expiresAt = new Date(Date.now() + (expiresIn ?? 3600) * 1000).toISOString();
  return { accessToken, refreshToken, expiresAt };
}

// ── Token refresh ─────────────────────────────────────────────────────────────

export async function aulaRefresh(refreshToken: string): Promise<AulaTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: AULA_CLIENT_ID,
  });

  const res = await fetch(AULA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
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
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/backend && npm run typecheck 2>&1 | grep "aula-auth" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/aula/aula-auth.ts
git commit -m "feat: Aula auth module — 8-step PKCE/SAML/OAuth2 login + token refresh"
```

---

## Task 4: Aula API client

**Files:**
- Create: `packages/backend/src/aula/aula-client.ts`

- [ ] **Step 1: Write aula-client.ts**

```typescript
// packages/backend/src/aula/aula-client.ts
import { aulaRefresh } from './aula-auth.js';
import {
  AulaTokens, AulaChild, AulaCalendarEvent,
  AulaPost, AulaMessage, AulaDailyOverview, AulaAuthExpiredError,
} from './aula-types.js';

const AULA_API = 'https://www.aula.dk/api/v22';
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36';

// Token as query param — setting it as header too causes 400
function apiUrl(method: string, token: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ method, access_token: token, ...extra });
  return `${AULA_API}?${params}`;
}

export class AulaClient {
  private tokens: AulaTokens;
  private onTokenRefresh?: (tokens: AulaTokens) => Promise<void>;

  constructor(tokens: AulaTokens, onTokenRefresh?: (tokens: AulaTokens) => Promise<void>) {
    this.tokens = { ...tokens };
    this.onTokenRefresh = onTokenRefresh;
  }

  private async ensureFreshToken(): Promise<string> {
    const expiresAt = new Date(this.tokens.expiresAt).getTime();
    if (Date.now() < expiresAt - 5 * 60 * 1000) return this.tokens.accessToken;

    try {
      const refreshed = await aulaRefresh(this.tokens.refreshToken);
      this.tokens = refreshed;
      await this.onTokenRefresh?.(refreshed);
      return refreshed.accessToken;
    } catch {
      throw new AulaAuthExpiredError();
    }
  }

  private async get(method: string, extra?: Record<string, string>): Promise<unknown> {
    const token = await this.ensureFreshToken();
    const res = await fetch(apiUrl(method, token, extra), {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (res.status === 401) throw new AulaAuthExpiredError();
    if (!res.ok) throw new Error(`Aula API error: ${method} → ${res.status}`);
    const json = await res.json() as { data?: unknown };
    return json.data ?? json;
  }

  async getChildren(): Promise<AulaChild[]> {
    const data = await this.get('profiles.getProfilesByLogin') as Record<string, unknown>;
    const profiles = data['profiles'] as Array<Record<string, unknown>> | undefined ?? [];
    const children: AulaChild[] = [];
    for (const profile of profiles) {
      const childProfiles = profile['children'] as Array<Record<string, unknown>> | undefined ?? [];
      for (const child of childProfiles) {
        children.push({
          id: child['id'] as number,
          name: child['name'] as string ?? 'Ukendt',
          institutionName: (child['institutionName'] as string | undefined) ?? '',
        });
      }
    }
    return children;
  }

  async getProfileContext(): Promise<{ profileIds: number[]; institutionProfileIds: number[] }> {
    const data = await this.get('profiles.getProfileContext') as Record<string, unknown>;
    const profileIds = (data['profileIds'] as number[] | undefined) ?? [];
    const institutionProfileIds = (data['institutionProfileIds'] as number[] | undefined) ?? [];
    return { profileIds, institutionProfileIds };
  }

  async getCalendarEvents(
    childIds: number[],
    from: string,
    to: string,
  ): Promise<AulaCalendarEvent[]> {
    const ctx = await this.getProfileContext();
    const data = await this.get('calendar.getEventsByProfileIdsAndResourceIds', {
      profileIds: ctx.profileIds.join(','),
      resourceIds: childIds.join(','),
      start: from,
      end: to,
    }) as Record<string, unknown>;

    const events = (data['events'] as Array<Record<string, unknown>> | undefined) ?? [];
    return events.map(e => ({
      id: String(e['id']),
      title: (e['title'] as string | undefined) ?? 'Aula begivenhed',
      startTime: (e['startDateTime'] ?? e['startDate']) as string,
      endTime: (e['endDateTime'] ?? e['endDate']) as string,
      allDay: Boolean(e['isAllDay']),
      location: e['location'] as string | undefined,
      description: e['description'] as string | undefined,
      childId: childIds[0],
    }));
  }

  async getDailyOverview(childIds: number[]): Promise<AulaDailyOverview[]> {
    const data = await this.get('presence.getDailyOverview', {
      childIds: childIds.join(','),
    }) as Record<string, unknown>;

    const items = (data['dailyOverviews'] as Array<Record<string, unknown>> | undefined) ?? [];
    return items.map(item => ({
      childId: item['childId'] as number,
      date: item['date'] as string,
      status: item['status'] as string | undefined,
      entryTime: item['entryTime'] as string | undefined,
      exitTime: item['exitTime'] as string | undefined,
    }));
  }

  async getThreads(limit = 10): Promise<AulaMessage[]> {
    const data = await this.get('messaging.getThreads', {
      page: '0',
      pageSize: String(limit),
    }) as Record<string, unknown>;

    const threads = (data['threads'] as Array<Record<string, unknown>> | undefined) ?? [];
    const messages: AulaMessage[] = [];
    for (const thread of threads) {
      messages.push({
        id: String(thread['id']),
        threadId: thread['id'] as number,
        subject: thread['subject'] as string | undefined,
        body: ((thread['latestMessage'] as Record<string, unknown> | undefined)?.['text'] as string | undefined) ?? '',
        author: ((thread['latestMessage'] as Record<string, unknown> | undefined)?.['author'] as string | undefined),
        sentAt: thread['latestMessageCreatedAt'] as string | undefined,
      });
    }
    return messages;
  }

  async getPosts(limit = 20): Promise<AulaPost[]> {
    const data = await this.get('posts.getAllPosts', {
      limit: String(limit),
      index: '0',
    }) as Record<string, unknown>;

    const posts = (data['posts'] as Array<Record<string, unknown>> | undefined) ?? [];
    return posts.map(p => ({
      id: String(p['id']),
      title: p['title'] as string | undefined,
      body: (p['text'] ?? p['content'] ?? '') as string,
      author: p['authorName'] as string | undefined,
      publishedAt: p['publishedAt'] as string | undefined,
    }));
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/backend && npm run typecheck 2>&1 | grep "aula-client" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/aula/aula-client.ts
git commit -m "feat: Aula API client — getChildren, getCalendarEvents, getDailyOverview, getThreads, getPosts"
```

---

## Task 5: Aula connection service

**Files:**
- Create: `packages/backend/src/aula/aula-connection-service.ts`
- Create: `packages/backend/src/aula/aula-connection-service.test.ts`

- [ ] **Step 1: Write aula-connection-service.ts**

```typescript
// packages/backend/src/aula/aula-connection-service.ts
import { v4 as uuid } from 'uuid';
import type { Pool } from 'pg';
import type { AulaConnection, AulaConnectionPublic, AulaTokens } from './aula-types.js';

export class AulaConnectionService {
  constructor(private readonly pool: Pool, private readonly familyId: string) {}

  async getConnection(): Promise<AulaConnection | null> {
    const result = await this.pool.query<{ settings_json: Record<string, unknown> }>(
      'select settings_json from families where id = $1',
      [this.familyId],
    );
    const raw = result.rows[0]?.settings_json ?? {};
    return (raw.aula_connection as AulaConnection | undefined) ?? null;
  }

  async getConnectionPublic(): Promise<AulaConnectionPublic | null> {
    const conn = await this.getConnection();
    if (!conn) return null;
    const { accessToken: _a, refreshToken: _r, ...pub } = conn;
    return pub;
  }

  async saveConnection(conn: Omit<AulaConnection, 'id' | 'createdAt'>): Promise<AulaConnection> {
    const existing = await this.getConnection();
    const full: AulaConnection = {
      id: existing?.id ?? uuid(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      ...conn,
    };
    await this.pool.query(
      `update families
       set settings_json = jsonb_set(settings_json, '{aula_connection}', $1::jsonb)
       where id = $2`,
      [JSON.stringify(full), this.familyId],
    );
    return full;
  }

  async updateTokens(tokens: AulaTokens): Promise<void> {
    const conn = await this.getConnection();
    if (!conn) return;
    await this.saveConnection({ ...conn, ...tokens });
  }

  async updateSyncStats(stats: { entriesCreated: number; itemsCreated: number }): Promise<void> {
    const conn = await this.getConnection();
    if (!conn) return;
    await this.saveConnection({
      ...conn,
      lastSyncAt: new Date().toISOString(),
      lastSyncStats: stats,
    });
  }

  async setConnected(isConnected: boolean): Promise<void> {
    const conn = await this.getConnection();
    if (!conn) return;
    await this.saveConnection({ ...conn, isConnected });
  }

  async deleteConnection(): Promise<void> {
    await this.pool.query(
      `update families
       set settings_json = settings_json - 'aula_connection'
       where id = $1`,
      [this.familyId],
    );
  }
}
```

- [ ] **Step 2: Write the tests**

```typescript
// packages/backend/src/aula/aula-connection-service.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, QueryResult } from 'pg';
import { AulaConnectionService } from './aula-connection-service.js';
import type { AulaConnection } from './aula-types.js';

function mockPool(settingsJson: Record<string, unknown> = {}): { pool: Pool; stored: unknown[] } {
  const stored: unknown[] = [];
  const pool = {
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      if (sql.includes('select settings_json')) {
        return { rows: [{ settings_json: settingsJson }] } as unknown as QueryResult;
      }
      if (sql.includes('update families')) {
        stored.push(params?.[0]);
        return { rows: [] } as unknown as QueryResult;
      }
      return { rows: [] } as unknown as QueryResult;
    },
  } as unknown as Pool;
  return { pool, stored };
}

const fakeConn: Omit<AulaConnection, 'id' | 'createdAt'> = {
  isConnected: true,
  aulaUsername: 'testuser',
  accessToken: 'acc',
  refreshToken: 'ref',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  childMappings: [],
  syncOptions: {
    importToCalendar: false,
    calendarEvents: true,
    dailyOverview: false,
    posts: false,
    messages: false,
  },
  syncIntervalMinutes: 60,
};

test('getConnection returns null when not set', async () => {
  const { pool } = mockPool({});
  const svc = new AulaConnectionService(pool, 'fam-1');
  assert.equal(await svc.getConnection(), null);
});

test('getConnectionPublic strips tokens', async () => {
  const existing: AulaConnection = { id: 'c1', createdAt: new Date().toISOString(), ...fakeConn };
  const { pool } = mockPool({ aula_connection: existing });
  const svc = new AulaConnectionService(pool, 'fam-1');
  const pub = await svc.getConnectionPublic();
  assert.ok(pub);
  assert.ok(!('accessToken' in pub));
  assert.ok(!('refreshToken' in pub));
  assert.equal(pub.aulaUsername, 'testuser');
});

test('saveConnection generates id and createdAt when not existing', async () => {
  const { pool, stored } = mockPool({});
  const svc = new AulaConnectionService(pool, 'fam-1');
  const saved = await svc.saveConnection(fakeConn);
  assert.ok(saved.id);
  assert.ok(saved.createdAt);
  assert.equal(stored.length, 1);
});

test('deleteConnection issues an update query', async () => {
  const { pool, stored } = mockPool({});
  const svc = new AulaConnectionService(pool, 'fam-1');
  await svc.deleteConnection();
  // stored[0] is the familyId param passed to the update query
  assert.equal(stored[0], 'fam-1');
});
```

- [ ] **Step 3: Run tests and verify they pass**

```bash
cd packages/backend && npm test 2>&1 | grep -A 3 "aula-connection-service"
```

Expected: 4 passing tests, 0 failing.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/aula/aula-connection-service.ts packages/backend/src/aula/aula-connection-service.test.ts
git commit -m "feat: AulaConnectionService — CRUD for aula_connection in settings_json"
```

---

## Task 6: Aula sync service

**Files:**
- Create: `packages/backend/src/aula/aula-sync-service.ts`

- [ ] **Step 1: Write aula-sync-service.ts**

```typescript
// packages/backend/src/aula/aula-sync-service.ts
import { v4 as uuid } from 'uuid';
import type { Pool } from 'pg';
import { AulaClient } from './aula-client.js';
import { AulaConnectionService } from './aula-connection-service.js';
import { AulaAuthExpiredError, type AulaCalendarEvent } from './aula-types.js';
import { PostgresEntryRepository } from '../repositories/postgres/entry-repository.js';
import type { Entry } from '@mental-load/contracts';

export class AulaSyncService {
  constructor(private readonly pool: Pool, private readonly familyId: string) {}

  async runSync(): Promise<{ entriesCreated: number; itemsCreated: number }> {
    const connSvc = new AulaConnectionService(this.pool, this.familyId);
    const conn = await connSvc.getConnection();

    if (!conn || !conn.isConnected) return { entriesCreated: 0, itemsCreated: 0 };

    let entriesCreated = 0;
    let itemsCreated = 0;

    const client = new AulaClient(
      { accessToken: conn.accessToken, refreshToken: conn.refreshToken, expiresAt: conn.expiresAt },
      async (tokens) => connSvc.updateTokens(tokens),
    );

    try {
      // Calendar events → entries (one query per child mapping)
      if (conn.syncOptions.calendarEvents) {
        const from = conn.lastSyncAt
          ? new Date(conn.lastSyncAt).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        const to = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        for (const mapping of conn.childMappings) {
          const events = await client.getCalendarEvents([mapping.aulaChildId], from, to);
          for (const event of events) {
            const externalUid = `aula-${event.id}`;
            const existing = await this.findByExternalUid(externalUid);
            if (existing) continue;

            if (conn.syncOptions.importToCalendar) {
              await this.createEntry(event, externalUid, mapping.mentalLoadMemberId, mapping.calendarId);
              entriesCreated++;
            }
          }
        }
      }

      // Daily overview → aula_items
      if (conn.syncOptions.dailyOverview) {
        const childIds = conn.childMappings.map(m => m.aulaChildId);
        const overviews = await client.getDailyOverview(childIds);
        for (const ov of overviews) {
          const mapping = conn.childMappings.find(m => m.aulaChildId === ov.childId);
          const upserted = await this.upsertAulaItem({
            familyId: this.familyId,
            aulaId: `daily-${ov.childId}-${ov.date}`,
            type: 'daily_overview',
            title: `Dagsoverblik ${ov.date}`,
            body: ov.status ?? '',
            memberId: mapping?.mentalLoadMemberId ?? null,
            publishedAt: ov.date,
            rawJson: ov,
          });
          if (upserted) itemsCreated++;
        }
      }

      // Posts → aula_items
      if (conn.syncOptions.posts) {
        const posts = await client.getPosts(50);
        for (const post of posts) {
          const upserted = await this.upsertAulaItem({
            familyId: this.familyId,
            aulaId: `post-${post.id}`,
            type: 'post',
            title: post.title ?? null,
            body: post.body,
            author: post.author ?? null,
            memberId: null,
            publishedAt: post.publishedAt ?? null,
            rawJson: post,
          });
          if (upserted) itemsCreated++;
        }
      }

      // Messages → aula_items
      if (conn.syncOptions.messages) {
        const messages = await client.getThreads(20);
        for (const msg of messages) {
          const upserted = await this.upsertAulaItem({
            familyId: this.familyId,
            aulaId: `msg-${msg.id}`,
            type: 'message',
            title: msg.subject ?? null,
            body: msg.body,
            author: msg.author ?? null,
            memberId: null,
            publishedAt: msg.sentAt ?? null,
            rawJson: msg,
          });
          if (upserted) itemsCreated++;
        }
      }

      await connSvc.updateSyncStats({ entriesCreated, itemsCreated });
      return { entriesCreated, itemsCreated };
    } catch (err) {
      if (err instanceof AulaAuthExpiredError) {
        await connSvc.setConnected(false);
        console.error(`[aula-sync] auth expired for family ${this.familyId} — disconnected`);
      } else {
        console.error(`[aula-sync] sync error for family ${this.familyId}:`, err);
      }
      return { entriesCreated, itemsCreated };
    }
  }

  private async findByExternalUid(uid: string): Promise<boolean> {
    const result = await this.pool.query(
      'select id from entries where external_uid = $1 and family_id = $2 limit 1',
      [uid, this.familyId],
    );
    return result.rows.length > 0;
  }

  private async createEntry(
    event: AulaCalendarEvent,
    externalUid: string,
    ownerMemberId: string,
    calendarId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const repo = new PostgresEntryRepository(this.pool);
    const entry: Entry = {
      id: uuid(),
      externalUid,
      title: event.title,
      type: 'event',
      ownerMemberId,
      calendarId,
      startTime: event.startTime,
      endTime: event.endTime,
      timezone: 'Europe/Copenhagen',
      allDay: event.allDay,
      location: event.location,
      reminders: [],
      checklist: [],
      invitees: [],
      linkedEntryIds: [],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await repo.create(entry, this.familyId);
  }

  // Returns true if a new row was inserted
  private async upsertAulaItem(item: {
    familyId: string;
    aulaId: string;
    type: string;
    title: string | null;
    body: string;
    author?: string | null;
    memberId: string | null;
    publishedAt: string | null;
    rawJson: unknown;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `insert into aula_items (family_id, aula_id, type, title, body, author, member_id, published_at, raw_json)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (family_id, aula_id, type) do nothing`,
      [
        item.familyId, item.aulaId, item.type, item.title, item.body,
        item.author ?? null, item.memberId, item.publishedAt,
        JSON.stringify(item.rawJson),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/backend && npm run typecheck 2>&1 | grep "aula-sync" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/aula/aula-sync-service.ts
git commit -m "feat: AulaSyncService — sync calendar events, posts, messages, daily overviews"
```

---

## Task 7: Aula routes + register in app.ts

**Files:**
- Create: `packages/backend/src/aula/aula-routes.ts`
- Modify: `packages/backend/src/app.ts`

- [ ] **Step 1: Write aula-routes.ts**

```typescript
// packages/backend/src/aula/aula-routes.ts
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { aulaLogin } from './aula-auth.js';
import { AulaClient } from './aula-client.js';
import { AulaConnectionService } from './aula-connection-service.js';
import { AulaSyncService } from './aula-sync-service.js';
import { AulaLoginError, type AulaChildMapping, type AulaSyncOptions, type AulaTokens } from './aula-types.js';

export async function registerAulaRoutes(app: FastifyInstance, pool: Pool): Promise<void> {

  // POST /api/v1/aula/auth/verify
  // Runs MitID login, returns children + tokens on success
  app.post<{
    Body: { username: string; password: string; code: string };
  }>('/api/v1/aula/auth/verify', async (req, reply) => {
    const familyId = (req as unknown as { familyId: string }).familyId;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });

    const { username, password, code } = req.body;
    if (!username || !password || !code) {
      return reply.status(400).send({ error: 'username, password and code are required' });
    }

    try {
      const tokens = await aulaLogin(username, password, code);
      const client = new AulaClient(tokens);
      const children = await client.getChildren();
      return reply.send({ children, tokens });
    } catch (err) {
      if (err instanceof AulaLoginError) {
        const status = err.code === 'expired_code' ? 400 : 401;
        const message =
          err.code === 'invalid_credentials' ? 'Forkert brugernavn eller adgangskode' :
          err.code === 'expired_code' ? 'Koden er udløbet — hent en ny i MitID-appen' :
          'Kunne ikke forbinde til Aula';
        return reply.status(status).send({ error: message, code: err.code });
      }
      req.log.error({ err }, 'Aula auth/verify unexpected error');
      return reply.status(500).send({ error: 'Uventet fejl under login' });
    }
  });

  // POST /api/v1/aula/connect
  // Saves connection with tokens + child mappings + sync options
  app.post<{
    Body: {
      tokens: AulaTokens;
      aulaUsername: string;
      childMappings: AulaChildMapping[];
      syncOptions: AulaSyncOptions;
      syncIntervalMinutes?: number;
    };
  }>('/api/v1/aula/connect', async (req, reply) => {
    const familyId = (req as unknown as { familyId: string }).familyId;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });

    const { tokens, aulaUsername, childMappings, syncOptions, syncIntervalMinutes } = req.body;
    if (!tokens?.accessToken || !tokens?.refreshToken || !childMappings?.length) {
      return reply.status(400).send({ error: 'tokens and at least one childMapping are required' });
    }

    const svc = new AulaConnectionService(pool, familyId);
    const conn = await svc.saveConnection({
      isConnected: true,
      aulaUsername,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      childMappings,
      syncOptions,
      syncIntervalMinutes: syncIntervalMinutes ?? 60,
    });

    const { accessToken: _a, refreshToken: _r, ...pub } = conn;
    return reply.send({ connection: pub });
  });

  // GET /api/v1/aula/connection
  app.get('/api/v1/aula/connection', async (req, reply) => {
    const familyId = (req as unknown as { familyId: string }).familyId;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });

    const svc = new AulaConnectionService(pool, familyId);
    const conn = await svc.getConnectionPublic();
    return reply.send({ connection: conn });
  });

  // DELETE /api/v1/aula/connection
  app.delete('/api/v1/aula/connection', async (req, reply) => {
    const familyId = (req as unknown as { familyId: string }).familyId;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });

    const svc = new AulaConnectionService(pool, familyId);
    await svc.deleteConnection();
    return reply.send({ ok: true });
  });

  // POST /api/v1/aula/sync
  app.post('/api/v1/aula/sync', async (req, reply) => {
    const familyId = (req as unknown as { familyId: string }).familyId;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });

    const svc = new AulaSyncService(pool, familyId);
    const stats = await svc.runSync();
    return reply.send({ ok: true, stats });
  });

  // GET /api/v1/aula/items?type=post&memberId=&page=0&pageSize=20
  app.get<{
    Querystring: { type?: string; memberId?: string; page?: string; pageSize?: string };
  }>('/api/v1/aula/items', async (req, reply) => {
    const familyId = (req as unknown as { familyId: string }).familyId;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });

    const { type, memberId, page = '0', pageSize = '20' } = req.query;
    const offset = Number(page) * Number(pageSize);

    const conditions: string[] = ['family_id = $1'];
    const params: unknown[] = [familyId];

    if (type) { conditions.push(`type = $${params.length + 1}`); params.push(type); }
    if (memberId) { conditions.push(`member_id = $${params.length + 1}`); params.push(memberId); }

    params.push(Number(pageSize), offset);
    const result = await pool.query(
      `select id, aula_id, type, title, body, author, member_id, published_at, created_at
       from aula_items
       where ${conditions.join(' and ')}
       order by published_at desc nulls last, created_at desc
       limit $${params.length - 1} offset $${params.length}`,
      params,
    );

    return reply.send({ items: result.rows });
  });
}
```

- [ ] **Step 2: Expose familyId on request in app.ts preHandler**

In `packages/backend/src/app.ts`, find the preHandler that sets `(request as any).svc`:

```typescript
(request as any).svc = getRequestServices(payload.familyId);
```

Add the line immediately after it:

```typescript
(request as any).svc = getRequestServices(payload.familyId);
(request as any).familyId = payload.familyId;  // ← add this line
```

This makes `familyId` available to all route handlers including the Aula routes.

- [ ] **Step 3: Register Aula routes in app.ts**

Add the import near the other imports at the top:

```typescript
import { registerAulaRoutes } from './aula/aula-routes.js';
```

Find where other routes are registered (look for `registerAuthRoutes`) and add after it:

```typescript
if (pool) await registerAulaRoutes(app, pool);
```

- [ ] **Step 4: Typecheck**

```bash
cd packages/backend && npm run typecheck 2>&1 | grep -E "aula-routes|app\.ts" | head -10
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/aula/aula-routes.ts packages/backend/src/app.ts
git commit -m "feat: Aula Fastify routes — auth/verify, connect, connection, sync, items"
```

---

## Task 8: Extend sync worker with Aula loop

**Files:**
- Modify: `packages/backend/src/workers/sync-worker.ts`

- [ ] **Step 1: Add Aula sync loop to sync-worker.ts**

Replace the entire file content with:

```typescript
// packages/backend/src/workers/sync-worker.ts
import { Pool } from 'pg';
import { SyncConnectionService } from '../sync/sync-connection-service.js';
import { AppleCalDavAdapter } from '../sync/apple-caldav-adapter.js';
import { PostgresEntryRepository } from '../repositories/postgres/entry-repository.js';
import { AulaConnectionService } from '../aula/aula-connection-service.js';
import { AulaSyncService } from '../aula/aula-sync-service.js';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.log('[sync-worker] DATABASE_URL not set — sync worker idle.');
  setInterval(() => undefined, 60_000);
} else {
  const pool = new Pool({ connectionString: DATABASE_URL });

  // ── CalDAV sync ─────────────────────────────────────────────────────────────

  async function runCalDavSyncForAllFamilies(): Promise<void> {
    const families = await pool.query<{ id: string }>('select id from families');

    for (const { id: familyId } of families.rows) {
      const svc = new SyncConnectionService(pool, familyId, new AppleCalDavAdapter());
      const connections = await svc.listConnections();
      const active = connections.filter((c) => c.isConnected);

      for (const conn of active) {
        const minutesSinceLast = conn.lastSyncAt
          ? (Date.now() - new Date(conn.lastSyncAt).getTime()) / 60_000
          : Infinity;

        if (minutesSinceLast < conn.syncIntervalMinutes) continue;

        console.log(`[sync-worker] syncing CalDAV connection ${conn.id} for family ${familyId}`);
        try {
          const entryRepo = new PostgresEntryRepository(pool);
          const entryRepository = {
            list: () => entryRepo.list(familyId),
            create: (e: import('@mental-load/contracts').Entry) => entryRepo.create(e, familyId),
            findByExternalUid: (uid: string) => entryRepo.findByExternalUid(uid, familyId),
          };
          await svc.runSync(conn.id, entryRepository);
        } catch (error) {
          console.error(`[sync-worker] CalDAV sync failed for connection ${conn.id}:`, error);
        }
      }
    }
  }

  // ── Aula sync ────────────────────────────────────────────────────────────────

  async function runAulaSyncForAllFamilies(): Promise<void> {
    const families = await pool.query<{ id: string }>('select id from families');

    for (const { id: familyId } of families.rows) {
      const connSvc = new AulaConnectionService(pool, familyId);
      const conn = await connSvc.getConnection();

      if (!conn || !conn.isConnected) continue;

      const minutesSinceLast = conn.lastSyncAt
        ? (Date.now() - new Date(conn.lastSyncAt).getTime()) / 60_000
        : Infinity;

      if (minutesSinceLast < conn.syncIntervalMinutes) continue;

      console.log(`[aula-worker] syncing Aula for family ${familyId}`);
      try {
        const syncSvc = new AulaSyncService(pool, familyId);
        const stats = await syncSvc.runSync();
        console.log(`[aula-worker] family ${familyId}: +${stats.entriesCreated} entries, +${stats.itemsCreated} items`);
      } catch (error) {
        console.error(`[aula-worker] sync failed for family ${familyId}:`, error);
      }
    }
  }

  // ── Polling loops ────────────────────────────────────────────────────────────

  setInterval(() => {
    runCalDavSyncForAllFamilies().catch((err) => console.error('[sync-worker] CalDAV error:', err));
  }, 60_000);

  setInterval(() => {
    runAulaSyncForAllFamilies().catch((err) => console.error('[sync-worker] Aula error:', err));
  }, 60_000);

  setTimeout(() => {
    runCalDavSyncForAllFamilies().catch((err) => console.error('[sync-worker] CalDAV startup error:', err));
    runAulaSyncForAllFamilies().catch((err) => console.error('[aula-worker] startup error:', err));
  }, 5_000);

  console.log('[sync-worker] started — polling CalDAV + Aula every 60 seconds');
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/backend && npm run typecheck 2>&1 | grep "sync-worker" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/workers/sync-worker.ts
git commit -m "feat: extend sync worker with Aula polling loop"
```

---

## Task 9: Frontend API client

**Files:**
- Create: `packages/frontend/lib/aula-api.ts`

- [ ] **Step 1: Write aula-api.ts**

```typescript
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
  type: 'post' | 'message' | 'daily_overview';
  title?: string;
  body?: string;
  author?: string;
  member_id?: string;
  published_at?: string;
  created_at: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; code?: string };
    throw Object.assign(new Error(err.error ?? 'Request failed'), { status: res.status, code: err.code });
  }
  return res.json() as Promise<T>;
}

export async function aulaVerify(username: string, password: string, code: string): Promise<{
  children: AulaChild[];
  tokens: AulaTokens;
}> {
  return apiFetch('/v1/aula/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ username, password, code }),
  });
}

export async function aulaConnect(payload: {
  tokens: AulaTokens;
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/lib/aula-api.ts
git commit -m "feat: frontend Aula API client helpers"
```

---

## Task 10: Mobile Aula settings wizard

**Files:**
- Create: `packages/frontend/components/mobile/mobile-aula-settings.tsx`

- [ ] **Step 1: Write mobile-aula-settings.tsx**

```tsx
// packages/frontend/components/mobile/mobile-aula-settings.tsx
'use client';

import { useState, useEffect } from 'react';
import { Loader2, CheckCircle, AlertCircle, RefreshCw, Unlink } from 'lucide-react';
import type { Member, Calendar } from '@mental-load/contracts';
import { cn } from '@/lib/utils';
import {
  aulaVerify, aulaConnect, aulaGetConnection, aulaDisconnect, aulaTriggerSync,
  type AulaChild, type AulaTokens, type AulaChildMapping, type AulaSyncOptions,
  type AulaConnectionPublic,
} from '@/lib/aula-api';

const INPUT = 'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary';
const LABEL = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block';

type Step = 1 | 2 | 3 | 4 | 5;

type Props = { members: Member[]; calendars: Calendar[] };

export function MobileAulaSettings({ members, calendars }: Props) {
  const [connection, setConnection] = useState<AulaConnectionPublic | null | undefined>(undefined);
  const [step, setStep] = useState<Step>(1);

  // Auth step state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [verifiedTokens, setVerifiedTokens] = useState<AulaTokens | null>(null);
  const [aulaChildren, setAulaChildren] = useState<AulaChild[]>([]);

  // Mapping step state
  const [mappings, setMappings] = useState<Record<number, { memberId: string; calendarId: string }>>({});

  // Sync options state
  const [syncOptions, setSyncOptions] = useState<AulaSyncOptions>({
    importToCalendar: false,
    calendarEvents: true,
    dailyOverview: false,
    posts: false,
    messages: false,
  });

  // Connected state
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    aulaGetConnection()
      .then(r => setConnection(r.connection))
      .catch(() => setConnection(null));
  }, []);

  async function handleVerify() {
    setAuthError('');
    setAuthLoading(true);
    try {
      const { children, tokens } = await aulaVerify(username, password, code);
      setVerifiedTokens(tokens);
      setAulaChildren(children);
      setStep(3);
    } catch (err) {
      setAuthError((err as Error).message ?? 'Login fejlede');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleConnect() {
    if (!verifiedTokens) return;
    const childMappings: AulaChildMapping[] = aulaChildren
      .filter(c => mappings[c.id]?.memberId)
      .map(c => ({
        aulaChildId: c.id,
        aulaChildName: c.name,
        mentalLoadMemberId: mappings[c.id].memberId,
        calendarId: mappings[c.id].calendarId || (calendars[0]?.id ?? ''),
      }));

    if (!childMappings.length) return;

    const { connection: conn } = await aulaConnect({
      tokens: verifiedTokens,
      aulaUsername: username,
      childMappings,
      syncOptions,
    });
    setConnection(conn);
    setStep(5);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg('');
    try {
      const { stats } = await aulaTriggerSync();
      setSyncMsg(`Synkroniseret: +${stats.entriesCreated} begivenheder, +${stats.itemsCreated} opslag`);
      const { connection: conn } = await aulaGetConnection();
      setConnection(conn);
    } catch {
      setSyncMsg('Synkronisering fejlede');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await aulaDisconnect();
      setConnection(null);
      setStep(1);
      setUsername(''); setPassword(''); setCode('');
      setVerifiedTokens(null);
      setAulaChildren([]);
      setMappings({});
    } finally {
      setDisconnecting(false);
    }
  }

  // Loading state
  if (connection === undefined) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  // Connected state — show status card
  if (connection) {
    return (
      <div className="space-y-4 py-2">
        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="text-sm font-medium">Tilknyttet Aula</span>
          </div>
          <p className="text-xs text-muted-foreground">{connection.aulaUsername}</p>
          {connection.lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              Sidst synkroniseret: {new Date(connection.lastSyncAt).toLocaleString('da-DK')}
            </p>
          )}
          {connection.lastSyncStats && (
            <p className="text-xs text-muted-foreground">
              {connection.lastSyncStats.entriesCreated} begivenheder · {connection.lastSyncStats.itemsCreated} opslag
            </p>
          )}
          {syncMsg && <p className="text-xs text-primary">{syncMsg}</p>}
        </div>

        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 w-full justify-center rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Synkroniser nu
        </button>

        <button
          type="button"
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="flex items-center gap-2 w-full justify-center rounded-xl border border-destructive text-destructive px-4 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
          Afbryd forbindelse
        </button>
      </div>
    );
  }

  // Step 1 — Intro
  if (step === 1) {
    return (
      <div className="space-y-4 py-2">
        <div className="rounded-xl bg-muted/50 p-4 space-y-2">
          <p className="text-sm font-medium">Hvad hentes fra Aula?</p>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>Skemabegivenheder og arrangementer</li>
            <li>Opslag fra skolen</li>
            <li>Beskeder fra lærere</li>
            <li>Dagsoverblik og fremmøde</li>
          </ul>
        </div>
        <button
          type="button"
          onClick={() => setStep(2)}
          className="w-full rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium"
        >
          Tilknyt Aula
        </button>
      </div>
    );
  }

  // Step 2 — MitID login
  if (step === 2) {
    return (
      <div className="space-y-4 py-2">
        <div>
          <label className={LABEL}>MitID brugernavn</label>
          <input className={INPUT} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
        </div>
        <div>
          <label className={LABEL}>Adgangskode</label>
          <input className={INPUT} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <div>
          <label className={LABEL}>6-cifret kode</label>
          <input
            className={INPUT}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
          />
          <p className="text-xs text-muted-foreground mt-1">Åbn MitID-appen og find din 6-cifrede kode</p>
        </div>
        {authError && (
          <div className="flex items-center gap-2 text-destructive text-xs">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            {authError}
          </div>
        )}
        <button
          type="button"
          onClick={handleVerify}
          disabled={authLoading || !username || !password || code.length < 6}
          className="flex items-center gap-2 w-full justify-center rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {authLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {authLoading ? 'Logger ind...' : 'Log ind'}
        </button>
        <button type="button" onClick={() => setStep(1)} className="w-full text-xs text-muted-foreground py-1">
          Tilbage
        </button>
      </div>
    );
  }

  // Step 3 — Map children to members
  if (step === 3) {
    const hasMapping = aulaChildren.some(c => mappings[c.id]?.memberId);
    return (
      <div className="space-y-4 py-2">
        <p className="text-xs text-muted-foreground">Forbind hvert barn med et familiemedlem i MentalLoad.</p>
        {aulaChildren.map(child => (
          <div key={child.id} className="rounded-xl border border-border p-3 space-y-2">
            <p className="text-sm font-medium">{child.name}</p>
            <p className="text-xs text-muted-foreground">{child.institutionName}</p>
            <select
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
              value={mappings[child.id]?.memberId ?? ''}
              onChange={e => setMappings(prev => ({
                ...prev,
                [child.id]: { memberId: e.target.value, calendarId: members.find(m => m.id === e.target.value)?.id ?? '' },
              }))}
            >
              <option value="">Spring over</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setStep(4)}
          disabled={!hasMapping}
          className="w-full rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          Næste
        </button>
      </div>
    );
  }

  // Step 4 — Sync options
  if (step === 4) {
    const toggles: Array<{ key: keyof AulaSyncOptions; label: string; description: string }> = [
      { key: 'calendarEvents', label: 'Kalenderbegivenheder', description: 'Skema og arrangementer' },
      { key: 'dailyOverview', label: 'Dagsoverblik', description: 'Fremmøde og tilstedeværelse' },
      { key: 'posts', label: 'Opslag', description: 'Nyheder og beskeder fra skolen' },
      { key: 'messages', label: 'Beskeder', description: 'Direkte beskeder fra lærere' },
      { key: 'importToCalendar', label: 'Importer til kalender', description: 'Skriv begivenheder direkte til MentalLoad' },
    ];
    return (
      <div className="space-y-3 py-2">
        <p className="text-xs text-muted-foreground">Vælg hvad der skal hentes fra Aula.</p>
        {toggles.map(({ key, label, description }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSyncOptions(prev => ({ ...prev, [key]: !prev[key] }))}
            className="flex items-center justify-between w-full rounded-xl border border-border p-3 text-left"
          >
            <div>
              <p className={cn('text-sm font-medium', key === 'importToCalendar' && 'text-amber-600 dark:text-amber-400')}>{label}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            <div className={cn('h-5 w-9 rounded-full transition-colors', syncOptions[key] ? 'bg-primary' : 'bg-muted')} />
          </button>
        ))}
        <button
          type="button"
          onClick={handleConnect}
          className="w-full rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium"
        >
          Gem og tilknyt
        </button>
      </div>
    );
  }

  // Step 5 — Done
  return (
    <div className="space-y-4 py-2 text-center">
      <CheckCircle className="h-10 w-10 text-green-500 mx-auto" />
      <p className="text-sm font-medium">Aula er tilknyttet!</p>
      <p className="text-xs text-muted-foreground">Synkronisering starter om lidt.</p>
      <button
        type="button"
        onClick={() => aulaGetConnection().then(r => setConnection(r.connection)).catch(() => {})}
        className="w-full rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium"
      >
        Færdig
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/components/mobile/mobile-aula-settings.tsx
git commit -m "feat: mobile Aula settings wizard — 5-step MitID setup + connected state"
```

---

## Task 11: Add Aula tab to mobile settings

**Files:**
- Modify: `packages/frontend/components/mobile/mobile-settings-content.tsx`

- [ ] **Step 1: Add import at top of file**

In `packages/frontend/components/mobile/mobile-settings-content.tsx`, add the import near the other component imports:

```typescript
import { MobileAulaSettings } from './mobile-aula-settings';
```

- [ ] **Step 2: Add 'aula' to the Tab type and TABS array**

Find:
```typescript
type Tab = 'tema' | 'vejr' | 'familie' | 'kalendere' | 'assistent' | 'helligdage' | 'sync' | 'udvikler';
```

Replace with:
```typescript
type Tab = 'tema' | 'vejr' | 'familie' | 'kalendere' | 'assistent' | 'helligdage' | 'sync' | 'aula' | 'udvikler';
```

Find the TABS array and add after the `sync` entry:
```typescript
  { id: 'aula', label: 'Aula' },
```

- [ ] **Step 3: Add Aula tab panel**

In the tab content render section, find where the `sync` tab is rendered and add after it:

```tsx
{activeTab === 'aula' && (
  <MobileAulaSettings members={members} calendars={calendars} />
)}
```

- [ ] **Step 4: Build check**

```bash
cd packages/frontend && npm run typecheck 2>&1 | grep -E "mobile-settings|aula" | head -10
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/components/mobile/mobile-settings-content.tsx
git commit -m "feat: add Aula tab to mobile settings"
```

---

## Task 12: Deploy and smoke test

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```

- [ ] **Step 2: Rebuild via Testbench**

Trigger rebuild in Testbench UI for the `mentalload` app.

- [ ] **Step 3: Smoke test — verify tab appears**

Open MentalLoad on mobile → Indstillinger → confirm "Aula" tab is visible.

- [ ] **Step 4: Smoke test — verify backend routes**

```bash
# From the server, test that routes are registered (should return 401, not 404)
curl -s -o /dev/null -w "%{http_code}" https://mentalload.pl0k.online/api/v1/aula/connection
```

Expected: `401` (unauthorized — route exists but requires auth)

- [ ] **Step 5: Test auth with real credentials**

In MentalLoad mobile → Indstillinger → Aula → Tilknyt Aula → enter MitID credentials → verify login succeeds and children list appears.

> **Note:** The 8-step auth flow (Task 3) is the most likely place to need debugging. If login fails:
> 1. Check backend logs for which step throws
> 2. Reference the scaarup/aula Python implementation for the exact request shape at that step
> 3. The MitID endpoints and SAML flow can change — compare against the Python reference if endpoints 404

- [ ] **Step 6: Commit final state**

```bash
git add -A
git commit -m "chore: post-deploy smoke test complete"
```
