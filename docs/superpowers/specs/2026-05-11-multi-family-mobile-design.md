# Multi-Family Support & Mobile Dashboard

**Date:** 2026-05-11  
**Status:** Approved  
**Scope:** TheMentalLoad — `ez_TheMentalLoad` monorepo

---

## Overview

Two related features:

1. **Multi-family support** — multiple isolated households can sign up and use the app independently. Each family's data is fully separated at the database level.
2. **Mobile dashboard** — full feature parity on small screens via a responsive redesign (no separate mobile routes or app).

These share a dependency: multi-family requires real user accounts, which also provides a proper auth foundation for persistent mobile sessions.

---

## 1. Auth & User Accounts

### Current state
Auth is frontend-only: `AUTH_USERNAME` / `AUTH_PASSWORD` env vars validated in `middleware.ts`. No backend participation. No user records in the DB.

### New auth model
Backend-owned JWT auth. Fastify issues and verifies all tokens. Frontend stores the JWT in an `httpOnly` cookie and never handles raw credentials after the login POST.

**JWT payload:**
```json
{ "userId": "uuid", "familyId": "uuid", "role": "admin" }
```

### New Fastify endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/signup` | Create user + family, return JWT cookie |
| POST | `/api/auth/login` | Validate email + password, return JWT cookie |
| POST | `/api/auth/logout` | Clear JWT cookie |
| POST | `/api/auth/forgot-password` | Send magic-link reset email |
| POST | `/api/auth/reset-password` | Consume token, set new password |

### Frontend auth middleware
Remove env-var check from `middleware.ts`. Replace with: verify JWT cookie by calling `GET /api/auth/me` (or decode + verify locally using the shared secret). Redirect to `/login` if invalid/missing.

---

## 2. New Database Tables

```sql
CREATE TABLE families (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  family_id     UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'member')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
```

---

## 3. Data Isolation — family_id Migration

Add `family_id UUID NOT NULL REFERENCES families(id)` to every data-bearing table:

- `members`
- `calendars`
- `entries`
- `food_plan_entries`
- Any other tables added in future features

**Migration strategy for production:**
1. Insert a default family row (`name = 'Default Family'`).
2. Add `family_id` column as nullable.
3. Backfill all existing rows with the default family's id.
4. Add NOT NULL constraint.

Every Fastify route handler extracts `familyId` from the verified JWT and appends `AND family_id = $familyId` to all queries. No route returns cross-family data.

---

## 4. Signup & Onboarding Flow

### Pages

| Route | Purpose |
|-------|---------|
| `/login` | Email + password form. Link to `/signup` and `/forgot-password`. |
| `/signup` | Email + password + confirm password. On success → `/setup`. |
| `/setup` | Family name input. On submit → create family → redirect to `/`. |
| `/forgot-password` | Email input. Sends magic link. |
| `/reset-password` | Token from URL query param. New password + confirm. |

### Signup sequence
1. User submits `/signup` → backend creates `user` + `family` (name = null) → issues JWT → redirects to `/setup`.
2. `/setup` is a protected route that only shows if `family.name` is null. Submitting sets the name → redirects to `/`.

---

## 5. Mobile Dashboard

### Approach
Single responsive codebase. No separate mobile routes. Tailwind `md:` breakpoint = desktop layout; default (no prefix) = mobile layout.

### Navigation
- **Mobile:** Fixed bottom nav bar with icon + label for: Calendar, Tasks, Food, AI, Settings.
- **Desktop:** Existing sidebar/top nav — unchanged.

### Per-view layout changes

| View | Mobile | Desktop |
|------|--------|---------|
| Calendar | Day/agenda default view | Month/week (unchanged) |
| Task board | Single-column list, columns as collapsible sections | Kanban columns (unchanged) |
| Food planner | Vertical day-by-day scroll | Grid (unchanged) |
| AI assistant | Full-screen bottom sheet drawer | Side panel (unchanged) |
| Modals/forms | Full-screen bottom sheets, fields stack vertically | Current modal style |

### General rules
- Minimum touch target: 44×44px on all interactive elements.
- No horizontal scroll on any view.
- Mobile layout refinements are intentionally deferred — this section is directional and will be tightened during implementation.

---

## 6. Error Handling & Edge Cases

- **Duplicate email on signup:** Return 409, show inline error on the email field.
- **Expired/used reset token:** Show clear error with link back to `/forgot-password`.
- **Family name already set trying to re-access `/setup`:** Redirect to `/`.
- **JWT expired mid-session:** Any API 401 response triggers a redirect to `/login`.
- **Existing production data:** Migration backfills to a default family — no data loss.

---

## 7. Out of Scope

- Per-member logins within a family (members remain name-only profiles managed by the family admin).
- Family invite system (members added manually from settings, same as current behavior).
- OAuth providers (Google, GitHub).
- Admin panel for managing all families.
