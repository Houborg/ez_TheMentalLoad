# System Mailbox & Email Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a system-level SMTP mailer, email verification gate on signup, and an Ollama-generated Danish welcome email after family setup.

**Architecture:** A new `SystemMailService` reads dedicated `SYSTEM_SMTP_*` env vars and handles all auth emails. `AuthService` gains verification token methods. The JWT preHandler checks `email_verified` and returns `403 { code: 'EMAIL_VERIFICATION_REQUIRED' }` for unverified users. The frontend middleware catches this and redirects to a new `/verify-email` waiting page. After family setup, Ollama generates a personal Danish welcome email (60s timeout, fallback template).

**Tech Stack:** nodemailer (already installed), Ollama REST API (already used by AssistantService), PostgreSQL, Next.js, Fastify.

---

## File Map

**Create:**
- `packages/backend/migrations/011_email_verification.sql`
- `packages/backend/src/mail/system-mail-service.ts`
- `packages/frontend/app/verify-email/page.tsx`
- `packages/frontend/components/verify-email-form.tsx`
- `packages/frontend/app/api/auth/resend-verification/route.ts`

**Modify:**
- `packages/backend/src/auth/auth-service.ts` — add `createVerificationToken`, `verifyEmailToken`, `resendVerificationToken`, update `setFamilyName` to send welcome email
- `packages/backend/src/auth/auth-routes.ts` — add `GET /api/auth/verify-email`, `POST /api/auth/resend-verification`, update signup to send verification email, update `/me` to include `emailVerified`
- `packages/backend/src/app.ts` — update preHandler to check `email_verified`, expand PUBLIC_PATHS
- `packages/frontend/middleware.ts` — add `/verify-email` to PUBLIC_PREFIXES, add 403 check
- `packages/frontend/app/api/auth/me/route.ts` (create) — proxy to backend `/api/auth/me`
- `packages/frontend/app\api\auth\resend-verification\route.ts` — proxy to backend

---

## Task 1: Migration — email_verified + verification_tokens

**Files:**
- Create: `packages/backend/migrations/011_email_verification.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 011_email_verification.sql
alter table users add column if not exists email_verified boolean not null default false;

create table if not exists verification_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index if not exists idx_verification_tokens_hash on verification_tokens (token_hash);

-- Existing users are pre-verified — they existed before this feature
update users set email_verified = true where email_verified = false;
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/migrations/011_email_verification.sql
git commit -m "feat: migration 011 — email_verified + verification_tokens"
```

---

## Task 2: SystemMailService

**Files:**
- Create: `packages/backend/src/mail/system-mail-service.ts`

- [ ] **Step 1: Create the service**

