# The Mental Load

A self-hosted family calendar and planning platform for 5–25 users. TypeScript monorepo with a Fastify API backend, Next.js frontend, and a Docker Compose stack that includes PostgreSQL, Redis, Mailpit, and Ollama.

---

## Packages

| Package | Description |
|---------|-------------|
| `packages/backend` | Fastify REST API + WebSocket server |
| `packages/frontend` | Next.js dashboard UI |
| `packages/contracts` | Shared TypeScript types (API + domain) |
| `packages/e2e` | Playwright end-to-end tests |

---

## Prerequisites

- Node.js 22+
- npm 10+
- Docker Desktop (for the full stack)

---

## Local Development

```bash
# Install all workspace dependencies
npm install

# Start backend, frontend, and reminder worker in parallel
npm run dev
```

Frontend: http://127.0.0.1:5173  
Backend API: http://127.0.0.1:3000

The backend defaults to an in-memory repository when no `DATABASE_URL` is set, so no database is needed for local development.

---

## Docker Stack

```bash
# Validate compose config
docker compose config

# Build and start the full production stack
docker compose up --build
```

| Service | Port | Notes |
|---------|------|-------|
| Frontend | 4173 | Next.js production build |
| Backend | 3000 | Fastify API + WebSocket |
| PostgreSQL | 5432 | Persistent calendar data |
| Redis | 6379 | BullMQ reminder queue |
| Mailpit | 8025 | SMTP trap UI (dev/staging) |
| Ollama | 11434 | Local LLM for AI assistant |

Frontend (Docker): http://127.0.0.1:4173

---

## Environment

Copy `.env.example` and adjust as needed:

```bash
cp .env.example .env
```

Key variables:

| Variable | Description |
|----------|-------------|
| `PERSISTENCE_DRIVER` | `postgres` or `memory` (default: `memory`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string for BullMQ |
| `SMTP_HOST` / `SMTP_PORT` | Outbound mail (use Mailpit for dev) |
| `OLLAMA_URL` / `OLLAMA_MODEL` | Local LLM endpoint and model name |
| `VAPID_PUBLIC_KEY` | Web push VAPID public key |
| `VAPID_PRIVATE_KEY` | Web push VAPID private key |
| `VAPID_SUBJECT` | Web push contact URI |

Generate VAPID keys once and store them in your environment file:

```bash
npx web-push generate-vapid-keys
```

---

## Database Migrations

Migrations run automatically on startup when using the Postgres driver. To run them manually:

```bash
npm --workspace @mental-load/backend run migrate
```

Migration files are in `packages/backend/migrations/`.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend + frontend + worker (watch mode) |
| `npm run build` | Build all packages |
| `npm run typecheck` | Type-check all packages |
| `npm run lint` | Run ESLint across the workspace |
| `npm run test:integration` | Run backend integration tests |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run qa:full` | Build + typecheck + all tests |

---

## API Reference

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Service health and persistence mode |
| GET | `/api/v1/dashboard` | Full snapshot (members, calendars, entries, jobs) |

### Members

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/members` | List all members |
| POST | `/api/v1/members` | Create a member |
| PATCH | `/api/v1/members/:id` | Update name, role, or email |

### Calendars & Entries

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/calendars` | List all calendars |
| GET | `/api/v1/entries` | List all entries |
| POST | `/api/v1/entries` | Create an entry (event or task) |
| PATCH | `/api/v1/entries/:id` | Update an entry |
| DELETE | `/api/v1/entries/:id` | Delete an entry |
| GET | `/api/v1/entries/occurrences?from=ISO&to=ISO` | Expand recurring entries into occurrences |
| GET | `/api/v1/reminders/jobs` | List scheduled reminder jobs |

### ICS / Calendar Import-Export

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/calendars/:id/export.ics` | Export a calendar as ICS |
| POST | `/api/v1/entries/import/ics` | Import entries from an ICS string |

### Food Plan

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/food-plan?weekStart=YYYY-MM-DD` | Get the week's food plan |
| PUT | `/api/v1/food-plan` | Upsert a day's meal |
| DELETE | `/api/v1/food-plan` | Remove a day's meal |

### Assistant

The assistant does not write directly to business logic. The intended flow is: **parse → review draft → confirm**.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/assistant/parse` | Parse natural language into a draft entry |
| POST | `/api/v1/assistant/confirm` | Confirm a draft and create the real entry |
| POST | `/api/v1/assistant/fun` | Free-form chat (Ollama-backed) |
| GET | `/api/v1/assistant/status` | Check Ollama availability |

### Mail & Sync

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/settings` | Get current app settings |
| PUT | `/api/v1/settings` | Update settings |
| POST | `/api/v1/settings/test-email` | Send a test SMTP email |
| POST | `/api/v1/sync/connect` | Connect a sync provider |
| POST | `/api/v1/sync/run` | Run a sync pass |
| POST | `/api/v1/mailpit/pull-inbox` | Pull IMAP inbox into Mailpit |

### Real-time

| Protocol | Path | Description |
|----------|------|-------------|
| WebSocket | `/ws` | Live push for `entry.created`, `entry.updated`, `entry.deleted`, `reminder.scheduled` events |

---

## Project Structure

```
ez_TheMentalLoad/
├── packages/
│   ├── backend/          # Fastify API (src/, migrations/, data/)
│   ├── contracts/        # Shared TypeScript types
│   ├── frontend/         # Next.js app (app/, components/, lib/)
│   └── e2e/              # Playwright tests
├── docs/
│   └── backend-api/      # Frozen v1 API boundary docs
├── docker-compose.yml
├── .env.example
└── tsconfig.base.json
```

---

## Docs

The `docs/backend-api/` directory contains the frozen v1 transport boundary specification:

- `boundary.v1.md` — narrative boundary definition
- `inventory.v1.json` — machine-readable endpoint inventory


## QA

- Build verification: npm run build
- Type safety: npm run typecheck
- Backend integration tests: npm run test:integration
- Browser end-to-end test: npm run test:e2e
- Full automated sweep: npm run qa
- Full verification chain: npm run qa:full

> Docker Desktop or another Docker daemon must be running before the full container stack can start.

## Current status

This repository now includes:
- shared planner UI and realtime updates
- Postgres-ready persistence and migrations
- BullMQ-ready worker process
- recurring entries and reminder job scheduling
- ICS import and export
- assistant draft and confirm workflow


##Check version
- curl http://pl0k.online:3100/api/v1/health
- # → { "version": "0.1.4", "commit": "a1b2c3d", "deployedAt": "2026-04-28T..." }