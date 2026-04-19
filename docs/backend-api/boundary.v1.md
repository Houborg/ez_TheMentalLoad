# Backend API Boundary v1

This document freezes the backend boundary for frontend replacement work.

## Scope

The stable boundary is transport-level only:

- HTTP routes under `/api/v1/*` exposed from `packages/backend/src/app.ts`
- WebSocket endpoint at `/ws` exposed from `packages/backend/src/app.ts`
- Contract types in:
  - `packages/contracts/src/api.ts`
  - `packages/contracts/src/domain.ts`

## Allowed Dependencies for New Frontend

A replacement frontend may depend on:

- HTTP and WebSocket payloads defined by the boundary
- Shared contract package types

A replacement frontend must not depend on:

- Backend service internals (`packages/backend/src/domains/**`)
- Settings/sync internals (`packages/backend/src/settings/**`, `packages/backend/src/sync/**`)
- Repository internals (`packages/backend/src/repositories/**`)
- Runtime/scheduler implementation details

## Stability Rules

1. Keep all existing `/api/v1` routes backward compatible.
2. Keep `/ws` event envelope names and payload envelopes stable.
3. Prefer additive changes over breaking changes.
4. If a breaking change is unavoidable, introduce a new versioned path.

## Current Error Behavior

Error payloads are currently endpoint-local and typically shaped as:

```json
{ "message": "..." }
```

Clients should normalize errors by status code first, then use message text.

## Source of Truth

- Route definitions: `packages/backend/src/app.ts`
- Request/response DTOs: `packages/contracts/src/api.ts`
- Domain entities: `packages/contracts/src/domain.ts`