```typescript
// packages/backend/src/mail/system-mail-service.ts
import nodemailer from 'nodemailer';

function getSystemSmtpConfig() {
  return {
    host: process.env.SYSTEM_SMTP_HOST ?? '',
    port: Number(process.env.SYSTEM_SMTP_PORT ?? 587),
    user: process.env.SYSTEM_SMTP_USER ?? '',
    pass: process.env.SYSTEM_SMTP_PASS ?? '',
    from: process.env.SYSTEM_SMTP_FROM ?? 'MentalLoad <noreply@example.com>',
  };
}

export class SystemMailService {
  private isConfigured(): boolean {
    return Boolean(process.env.SYSTEM_SMTP_HOST);
  }

  async sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
    const subject = 'Bekræft din e-mail — MentalLoad';
    const text = [
      'Hej!',
      '',
      'Klik på linket nedenfor for at bekræfte din e-mailadresse og aktivere din MentalLoad-konto:',
      '',
      verifyUrl,
      '',
      'Linket udløber om 24 timer.',
      '',
      'Hvis du ikke har oprettet en konto, kan du se bort fra denne e-mail.',
      '',
      '— MentalLoad',
    ].join('\n');

    await this.send(to, subject, text);
  }

  async sendWelcomeEmail(to: string, familyName: string, body: string): Promise<void> {
    const subject = `Velkommen til MentalLoad, familie ${familyName}! 🎉`;
    await this.send(to, subject, body);
  }

  private async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.isConfigured()) {
      console.log(`[system-mail-preview] To: ${to} | Subject: ${subject}`);
      console.log(text);
      return;
    }

    const cfg = getSystemSmtpConfig();
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });

    await transporter.sendMail({ from: cfg.from, to, subject, text });
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/backend && npm run typecheck 2>&1 | grep "system-mail" | head -5
```
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/mail/system-mail-service.ts
git commit -m "feat: SystemMailService — dedicated server-level SMTP for auth emails"
```

---

## Task 3: AuthService — verification token methods + welcome email

**Files:**
- Modify: `packages/backend/src/auth/auth-service.ts`

- [ ] **Step 1: Add createVerificationToken method**

Add after `createResetToken`:

```typescript
async createVerificationToken(userId: string): Promise<{ raw: string }> {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Invalidate any existing unused tokens for this user
  await this.pool.query(
    'update verification_tokens set used_at = now() where user_id = $1 and used_at is null',
    [userId],
  );

  await this.pool.query(
    'insert into verification_tokens (user_id, token_hash, expires_at) values ($1, $2, $3)',
    [userId, hash, expiresAt.toISOString()],
  );

  return { raw };
}
```

- [ ] **Step 2: Add verifyEmailToken method**

```typescript
async verifyEmailToken(rawToken: string): Promise<{ userId: string; familyId: string }> {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const result = await this.pool.query<{
    id: string; user_id: string; expires_at: string; used_at: string | null;
  }>(
    'select id, user_id, expires_at, used_at from verification_tokens where token_hash = $1',
    [hash],
  );

  const token = result.rows[0];
  if (!token || token.used_at !== null || new Date(token.expires_at) < new Date()) {
    throw new AuthError('Verification link is invalid or has expired', 400);
  }

  await this.pool.query('update users set email_verified = true where id = $1', [token.user_id]);
  await this.pool.query('update verification_tokens set used_at = now() where id = $1', [token.id]);

  const userResult = await this.pool.query<{ family_id: string }>(
    'select family_id from users where id = $1',
    [token.user_id],
  );

  return { userId: token.user_id, familyId: userResult.rows[0]!.family_id };
}
```

- [ ] **Step 3: Add resendVerificationToken method**

```typescript
async resendVerificationToken(userId: string): Promise<{ raw: string }> {
  // Same as createVerificationToken — invalidates old, creates new
  return this.createVerificationToken(userId);
}
```

- [ ] **Step 4: Update setFamilyName to send Ollama welcome email**

Replace the existing `setFamilyName` method:

```typescript
async setFamilyName(familyId: string, name: string, systemMailService: SystemMailService): Promise<void> {
  const trimmed = name.trim();
  await this.pool.query('update families set name = $1 where id = $2', [trimmed, familyId]);

  // Create the shared Family calendar if this family doesn't have one yet
  const existing = await this.pool.query(
    'select 1 from calendars where family_id = $1 and owner_member_id is null limit 1',
    [familyId],
  );
  if ((existing.rowCount ?? 0) === 0) {
    await this.pool.query(
      `insert into calendars (id, name, color, owner_member_id, family_id, created_at)
       values (gen_random_uuid(), $1, $2, null, $3, now())`,
      [trimmed, '#10b981', familyId],
    );
  }

  // Fire-and-forget welcome email — never blocks the response
  void this.sendWelcomeEmail(familyId, trimmed, systemMailService);
}

private async sendWelcomeEmail(familyId: string, familyName: string, systemMailService: SystemMailService): Promise<void> {
  try {
    // Look up the family admin's email
    const userResult = await this.pool.query<{ email: string }>(
      'select email from users where family_id = $1 order by created_at asc limit 1',
      [familyId],
    );
    const email = userResult.rows[0]?.email;
    if (!email) return;

    // Generate body with Ollama (60s timeout, fallback on any error)
    let body: string;
    try {
      body = await this.generateWelcomeBody(familyName);
    } catch {
      body = this.welcomeFallback(familyName);
    }

    await systemMailService.sendWelcomeEmail(email, familyName, body);
  } catch (err) {
    console.error('[welcome-email] failed:', err instanceof Error ? err.message : err);
  }
}

private async generateWelcomeBody(familyName: string): Promise<string> {
  const ollamaUrl = process.env.OLLAMA_URL?.trim() || 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';

  const prompt = `Du er en venlig og varm velkomst-assistent for MentalLoad — en familie-app til kalender, opgaver og madplan.
Skriv en kort, personlig velkomstmail (3-5 sætninger) til familien "${familyName}".
Vær varm, lidt humoristisk og uformel. Nævn at de nu kan organisere hverdagen samlet ét sted.
Undgå emojis. Svar KUN med selve mailteksten — ingen emnelinjer, ingen hilsner udefra.`;

  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  const data = await response.json() as { response?: string };
  const text = data.response?.trim();
  if (!text) throw new Error('Empty Ollama response');
  return text;
}

