# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**The Mental Load** is a family planner app — a household calendar, task manager, food planner, and daily timeline tracker for family members (parents and children). It is a monorepo with four packages: `backend`, `frontend`, `contracts`, and `e2e`.

## Development Commands

All commands are run from the repo root unless noted otherwise.

```bash
# Start everything in dev mode (backend API + worker + frontend)
npm run dev

# Individual services
npm run dev:backend     # Fastify API on port 3000
npm run dev:frontend    # Next.js on port 5173 (proxies API to localhost:3000)
npm run dev:worker      # BullMQ reminder worker (requires REDIS_URL)

# Build all packages
npm run build

# Type-check all packages
npm run typecheck

# Lint (TypeScript-ESLint)
npm run lint
npm run lint:fix

# Backend integration tests (Node test runner, no database required)
npm run test:integration

# Run a single backend test file
npm --workspace @mental-load/backend run test -- src/app.test.ts

# E2E tests (Playwright — starts its own backend+frontend servers)
npm run test:e2e

# Full QA pass: integration tests + e2e
npm run qa

# Full QA with build + typecheck
npm run qa:full

# Run DB migrations manually
npm --workspace @mental-load/backend run migrate
```

### Infrastructure (Docker)

```bash
docker compose up -d   # Starts postgres, redis, mailpit, ollama (+ backend/frontend in Docker)
```

Copy `.env.example` to `.env` for local secrets (SMTP, IMAP, VAPID keys). The docker compose uses `.env.example` directly for container services.

- Mailpit UI: http://localhost:8025
- Backend API: http://localhost:3000
- Frontend: http://localhost:5173 (dev) / http://localhost:4173 (built)

## Architecture

### Packages

| Package | Description |
|---|---|
| `packages/contracts` | Shared TypeScript types (`domain.d.ts`, `api.d.ts`, `events.d.ts`) — the single source of truth for all types used by backend and frontend |
| `packages/backend` | Fastify API server + BullMQ worker |
| `packages/frontend` | Next.js 16 app (React 19, Tailwind v4) |
| `packages/e2e` | Playwright end-to-end tests |

### Backend (`packages/backend/src`)

- **`app.ts`** — single file that wires all routes onto the Fastify instance and connects services. All API endpoints live here.
- **`domains/`** — domain services with business logic:
  - `entries/entry-service.ts` — CRUD + recurrence expansion (via `rrule`) + ICS import/export + invitation emails
  - `timeline/daily-timeline-service.ts` — per-member daily task board, template management, task confirmation
  - `assistant/assistant-service.ts` — deterministic NLP parser for natural language entry creation; falls back to Ollama (`llama3.2:3b`) for ambiguous date/time phrasing
- **`repositories/`** — repository interfaces + two implementations: in-memory (default/test) and PostgreSQL (`repositories/postgres/`). `repository-factory.ts` picks postgres when `PERSISTENCE_DRIVER=postgres` and `DATABASE_URL` are set, otherwise falls back to in-memory with seeded demo data.
- **`reminders/reminder-scheduler.ts`** — `InMemoryReminderScheduler` (default) or `RedisReminderScheduler` (BullMQ); selected automatically based on `REDIS_URL`.
- **`workers/reminder-worker.ts`** — standalone BullMQ worker process that sends reminder emails; started separately from the API.
- **`mail/`** — `MailService` (nodemailer SMTP) and `InboxBridgeService` (IMAP → Mailpit bridge for invite-mail sync).
- **`sync/sync-service.ts`** — connects/runs calendar sync providers (ICS feed, invite-mail).
- **`events/domain-event-bus.ts`** — thin `EventEmitter` wrapper; events are broadcast to all WebSocket clients in `app.ts`.
- **`database/migrations.ts`** — runs SQL files from `migrations/` in order on startup.

**Key env vars:** `PERSISTENCE_DRIVER`, `DATABASE_URL`, `REDIS_URL`, `SMTP_*`, `IMAP_*`, `OLLAMA_URL`, `OLLAMA_MODEL`, `VAPID_*`, `DEFAULT_TIMEZONE`, `SETTINGS_FILE`.

### Frontend (`packages/frontend`)

- **`app/api/v1/[...path]/route.ts`** — catch-all Next.js route handler that proxies every `/api/v1/*` request to the backend. Tries `BACKEND_URL`, `BACKEND_INTERNAL_URL`, then `http://backend:3000`, then `http://127.0.0.1:3000` in order.
- **`app/api/weather/route.ts`** — proxies weather forecast from an external API.
- **`components/dashboard-app.tsx`** — the entire SPA lives in this one large client component. It owns all UI state, data fetching, and modal/panel rendering. Views are toggled via `?view=` query param (calendar, planner, timeline, food, members, settings).
- **`components/today-timeline-board.tsx`** — daily timeline board for a selected member.
- **`components/agenda-view.tsx`**, **`components/app-sidebar.tsx`**, **`components/entry-details-popup.tsx`** — supporting UI components.
- **`lib/api.ts`** — typed fetch wrappers for every backend endpoint; all frontend data access goes through here.

### Data model (key types from `contracts`)

- **`Member`** — `parent` or `child` role; optional `email` and `avatar`.
- **`Calendar`** — belongs to one `ownerMemberId`; entries belong to a calendar.
- **`Entry`** — either `event` or `task` type; has `recurrenceRule` (RRULE string), `checklist` items, `reminders`, `invitees`, optional `parentEntryId`.
- Daily timeline tasks are either `template`-based, `entry_task` (from a `task`-type entry), or `event_derived_task` (from a checklist item on an event).

### Persistence switching

The repository layer has full in-memory and Postgres implementations behind shared interfaces. Tests always use in-memory (no database setup needed). Production uses Postgres. Migrations auto-run on startup via `database/migrations.ts`.

### Testing approach

Backend tests use Node's built-in `node:test` runner against the in-memory repositories — no Docker, no database. Each test creates a fresh app instance via `buildApp()`. Tests cover API endpoints end-to-end through Fastify's `inject()`.
