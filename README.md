# MentalLoad

MentalLoad is a family calendar and planning platform built as a TypeScript monorepo.

## Packages

- frontend: React + Vite planner UI
- backend: Fastify API with domain-driven structure
- contracts: shared TypeScript contracts
- e2e: Playwright tests

## Production-ready stack in this repo

- PostgreSQL-ready repository layer with automatic SQL migrations
- Redis and BullMQ reminder scheduling groundwork
- realtime websocket updates
- RRULE-based recurring occurrences
- ICS import and export endpoints
- assistant parse to draft to confirm flow with deterministic persistence
- Docker Compose stack for frontend, backend, worker, Postgres, Redis, Mailpit, and Ollama

## Environment

Copy [ .env.example ](.env.example) to a local environment file if you want to override defaults.

Important values:
- PERSISTENCE_DRIVER=postgres
- DATABASE_URL for PostgreSQL
- REDIS_URL for BullMQ
- SMTP_HOST and SMTP_PORT for Mailpit or SMTP
- OLLAMA_URL and OLLAMA_MODEL for local AI assistance

## Local development

1. Install dependencies:
   npm install
2. Start the apps locally:
   npm run dev
3. Open the planner:
   http://127.0.0.1:5173

If you are using Docker instead of local dev, open:
   http://127.0.0.1:4173

## Docker stack

1. Ensure Docker Desktop is running.
2. Validate the stack:
   docker compose config
3. Start the full production stack:
   docker compose up --build

Services:
- frontend on port 4173
- backend API on port 3000
- PostgreSQL on port 5432
- Redis on port 6379
- Mailpit UI on port 8025
- Ollama on port 11434

## Assistant flow

The assistant does not write directly to business logic.

Flow:
1. Send natural language to the parse endpoint.
2. Review the returned draft.
3. Confirm the draft.
4. The backend creates the real entry deterministically.

Relevant endpoints:
- POST /api/v1/assistant/parse
- POST /api/v1/assistant/confirm
- GET /api/v1/entries/occurrences
- GET /api/v1/calendars/:id/export.ics
- POST /api/v1/entries/import/ics

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