private welcomeFallback(familyName: string): string {
  return `Velkommen til MentalLoad, familie ${familyName}!\n\nVi er glade for at have jer med. Nu kan hele familien holde styr på kalenderen, opgaverne og madplanen ét samlet sted.\n\nGod fornøjelse!\n— MentalLoad`;
}
```

- [ ] **Step 5: Add SystemMailService import at top of auth-service.ts**

```typescript
import type { SystemMailService } from '../mail/system-mail-service';
```

- [ ] **Step 6: Typecheck**

```bash
cd packages/backend && npm run typecheck 2>&1 | grep "auth-service\|auth-routes" | head -10
```
Expected: errors in auth-routes.ts only (setFamilyName signature changed — fixed in Task 4).

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/auth/auth-service.ts
git commit -m "feat: auth-service — verification tokens, email verify/resend, Ollama welcome email"
```

---

## Task 4: Auth routes — signup, verify-email, resend-verification, me

**Files:**
- Modify: `packages/backend/src/auth/auth-routes.ts`

- [ ] **Step 1: Add SystemMailService import and instantiation**

At the top of `registerAuthRoutes`, add after `const mailService = new MailService()`:

```typescript
import { SystemMailService } from '../mail/system-mail-service';

// Inside registerAuthRoutes, after mailService:
const systemMailService = new SystemMailService();
```

- [ ] **Step 2: Update signup route to send verification email**

After the `signToken` call in the signup handler, add:

```typescript
// After: const { token } = await authService.signup(email, password);
// Also get userId from signup:
```

Update `AuthService.signup` return to include `userId`:

In `auth-service.ts`, change:
```typescript
return { token, familyId };
```
to:
```typescript
return { token, familyId, userId };
```

Then in signup route:
```typescript
const { token, userId } = await authService.signup(email, password);

// Send verification email (fire-and-forget — don't fail signup if mail fails)
const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
const verificationToken = await authService.createVerificationToken(userId);
const verifyUrl = `${appUrl}/api/auth/verify-email?token=${verificationToken.raw}`;
void systemMailService.sendVerificationEmail(email, verifyUrl).catch((err: unknown) => {
  console.error('[signup] verification email failed:', err instanceof Error ? err.message : err);
});
```

- [ ] **Step 3: Add GET /api/auth/verify-email route**

```typescript
app.get<{ Querystring: { token?: string } }>('/api/auth/verify-email', async (request, reply) => {
  const rawToken = request.query.token?.trim();
  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

  if (!rawToken) {
    return reply.redirect(`${appUrl}/login?error=invalid-token`);
  }

  try {
    const { familyId } = await authService.verifyEmailToken(rawToken);

    // Check if family setup is complete
    const familyName = await authService.getFamilyName(familyId);
    if (!familyName) {
      return reply.redirect(`${appUrl}/setup`);
    }
    return reply.redirect(`${appUrl}/`);
  } catch {
    return reply.redirect(`${appUrl}/verify-email?error=expired`);
  }
});
```

- [ ] **Step 4: Add POST /api/auth/resend-verification route**

```typescript
app.post('/api/auth/resend-verification', async (request, reply) => {
  const token = request.cookies[COOKIE_NAME];
  if (!token) { reply.code(401); return { message: 'Not authenticated' }; }

  try {
    const payload = verifyToken(token);
    const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
    const newToken = await authService.resendVerificationToken(payload.userId);
    const verifyUrl = `${appUrl}/api/auth/verify-email?token=${newToken.raw}`;

    // Get email for this user
    const userResult = await pool.query<{ email: string }>(
      'select email from users where id = $1', [payload.userId]
    );
    const email = userResult.rows[0]?.email;
    if (email) {
      void systemMailService.sendVerificationEmail(email, verifyUrl).catch(() => {});
    }

    return { ok: true };
  } catch {
    reply.code(401); return { message: 'Invalid session' };
  }
});
```

- [ ] **Step 5: Update /api/auth/setup to pass systemMailService to setFamilyName**

Find the setup route and update:
```typescript
await authService.setFamilyName(payload.familyId, name, systemMailService);
```

- [ ] **Step 6: Update /api/auth/me to include emailVerified**

```typescript
app.get('/api/auth/me', async (request, reply) => {
  const token = request.cookies[COOKIE_NAME];
  if (!token) { reply.code(401); return { message: 'Not authenticated' }; }
  try {
    const payload = verifyToken(token);
    const familyName = await authService.getFamilyName(payload.familyId);
    const userResult = await pool.query<{ email_verified: boolean }>(
      'select email_verified from users where id = $1', [payload.userId]
    );
    const emailVerified = userResult.rows[0]?.email_verified ?? false;
    return { userId: payload.userId, familyId: payload.familyId, role: payload.role, familyName, emailVerified };
  } catch {
    reply.code(401); return { message: 'Invalid or expired session' };
  }
});
```

