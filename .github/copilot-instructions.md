# Copilot instructions

## Build, test, lint, and dev commands

Run all workspace-wide commands from the repository root.

| Purpose | Command |
| --- | --- |
| Install dependencies | `npm install` |
| Start frontend + backend + reminder worker in watch mode | `npm run dev` |
| Lint the workspace | `npm run lint` |
| Type-check all packages | `npm run typecheck` |
| Build all packages | `npm run build` |
| Run backend integration tests | `npm run test:integration` |
| Run Playwright end-to-end tests | `npm run test:e2e` |
| Run build + typecheck + all tests | `npm run qa:full` |
| Run backend migrations manually | `npm --workspace @mental-load/backend run migrate` |

Single-test examples:

- Backend test file: `npm --workspace @mental-load/backend exec -- tsx --test src/app.test.ts`
- Backend test by name: `npm --workspace @mental-load/backend exec -- tsx --test src/app.test.ts --test-name-pattern "health endpoint responds with ok"`
- Playwright spec file: `npm --workspace @mental-load/e2e run test -- tests/planner.spec.ts`
- Playwright test by name: `npm --workspace @mental-load/e2e run test -- tests/planner.spec.ts --grep "loads the rebuilt dashboard and completes key backend-powered flows"`

## High-level architecture

- This is a TypeScript npm workspace with four packages: `packages/backend` (Fastify API + WebSocket server), `packages/frontend` (Next.js app), `packages/contracts` (shared DTOs/domain/event types), and `packages/e2e` (Playwright).
- The transport boundary is intentionally versioned and documented. Treat `packages/backend/src/app.ts` plus `packages/contracts/src/api.ts`, `packages/contracts/src/domain.ts`, and `docs/backend-api/boundary.v1.md` as the source of truth for `/api/v1/*` and `/ws`.
- `packages/backend/src/app.ts` is the backend composition root. It wires repositories, domain services, settings/sync/mail services, the assistant service, and the in-process event bus. Most feature work eventually threads through this file.
- Persistence is selected centrally in `packages/backend/src/repositories/repository-factory.ts`: when `PERSISTENCE_DRIVER=postgres` and `DATABASE_URL` are set, the backend uses Postgres repositories and runs migrations on startup; otherwise it falls back to in-memory repositories seeded with demo members/calendars.
- Reminder delivery is split across two runtime paths: scheduling happens inside the backend via `reminder-scheduler.ts`, while actual BullMQ processing lives in the separate `packages/backend/src/workers/reminder-worker.ts` process started by `npm run dev`.
- The frontend should normally talk to the backend through the same-origin Next route proxy in `packages/frontend/app/api/v1/[...path]/route.ts`. Client code is centralized in `packages/frontend/lib/api.ts`; UI components should call those helpers instead of building backend URLs directly.
- The main dashboard UI is concentrated in `packages/frontend/components/dashboard-app.tsx`; `/planner` is a separate focused page that combines upcoming occurrences, member timelines, and weather.
- Workspace MCP tooling is configured for browser automation: `.vscode/mcp.json` registers Playwright MCP, `.playwright/mcp.config.json` provides repo-specific defaults, and `.github/workflows/copilot-setup-steps.yml` preinstalls Playwright browsers for Copilot cloud-agent sessions.

## Key repo-specific conventions

- Keep frontend work on the transport boundary, not backend internals. The backend API boundary doc explicitly forbids coupling a frontend to backend domain/service/repository internals.
- Prefer shared contracts over duplicating request/response shapes. Both frontend and backend import from `@mental-load/contracts`.
- The assistant flow is always **parse -> review draft -> confirm**. `/api/v1/assistant/parse` returns a draft, and `/api/v1/assistant/confirm` is the step that creates the real entry.
- Real-time UI refreshes come from WebSocket events on `/ws`, backed by `DomainEventBus`. If you change entry/timeline flows, check whether a corresponding event broadcast also needs to change.
- Backend settings are persisted separately from domain data through `SettingsService` to a JSON file (`SETTINGS_FILE` override in tests), while entries/members/calendars/food-plan/timeline data come from the repository bundle.
- Backend tests use Node's built-in test runner through `tsx --test` and exercise the Fastify app with `buildApp()` + `app.inject(...)` instead of spinning up a real HTTP server.
- Error responses across backend routes are usually endpoint-local JSON objects shaped like `{ "message": "..." }`; preserve that shape unless you are intentionally versioning the API.
- Local development is designed to work without Postgres: the in-memory fallback plus seeded demo members/calendars is expected behavior, not just a test stub.
