# Family Settings Isolation — Design Spec

**Date:** 2026-05-12  
**Status:** Approved

---

## Overview

All app settings are moved from a single shared JSON file (`data/app-settings.json`) to a per-family JSONB column on the `families` table in PostgreSQL. Each family gets fully independent settings: theme, AI assistant (Ollama URL, model, language), mail (SMTP/IMAP), sync, weather location/units, and UI language.

Env vars remain the server-wide defaults — used when a family hasn't configured a value yet. The family's stored value always wins over the env var default.

---

## 1. Database Migration

**File:** `packages/backend/migrations/010_family_settings.sql`

```sql
alter table families add column if not exists settings_json jsonb not null default '{}'::jsonb;
```

Single column on the existing `families` table. No new table. Settings are 1:1 with a family so there's no benefit to a separate table.

No data migration needed — `'{}'::jsonb` default means all families start with an empty object, and env var defaults fill in the gaps at read time.

---

## 2. Updated `AppSettings` Shape

Add `WeatherSettings` and a top-level `language` field to the contracts package.

```typescript
// packages/contracts/src/domain.ts — additions

export interface WeatherSettings {
  location: string;       // city name, e.g. "Copenhagen"
  country: string;        // ISO country code, e.g. "DK"
  unit: 'C' | 'F';
}

export interface AppSettings {
  id: string;             // family ID (replaces the old 'local-settings' string)
  theme: ThemeSettings;
  assistant: AssistantConfig;
  mail: MailSettings;
  sync: SyncSettings;
  weather: WeatherSettings;
  language: SupportedLanguage;   // 'en' | 'da'
  updatedAt: string;
}
```

`AssistantConfig` already has `ollamaUrl`, `modelName`, `language` (assistant voice language), `enabled` — no changes needed there.

---

## 3. Family-Aware `SettingsService`

**File:** `packages/backend/src/settings/settings-service.ts`

Constructor changes from `(settingsPath?: string)` to `(pool: Pool, familyId: string)`.

### `getSettings()`

1. Query: `SELECT settings_json FROM families WHERE id = $1`
2. Deep-merge: `defaultSettings(envVars) ← storedJson`
3. Return merged result

### `updateSettings(patch)`

1. Load current settings via `getSettings()`
2. Deep-merge patch into current
3. `UPDATE families SET settings_json = $1 WHERE id = $2`

### Default resolution (env vars → hardcoded fallbacks)

| Setting | Env var | Hardcoded fallback |
|---------|---------|-------------------|
| `assistant.ollamaUrl` | `OLLAMA_URL` | `http://127.0.0.1:11434` |
| `assistant.modelName` | `OLLAMA_MODEL` | `llama3.2:3b` |
| `mail.smtpHost` | `SMTP_HOST` | `''` |
| `mail.smtpPort` | `SMTP_PORT` | `1025` |
| `mail.smtpUser` | `SMTP_USER` | `''` |
| `mail.smtpPass` | `SMTP_PASS` | `''` |
| `mail.smtpFrom` | `SMTP_FROM` | `mental-load@local.test` |
| `mail.imapHost` | `IMAP_HOST` | `''` |
| `mail.imapPort` | `IMAP_PORT` | `993` |
| `mail.imapUser` | `IMAP_USER` | `''` |
| `mail.imapPass` | `IMAP_PASS` | `''` |
| `mail.imapSecure` | `IMAP_SECURE` | `true` |
| `weather.location` | `DEFAULT_WEATHER_LOCATION` | `''` |
| `weather.country` | `DEFAULT_WEATHER_COUNTRY` | `''` |
| `weather.unit` | `DEFAULT_WEATHER_UNIT` | `'C'` |
| `language` | `DEFAULT_LANGUAGE` | `'en'` |
| `theme.mode` | — | `'light'` |
| `theme.appearance` | — | `'classic'` |

---

## 4. Wiring in `app.ts`

`SettingsService` moves from module-level (constructed once) into `getRequestServices(familyId)`, receiving the family's Pool and familyId. Every handler that previously used the shared `settingsService` now gets it from `svc(request).settingsService`.

**Settings routes** (`GET /api/v1/settings`, `PUT /api/v1/settings`) are currently outside the JWT preHandler check. They must be included in the protected routes — the preHandler already attaches `svc` to the request, so they just need to call `svc(request).settingsService`.

**`scheduleMailpitPull`** — the background auto-pull timer uses the global settings service and cannot be family-scoped. It is removed. Invite-mail sync still works on-demand (user triggers it from settings).

---

## 5. Frontend — New Settings Sections

Two new sections added to the settings panel in `dashboard-app.tsx`:

### Weather
- City/location text input
- Country input (optional, improves geocoding accuracy)
- Units toggle: °C / °F
- Saved to `PUT /api/v1/settings` → `weather` field

### Language
- Dropdown: English / Dansk
- Saved to `PUT /api/v1/settings` → `language` field
- Note: actual UI translation (i18n) is a separate future feature. This stores the preference so it's ready.

### Weather API route
`/api/weather` currently requires `location` and `unit` as query params. After this change:
- Frontend reads `settings.weather` and pre-fills those params
- If location is empty (family hasn't configured it), weather widget hides gracefully

---

## 6. Edge Case — Forgot-Password Email

`auth-routes.ts` calls `new SettingsService()` to get SMTP config before a family is even known (the user is resetting their password, they're not authenticated). This route cannot use a family-scoped settings service.

Fix: for `POST /api/auth/forgot-password`, read SMTP config directly from env vars (`process.env.SMTP_HOST` etc.) instead of going through `SettingsService`. This is the only callsite that needs special treatment.

---

## 7. Out of Scope

- Actual UI translation / i18n — `language` value is stored but not applied yet
- Per-member settings (all settings are per-family, not per-member)
- Admin override panel (no way to inspect/override all families' settings from a superadmin view)