- [ ] **Step 7: Typecheck**

```bash
cd packages/backend && npm run typecheck 2>&1 | head -20
```
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/auth/auth-routes.ts packages/backend/src/auth/auth-service.ts
git commit -m "feat: auth routes — email verification, resend, me includes emailVerified"
```

---

## Task 5: Backend preHandler — check email_verified

**Files:**
- Modify: `packages/backend/src/app.ts`

- [ ] **Step 1: Expand PUBLIC_PATHS and add email_verified check**

Find the preHandler block (around line 131) and update:

```typescript
const PUBLIC_PATHS = ['/api/auth/', '/api/v1/health', '/ws'];
app.addHook('preHandler', async (request, reply) => {
  if (PUBLIC_PATHS.some(p => request.url.startsWith(p))) return;
  const token = request.cookies['ml_session'];
  if (!token) {
    reply.code(401);
    return reply.send({ message: 'Not authenticated' });
  }
  try {
    const payload = verifyToken(token);

    // Check email verification
    if (infrastructure.pool) {
      const result = await infrastructure.pool.query<{ email_verified: boolean }>(
        'select email_verified from users where id = $1',
        [payload.userId],
      );
      if (!result.rows[0]?.email_verified) {
        reply.code(403);
        return reply.send({ code: 'EMAIL_VERIFICATION_REQUIRED' });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (request as any).svc = getRequestServices(payload.familyId);
  } catch (err) {
    // If it's already a 403 reply in flight, rethrow
    if (reply.statusCode === 403) throw err;
    reply.code(401);
    return reply.send({ message: 'Invalid or expired session' });
  }
});
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/backend && npm run typecheck 2>&1 | head -10
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/app.ts
git commit -m "feat: preHandler checks email_verified, returns 403 EMAIL_VERIFICATION_REQUIRED"
```

---

## Task 6: Frontend — /verify-email page + middleware update

**Files:**
- Create: `packages/frontend/components/verify-email-form.tsx`
- Create: `packages/frontend/app/verify-email/page.tsx`
- Create: `packages/frontend/app/api/auth/resend-verification/route.ts`
- Modify: `packages/frontend/middleware.ts`

- [ ] **Step 1: Create the verify-email form component**

```typescript
// packages/frontend/components/verify-email-form.tsx
'use client';

import { useState } from 'react';
import { Mail } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

export function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const expired = searchParams.get('error') === 'expired';
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleResend() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? 'Kunne ikke sende e-mailen igen');
        return;
      }
      setSent(true);
    } catch {
      setError('Netværksfejl. Prøv igen.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[oklch(0.145_0_0)] px-4">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[oklch(0.205_0_0)] border border-[oklch(0.3_0_0)] mb-6">
          <Mail className="w-6 h-6 text-[oklch(0.7_0_0)]" />
        </div>
        <h1 className="text-2xl font-semibold text-white tracking-tight mb-2">Bekræft din e-mail</h1>

        {expired ? (
          <p className="text-[oklch(0.7_0.2_27)] text-sm mb-6">
            Linket er udløbet eller ugyldigt. Send et nyt nedenfor.
          </p>
        ) : (
          <p className="text-[oklch(0.556_0_0)] text-sm mb-6">
            Vi har sendt et bekræftelseslink til din e-mailadresse.<br />
            Klik på linket for at aktivere din konto.
          </p>
        )}

        {sent ? (
          <p className="text-[oklch(0.7_0_0)] text-sm">
            Et nyt link er sendt! Tjek din indbakke.
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-[oklch(0.75_0_0)] hover:bg-[oklch(0.85_0_0)] disabled:bg-[oklch(0.3_0_0)] disabled:cursor-not-allowed text-[oklch(0.1_0_0)] disabled:text-[oklch(0.5_0_0)] font-medium text-sm rounded-lg py-2.5 transition-colors"
            >
              {loading ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : null}
              {loading ? 'Sender…' : 'Send linket igen'}
            </button>
            {error && (
              <p className="mt-3 text-sm text-[oklch(0.7_0.2_27)]">{error}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the page**

```typescript
// packages/frontend/app/verify-email/page.tsx
import { Suspense } from 'react';
import { VerifyEmailForm } from '@/components/verify-email-form';

export const metadata = { title: 'Bekræft e-mail — MentalLoad' };

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  );
}
```

- [ ] **Step 3: Create resend-verification proxy route**

```typescript
// packages/frontend/app/api/auth/resend-verification/route.ts
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
```

- [ ] **Step 4: Update middleware.ts**

Add `/verify-email` to PUBLIC_PREFIXES, and add 403 check to redirect unverified users:

```typescript
import { type NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, COOKIE_NAME } from '@/lib/auth';

const PUBLIC_PREFIXES = [
  '/login',
  '/signup',
  '/setup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/api/auth/',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(COOKIE_NAME)?.value;

  if (sessionToken) {
    const payload = await verifySessionToken(sessionToken);
    if (payload) {
      // Check email verification by calling /api/auth/me
      // Only do this for page routes (not API proxy calls) to avoid loops
      if (!pathname.startsWith('/api/')) {
        try {
          const backendUrl = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
          const me = await fetch(`${backendUrl}/api/auth/me`, {
            headers: { 'Cookie': `${COOKIE_NAME}=${sessionToken}` },
            signal: AbortSignal.timeout(3000),
          });
          if (me.status === 403) {
            return NextResponse.redirect(new URL('/verify-email', request.url));
          }
        } catch {
          // If backend is unreachable, let the request through — don't block on network errors
        }
      }
      return NextResponse.next();
    }
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  if (pathname !== '/') {
    loginUrl.searchParams.set('from', pathname);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 5: Typecheck frontend**

```bash
cd packages/frontend && npm run typecheck 2>&1 | head -15
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/components/verify-email-form.tsx packages/frontend/app/verify-email/ packages/frontend/app/api/auth/resend-verification/ packages/frontend/middleware.ts
git commit -m "feat: /verify-email page, resend route, middleware 403 check"
```

---

## Task 7: Deploy + configure system SMTP env vars

- [ ] **Step 1: Push to GitHub**

```bash
git push
```

- [ ] **Step 2: Add SYSTEM_SMTP env vars to the Testbench-managed compose on the server**

```bash
ssh mhouborg@192.168.1.252
```

Edit `/home/mhouborg/testbench/TestBench/data/apps/mentalload/docker-compose.yml` — add to the `backend` service environment:

```yaml
SYSTEM_SMTP_HOST: smtp.simply.com
SYSTEM_SMTP_PORT: "587"
SYSTEM_SMTP_USER: noreply@indlysende.dk
SYSTEM_SMTP_PASS: ***REDACTED***
SYSTEM_SMTP_FROM: "MentalLoad <noreply@indlysende.dk>"
```

- [ ] **Step 3: Run redeploy**

```bash
/home/mhouborg/redeploy-mentalload.sh
```

Expected: migration 011 runs on startup, both images rebuild, containers restart.

- [ ] **Step 4: Verify migration**

```bash
docker exec mentalload-postgres psql -U postgres mental_load -c "select id, email, email_verified from users;"
```
Expected: existing users show `email_verified = true`.

- [ ] **Step 5: Smoke test**

1. Open an incognito window → `mentalload.pl0k.online/signup`
2. Sign up with a real email → should land on `/verify-email` page
3. Check inbox for verification email from `noreply@indlysende.dk`
4. Click link → should redirect to `/setup`
5. Enter family name → Ollama welcome email should arrive within ~60s

---

## Self-Review

**Spec coverage:**
- ✅ Migration 011 (email_verified + verification_tokens): Task 1
- ✅ SystemMailService with SYSTEM_SMTP_* env vars: Task 2
- ✅ createVerificationToken / verifyEmailToken / resendVerificationToken: Task 3
- ✅ Ollama welcome email (60s timeout, fallback, fire-and-forget): Task 3
- ✅ Signup sends verification email: Task 4
- ✅ GET /api/auth/verify-email: Task 4
- ✅ POST /api/auth/resend-verification: Task 4
- ✅ /api/auth/me includes emailVerified: Task 4
- ✅ preHandler checks email_verified, 403 EMAIL_VERIFICATION_REQUIRED: Task 5
- ✅ /verify-email page with resend button (Danish): Task 6
- ✅ Middleware redirects unverified users to /verify-email: Task 6
- ✅ Existing users backfilled to verified: Task 1 migration
- ✅ Deploy + SMTP env vars: Task 7

**Type consistency:**
- `AuthService.signup()` returns `{ token, familyId, userId }` — used in Task 4 signup route
- `AuthService.setFamilyName(familyId, name, systemMailService)` — 3-arg signature used in Task 4 setup route
- `SystemMailService` imported in auth-service.ts (Task 3) and auth-routes.ts (Task 4)
- `verifyEmailToken` returns `{ userId, familyId }` — used in Task 4 verify-email route
