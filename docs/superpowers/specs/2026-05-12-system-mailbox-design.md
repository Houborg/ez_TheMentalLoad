# System Mailbox & Email Verification — Design Spec

**Date:** 2026-05-12  
**Status:** Approved

---

## Overview

Three things shipped together:

1. **System mailbox** — a dedicated server-level SMTP sender (`noreply@indlysende.dk` via smtp.simply.com) used exclusively for auth/transactional emails. Completely separate from per-family mail settings.
2. **Email verification gate** — new users must verify their email before accessing the app. Hard gate: unverified users are redirected to a waiting screen.
3. **Ollama welcome email** — after a family sets their name at `/setup`, Ollama generates a warm, personal Danish welcome email and sends it in the background.

---

## 1. Database Migration (011)

**File:** `packages/backend/migrations/011_email_verification.sql`

```sql
alter table users add column if not exists email_verified boolean not null default false;

create table if not exists verification_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index if not exists idx_verification_tokens_hash on verification_tokens (token_hash);

-- Existing users are considered verified (they were created before this system existed)
update users set email_verified = true where email_verified = false;
```

---

## 2. System Mail Configuration

**New class:** `packages/backend/src/mail/system-mail-service.ts`

Reads exclusively from these env vars — never touches per-family `SettingsService`:

| Env var | Example value |
|---|---|
| `SYSTEM_SMTP_HOST` | `smtp.simply.com` |
| `SYSTEM_SMTP_PORT` | `587` |
| `SYSTEM_SMTP_USER` | `noreply@indlysende.dk` |
| `SYSTEM_SMTP_PASS` | *(server only — never in code or Obsidian)* |
| `SYSTEM_SMTP_FROM` | `MentalLoad <noreply@indlysende.dk>` |

Exposes two methods:
- `sendVerificationEmail(to: string, verifyUrl: string): Promise<void>`
- `sendWelcomeEmail(to: string, familyName: string, body: string): Promise<void>`

Falls back to console logging (preview mode) if `SYSTEM_SMTP_HOST` is not set.

---

## 3. Email Verification Flow

### AuthService additions

**`createVerificationToken(userId)`**
- Generates `crypto.randomBytes(32).toString('hex')` raw token
- Stores SHA-256 hash in `verification_tokens`, 24hr expiry
- Invalidates any existing unused tokens for this user first
- Returns `{ raw }`

**`verifyEmailToken(rawToken)`**
- Looks up hash, checks not expired, not used
- Sets `users.email_verified = true`
- Marks token `used_at = now()`
- Throws `AuthError(400)` on invalid/expired

**`resendVerificationToken(userId)`**
- Same as `createVerificationToken` — invalidates old, creates new

### New auth routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/auth/verify-email` | Validate token from query param `?token=xxx`, set verified, redirect |
| `POST` | `/api/auth/resend-verification` | Issue new token, send new verification email |

`GET /api/auth/verify-email` is a **public route** (no JWT required — user may not be authenticated when clicking the link from email).

`POST /api/auth/resend-verification` requires a valid JWT (user must be logged in to their unverified session).

### JWT preHandler update

After verifying the JWT signature, also check `email_verified` from the DB:

```typescript
const userRow = await pool.query('select email_verified from users where id = $1', [payload.userId]);
if (!userRow.rows[0]?.email_verified) {
  reply.code(403);
  return reply.send({ code: 'EMAIL_VERIFICATION_REQUIRED' });
}
```

Public paths expanded to include: `/api/auth/verify-email`, `/api/auth/resend-verification`.

### Frontend

**New page: `/verify-email`**
- Added to `PUBLIC_PREFIXES` in `middleware.ts`
- Shows: "Vi har sendt et link til {email}" + Resend button
- Resend calls `POST /api/auth/resend-verification`, shows confirmation

**Middleware update**
- If any API call returns `403` with `{ code: 'EMAIL_VERIFICATION_REQUIRED' }`, redirect to `/verify-email`
- OR: detect in `middleware.ts` by calling `GET /api/auth/me` and checking `emailVerified` field

**`GET /api/auth/me` response update**
- Add `emailVerified: boolean` to the response so middleware can check it

---

## 4. Signup flow update

On `POST /api/auth/signup`:
1. Create user with `email_verified = false` *(unchanged)*
2. Issue JWT *(unchanged)*
3. **New:** call `authService.createVerificationToken(userId)` and send verification email via `SystemMailService`

**Verification email:**
- Subject: `Bekræft din e-mail — MentalLoad`
- Body: Clean, minimal Danish text with the verification link. 24hr expiry noted.
- Link: `{APP_URL}/api/auth/verify-email?token={raw}`

After clicking the link:
- If `families.name` is null → redirect to `/setup`
- Otherwise → redirect to `/`

---

## 5. Ollama Welcome Email

**Triggered in:** `AuthService.setFamilyName()` after saving the name — fire-and-forget (does not block the `/setup` API response).

**Ollama prompt:**
```
Du er en venlig og varm velkomst-assistent for MentalLoad — en familie-app til kalender, opgaver og madplan.
Skriv en kort, personlig velkomstmail (3-5 sætninger) til familien "{familyName}".
Vær varm, lidt humoristisk og uformel. Nævn at de nu kan organisere hverdagen samlet ét sted.
Undgå emojis. Svar KUN med selve mailteksten — ingen emnelinjer, ingen hilsner udefra.
```

**Ollama config:** reads `OLLAMA_URL` env var (same as AssistantService). Model: `llama3.2:3b`.

**Timeout:** 60 seconds. On timeout or any error, falls back to template.

**Fallback template:**
```
Velkommen til MentalLoad, familie {familyName}!

Vi er glade for at have jer med. Nu kan hele familien holde styr på
kalenderen, opgaverne og madplanen ét samlet sted.

God fornøjelse!
— MentalLoad
```

**Welcome email:**
- Subject: `Velkommen til MentalLoad, familie {familyName}! 🎉`
- Sent to the user's email address
- Via `SystemMailService`

`AuthService` needs the user's email to send the welcome. Since `setFamilyName` only receives `familyId`, it looks up the user email: `SELECT email FROM users WHERE family_id = $1 LIMIT 1`.

---

## 6. Server env vars to add to docker-compose

```yaml
# backend service
SYSTEM_SMTP_HOST: smtp.simply.com
SYSTEM_SMTP_PORT: "587"
SYSTEM_SMTP_USER: noreply@indlysende.dk
SYSTEM_SMTP_PASS: <set on server — do not commit>
SYSTEM_SMTP_FROM: "MentalLoad <noreply@indlysende.dk>"
```

---

## 7. Out of Scope

- Email change flow (user updating their email address after signup)
- Admin view of unverified users
- Rate limiting on resend (nice to have, skip for now)
