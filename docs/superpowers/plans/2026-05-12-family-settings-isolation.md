# Family Settings Isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all app settings from a single shared JSON file to a per-family `settings_json` JSONB column on the `families` table, adding weather and language settings in the process.

**Architecture:** `SettingsService` is rebuilt to read/write `families.settings_json` in PostgreSQL, receiving `pool` + `familyId` in its constructor. It merges env var defaults with stored JSON at read time. `getRequestServices()` in `app.ts` constructs a scoped `SettingsService` per-request. The background `scheduleMailpitPull` timer is removed. Two new settings sections (weather, language) are added to the frontend.

**Tech Stack:** PostgreSQL JSONB, Fastify, Next.js, TypeScript. No new npm packages.

---

## File Map

**Create:**
- `packages/backend/migrations/010_family_settings.sql`

**Modify:**
- `packages/contracts/src/domain.ts` — add `WeatherSettings`, add `weather` + `language` to `AppSettings`
- `packages/contracts/src/api.ts` — add `weather` + `language` to `UpdateSettingsRequest`
- `packages/backend/src/settings/settings-service.ts` — full rewrite: file-based → DB-based, family-scoped
- `packages/backend/src/auth/auth-routes.ts` — replace `new SettingsService()` with direct env var reads for forgot-password SMTP
- `packages/backend/src/app.ts` — move `settingsService` into `getRequestServices()`, move settings routes inside auth, remove `scheduleMailpitPull`, update all callsites
- `packages/frontend/components/dashboard-app.tsx` — add weather + language settings sections, pass weather prefs to `loadWeatherForecast`

---

## Task 1: DB migration — add settings_json to families

**Files:**
- Create: `packages/backend/migrations/010_family_settings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 010_family_settings.sql
alter table families add column if not exists settings_json jsonb not null default '{}'::jsonb;
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/migrations/010_family_settings.sql
git commit -m "feat: migration 010 — per-family settings_json column"
```

---

## Task 2: Update contracts — add WeatherSettings, weather + language to AppSettings

**Files:**
- Modify: `packages/contracts/src/domain.ts`
- Modify: `packages/contracts/src/api.ts`

- [ ] **Step 1: Add WeatherSettings interface and update AppSettings in domain.ts**

Find the `AppSettings` interface (around line 135) and the block above it. Add `WeatherSettings` before `AppSettings` and update `AppSettings`:

```typescript
export interface WeatherSettings {
  location: string;
  country: string;
  unit: 'C' | 'F';
}

export interface AppSettings {
  id: string;
  theme: ThemeSettings;
  assistant: AssistantConfig;
  mail: MailSettings;
  sync: SyncSettings;
  weather: WeatherSettings;
  language: SupportedLanguage;
  updatedAt: string;
}
```

- [ ] **Step 2: Add weather + language to UpdateSettingsRequest in api.ts**

Find `UpdateSettingsRequest` (around line 90) and add the two new fields:

```typescript
export interface UpdateSettingsRequest {
  id?: string;
  theme?: Partial<AppSettings['theme']>;
  assistant?: Partial<AppSettings['assistant']>;
  mail?: Partial<AppSettings['mail']>;
  sync?: Partial<AppSettings['sync']> & {
    configJson?: Record<string, unknown>;
  };
  weather?: Partial<WeatherSettings>;
  language?: SupportedLanguage;
  updatedAt?: string;
}
```

`WeatherSettings` is already exported from `domain.ts` so it's available here via the existing barrel export.

- [ ] **Step 3: Typecheck contracts**

```bash
cd packages/contracts && npx tsc --noEmit
```
Expected: clean (or only pre-existing errors unrelated to these changes).

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/domain.ts packages/contracts/src/api.ts
git commit -m "feat: add WeatherSettings + language to AppSettings contracts"
```

---

## Task 3: Rewrite SettingsService — file-based → DB-based, family-scoped

**Files:**
- Modify: `packages/backend/src/settings/settings-service.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
// packages/backend/src/settings/settings-service.ts
import type { Pool } from 'pg';
import type { AppSettings, SyncProvider, UpdateSettingsRequest, WeatherSettings } from '@mental-load/contracts';

const THEME_MODES = new Set(['system', 'light', 'dark']);
const THEME_APPEARANCES = new Set(['classic', 'glass']);

export interface SyncConnectionResult {
  ok: boolean;
  isConnected: boolean;
  provider: SyncProvider;
  message: string;
}

export class SettingsService {
  constructor(
    private readonly pool: Pool,
    private readonly familyId: string,
  ) {}

  async getSettings(): Promise<AppSettings> {
    const result = await this.pool.query<{ settings_json: Record<string, unknown>; name: string | null }>(
      'select settings_json, name from families where id = $1',
      [this.familyId],
    );
    const stored = result.rows[0]?.settings_json ?? {};
    return normalizeSettings(mergeWithDefaults(stored));
  }

  async updateSettings(patch: UpdateSettingsRequest): Promise<AppSettings> {
    const current = await this.getSettings();
    const merged = mergeSettings(current, patch);
    const next = normalizeSettings(merged);

    if (next.sync.provider !== 'none' && !next.sync.isConnected) {
      throw new Error('Connect the selected sync provider before saving settings.');
    }

    await this.pool.query(
      'update families set settings_json = $1 where id = $2',
      [JSON.stringify(settingsToStorable(next)), this.familyId],
    );

    return next;
  }

  async connectSyncProvider(provider: SyncProvider, configJson: Record<string, unknown>): Promise<SyncConnectionResult> {
    const settings = await this.getSettings();
    const validation = validateSyncProvider(provider, configJson, settings);

    const next = normalizeSettings({
      ...settings,
      sync: {
        ...settings.sync,
        provider,
        configJson: { ...settings.sync.configJson, ...configJson },
        isConnected: validation.ok,
      },
      updatedAt: new Date().toISOString(),
    });

    if (validation.ok) {
      await this.pool.query(
        'update families set settings_json = $1 where id = $2',
        [JSON.stringify(settingsToStorable(next)), this.familyId],
      );
    }

    return validation;
  }

  async markSyncRun(provider: SyncProvider, importedCount: number, configJson?: Record<string, unknown>): Promise<AppSettings> {
    const current = await this.getSettings();
    const lastSyncAt = new Date().toISOString();
    const next = normalizeSettings({
      ...current,
      sync: {
        ...current.sync,
        provider,
        isConnected: true,
        lastSyncAt,
        configJson: { ...current.sync.configJson, ...configJson, lastImportCount: importedCount },
      },
      mail: { ...current.mail, lastSyncAt },
      updatedAt: lastSyncAt,
    });

    await this.pool.query(
      'update families set settings_json = $1 where id = $2',
      [JSON.stringify(settingsToStorable(next)), this.familyId],
    );

    return next;
  }
}

// ── Defaults ────────────────────────────────────────────────────────────────

function mergeWithDefaults(stored: Record<string, unknown>): AppSettings {
  const now = new Date().toISOString();

  const defaults: AppSettings = {
    id: 'family',
    theme: {
      mode: 'light',
      appearance: 'classic',
    },
    assistant: {
      id: 'assistant-default',
      enabled: true,
      language: 'en',
      modelName: process.env.OLLAMA_MODEL ?? 'llama3.2:3b',
      ollamaUrl: process.env.OLLAMA_URL?.trim() || 'http://127.0.0.1:11434',
    },
    mail: {
      smtpHost: process.env.SMTP_HOST ?? '',
      smtpPort: Number(process.env.SMTP_PORT ?? 1025),
      smtpUser: process.env.SMTP_USER ?? '',
      smtpPass: process.env.SMTP_PASS ?? '',
      smtpFrom: process.env.SMTP_FROM ?? 'mental-load@local.test',
      imapHost: process.env.IMAP_HOST ?? '',
      imapPort: Number(process.env.IMAP_PORT ?? 993),
      imapUser: process.env.IMAP_USER ?? '',
      imapPass: process.env.IMAP_PASS ?? '',
      imapSecure: (process.env.IMAP_SECURE ?? 'true') !== 'false',
      testRecipient: process.env.REMINDER_TEST_EMAIL ?? 'family@local.test',
      previewMode: !process.env.SMTP_HOST,
      inboxSource: '',
    },
    sync: {
      id: 'sync-default',
      provider: 'none',
      configJson: { mailpitPullMinutes: 1, mailpitAutoPullEnabled: false, mailpitLastUid: 0 },
      isConnected: true,
    },
    weather: {
      location: process.env.DEFAULT_WEATHER_LOCATION ?? '',
      country: process.env.DEFAULT_WEATHER_COUNTRY ?? '',
      unit: (process.env.DEFAULT_WEATHER_UNIT === 'F' ? 'F' : 'C'),
    },
    language: (process.env.DEFAULT_LANGUAGE === 'da' ? 'da' : 'en'),
    updatedAt: now,
  };

  return deepMerge(defaults, stored) as AppSettings;
}

function deepMerge(base: unknown, overlay: unknown): unknown {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return overlay ?? base;
  if (typeof overlay !== 'object' || overlay === null || Array.isArray(overlay)) return overlay ?? base;
  const result: Record<string, unknown> = { ...base as Record<string, unknown> };
  for (const [k, v] of Object.entries(overlay as Record<string, unknown>)) {
    if (v !== undefined && v !== null) {
      result[k] = deepMerge((base as Record<string, unknown>)[k], v);
    }
  }
  return result;
}

function mergeSettings(current: AppSettings, patch: UpdateSettingsRequest): AppSettings {
  return {
    ...current,
    ...(patch.theme ? { theme: { ...current.theme, ...patch.theme } } : {}),
    ...(patch.assistant ? { assistant: { ...current.assistant, ...patch.assistant } } : {}),
    ...(patch.mail ? { mail: { ...current.mail, ...patch.mail } } : {}),
    ...(patch.sync ? {
      sync: {
        ...current.sync,
        ...patch.sync,
        configJson: { ...current.sync.configJson, ...(patch.sync.configJson ?? {}) },
      },
    } : {}),
    ...(patch.weather ? { weather: { ...current.weather, ...patch.weather } } : {}),
    ...(patch.language ? { language: patch.language } : {}),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeSettings(s: AppSettings): AppSettings {
  return {
    ...s,
    theme: {
      ...s.theme,
      mode: THEME_MODES.has(s.theme.mode) ? s.theme.mode : 'light',
      appearance: THEME_APPEARANCES.has(s.theme.appearance) ? s.theme.appearance : 'classic',
    },
  };
}

// Strip ephemeral/computed fields before persisting so stored JSON stays lean
function settingsToStorable(s: AppSettings): Partial<AppSettings> {
  const { id, updatedAt, ...storable } = s;
  // Don't persist previewMode — it's always derived from smtpHost at read time
  const { previewMode: _pm, ...mailStorable } = storable.mail;
  return { ...storable, mail: mailStorable };
}

function validateSyncProvider(
  provider: SyncProvider,
  configJson: Record<string, unknown>,
  settings: AppSettings,
): SyncConnectionResult {
  if (provider === 'none') {
    return { ok: true, isConnected: true, provider, message: 'Local-only mode is ready.' };
  }

  const stringValues = Object.values(configJson).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  const hasConfig = stringValues.length > 0;
  const hasFeedUrl = typeof configJson.feedUrl === 'string' && configJson.feedUrl.trim().length > 0;
  const hasCalendarId = typeof configJson.calendarId === 'string' && configJson.calendarId.trim().length > 0;
  const hasInboxSource = typeof configJson.inboxSource === 'string' && configJson.inboxSource.includes('BEGIN:VCALENDAR');
  const hasMailConnection = Boolean(settings.mail.imapHost || settings.mail.smtpHost);

  if (provider === 'invite-mail') {
    const ok = hasInboxSource || hasMailConnection || hasConfig;
    return { ok, isConnected: ok, provider, message: ok ? 'Invite-mail sync is connected.' : 'Add IMAP/SMTP details or a sample invite source first.' };
  }

  const ok = hasFeedUrl || hasCalendarId || hasConfig;
  return { ok, isConnected: ok, provider, message: ok ? `${provider} sync is connected.` : `Add ${provider} calendar details before connecting.` };
}
```

- [ ] **Step 2: Typecheck backend**

```bash
cd packages/backend && npm run typecheck 2>&1 | head -30
```
Expected: errors only in `app.ts` and `auth-routes.ts` (both still use old SettingsService signature — fixed in Tasks 4 and 5).

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/settings/settings-service.ts
git commit -m "feat: SettingsService — DB-based, family-scoped, adds weather + language"
```

---

## Task 4: Fix auth-routes.ts — remove SettingsService from forgot-password

**Files:**
- Modify: `packages/backend/src/auth/auth-routes.ts`

- [ ] **Step 1: Replace SettingsService usage in forgot-password with direct env var SMTP**

In `auth-routes.ts`, remove the `import { SettingsService }` line and the `const settingsService = new SettingsService()` instantiation. Replace the forgot-password handler's SMTP logic:

```typescript
// Remove this import:
// import { SettingsService } from '../settings/settings-service';

// Remove these lines from registerAuthRoutes:
// const settingsService = new SettingsService();

// In the forgot-password handler, replace:
//   const settings = await settingsService.getSettings();
//   await mailService.sendMail({ ... }, settings.mail);
// With:
    if (result) {
      const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
      const resetUrl = `${appUrl}/reset-password?token=${result.raw}`;
      const smtpConfig = {
        smtpHost: process.env.SMTP_HOST ?? '',
        smtpPort: Number(process.env.SMTP_PORT ?? 1025),
        smtpUser: process.env.SMTP_USER ?? '',
        smtpPass: process.env.SMTP_PASS ?? '',
        smtpFrom: process.env.SMTP_FROM ?? 'mental-load@local.test',
        imapHost: '', imapPort: 993, imapUser: '', imapPass: '',
        imapSecure: true, testRecipient: '', previewMode: !process.env.SMTP_HOST,
      };
      try {
        await mailService.sendMail({
          to: email,
          subject: 'Reset your MentalLoad password',
          text: `Click the link to reset your password (expires in 1 hour):\n\n${resetUrl}`,
        }, smtpConfig);
      } catch {
        console.error('Failed to send password reset email to', email);
      }
    }
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/backend && npm run typecheck 2>&1 | grep auth-routes
```
Expected: no errors in auth-routes.ts.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/auth/auth-routes.ts
git commit -m "fix: auth-routes forgot-password reads SMTP from env vars directly"
```

---

## Task 5: Wire family-scoped SettingsService into app.ts

**Files:**
- Modify: `packages/backend/src/app.ts`

- [ ] **Step 1: Remove module-level SettingsService construction**

Find and delete this line (around line 117):
```typescript
const settingsService = new SettingsService();
```

- [ ] **Step 2: Add settingsService to getRequestServices()**

In `getRequestServices(familyId: string)`, add `settingsService` construction. The `pool` is available via `infrastructure.pool`. Add after the `const repo = makeScopedBundle(...)` line:

```typescript
const settingsService = infrastructure.pool
  ? new SettingsService(infrastructure.pool, familyId)
  : (() => { throw new Error('SettingsService requires postgres'); })();
```

Then update `syncService` and `assistantService` construction to use this new `settingsService`:

```typescript
const syncService = new SyncService(settingsService, entryService);
const assistantService = new AssistantService(
  () => repo.memberRepository.list(),
  () => repo.calendarRepository.list(),
  (input) => entryService.createEntry(input),
  async () => {
    const settings = await settingsService.getSettings();
    return { ollamaUrl: settings.assistant.ollamaUrl, modelName: settings.assistant.modelName };
  },
);
return { ...repo, entryService, dailyTimelineService, syncService, assistantService, settingsService };
```

- [ ] **Step 3: Move settings routes inside the auth boundary**

The settings routes currently sit BEFORE the preHandler is registered, meaning they bypass auth. Move `GET /api/v1/settings`, `PUT /api/v1/settings`, and `POST /api/v1/settings/test-email` to AFTER the preHandler block. Update them to use `svc(request).settingsService`:

```typescript
app.get('/api/v1/settings', async (request) => svc(request).settingsService.getSettings());

app.put<{ Body: UpdateSettingsRequest }>('/api/v1/settings', async (request, reply) => {
  try {
    return await svc(request).settingsService.updateSettings(request.body ?? {});
  } catch (error) {
    reply.code(400);
    return { message: error instanceof Error ? error.message : 'Could not save settings' };
  }
});

app.post<{ Body: TestEmailRequest }>('/api/v1/settings/test-email', async (request) => {
  const settings = await svc(request).settingsService.getSettings();
  return mailService.sendTestEmail(request.body?.to ?? settings.mail.testRecipient, settings.mail);
});
```

- [ ] **Step 4: Update mailpit/pull-inbox handler to use svc(request).settingsService**

```typescript
app.post<{ Body: PullInboxToMailpitRequest }>('/api/v1/mailpit/pull-inbox', async (request, reply) => {
  const settings = await svc(request).settingsService.getSettings();
  const storedUid = Number(settings.sync.configJson.mailpitLastUid ?? 0);
  const requestedUid = Number(request.body?.sinceUid ?? storedUid);
  const limit = Number(request.body?.limit ?? 20);

  const result = await inboxBridgeService.pullInboxToMailpit(settings, Number.isFinite(requestedUid) ? requestedUid : 0, Number.isFinite(limit) ? limit : 20);
  if (!result.ok) {
    reply.code(400);
    return result;
  }

  if (result.latestUid > storedUid) {
    await svc(request).settingsService.updateSettings({
      sync: { ...settings.sync, configJson: { ...settings.sync.configJson, mailpitLastUid: result.latestUid } },
    });
  }

  return result;
});
```

- [ ] **Step 5: Update sync handlers to use svc(request).syncService**

The sync handlers already call `svc(request).syncService` — check they compile correctly. The `SyncService` constructor now receives a family-scoped `settingsService` from `getRequestServices()`.

- [ ] **Step 6: Update sendInviteEmailsForEntry to use svc(request).settingsService**

Find `sendInviteEmailsForEntry(entry, scopedMemberRepository)`. It calls `settingsService.getSettings()`. Add `settingsService` as a third parameter:

```typescript
async function sendInviteEmailsForEntry(
  entry: Entry,
  scopedMemberRepository: MemberRepository,
  settingsService: SettingsService,
): Promise<void> {
  // ... existing code, but use the passed settingsService
  const settings = await settingsService.getSettings();
  // ...
}
```

Update the call site in the POST /entries handler:
```typescript
await sendInviteEmailsForEntry(created, svc(request).memberRepository, svc(request).settingsService);
```

- [ ] **Step 7: Update sendTimelineCompletionEmails similarly**

```typescript
async function sendTimelineCompletionEmails(
  payload: { memberId: string; date: string; task: { title: string; confirmedAt?: string }; completedByMemberId?: string },
  scopedMemberRepository: MemberRepository,
  settingsService: SettingsService,
): Promise<void> {
  const [members, settings] = await Promise.all([
    scopedMemberRepository.list(),
    settingsService.getSettings(),
  ]);
  // ... rest unchanged
}
```

Update call site in the timeline confirm handler:
```typescript
void sendTimelineCompletionEmails(
  { memberId: request.params.memberId, date: confirmed.createdAt.slice(0, 10), task: confirmed, completedByMemberId: request.params.memberId },
  svc(request).memberRepository,
  svc(request).settingsService,
);
```

- [ ] **Step 8: Remove scheduleMailpitPull**

Delete the call `scheduleMailpitPull(15_000)` near the bottom of `buildApp()` and remove the entire `scheduleMailpitPull` function definition (it's a standalone function at the bottom of the file). Also remove `let mailpitTimer: NodeJS.Timeout | undefined` and `let mailpitClosed = false` declarations, and the timer cleanup in `onClose`.

- [ ] **Step 9: Typecheck**

```bash
cd packages/backend && npm run typecheck 2>&1 | head -30
```
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add packages/backend/src/app.ts
git commit -m "feat: wire family-scoped SettingsService into app.ts, remove shared mailpit timer"
```

---

## Task 6: Frontend — weather + language settings sections

**Files:**
- Modify: `packages/frontend/components/dashboard-app.tsx`

- [ ] **Step 1: Add weather settings section**

Find the settings section in `dashboard-app.tsx` (search for `activeNav === 'settings'` or the section that renders `saveSettings`). Add a Weather card inside the settings panel:

```tsx
{/* Weather settings */}
<div className="rounded-2xl border border-border/60 bg-card/50 p-5">
  <h3 className="mb-4 text-sm font-semibold">Weather</h3>
  <div className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">City</label>
        <input
          type="text"
          value={settings.weather?.location ?? ''}
          onChange={e => setSettings(s => ({ ...s, weather: { ...s.weather, location: e.target.value, country: s.weather?.country ?? '', unit: s.weather?.unit ?? 'C' } }))}
          className="h-9 w-full rounded-xl border border-border/60 bg-background/60 px-3 text-sm outline-none focus:border-primary/60"
          placeholder="Copenhagen"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Country code</label>
        <input
          type="text"
          value={settings.weather?.country ?? ''}
          onChange={e => setSettings(s => ({ ...s, weather: { ...s.weather, location: s.weather?.location ?? '', country: e.target.value, unit: s.weather?.unit ?? 'C' } }))}
          className="h-9 w-full rounded-xl border border-border/60 bg-background/60 px-3 text-sm outline-none focus:border-primary/60"
          placeholder="DK"
          maxLength={3}
        />
      </div>
    </div>
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Temperature unit</label>
      <div className="flex gap-2">
        {(['C', 'F'] as const).map(u => (
          <button
            key={u}
            type="button"
            onClick={() => setSettings(s => ({ ...s, weather: { ...s.weather, location: s.weather?.location ?? '', country: s.weather?.country ?? '', unit: u } }))}
            className={cn('rounded-xl border px-4 py-2 text-sm transition', (settings.weather?.unit ?? 'C') === u ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 bg-background/60 text-muted-foreground hover:text-foreground')}
          >
            °{u}
          </button>
        ))}
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add language settings section**

Add a Language card in the same settings area:

```tsx
{/* Language settings */}
<div className="rounded-2xl border border-border/60 bg-card/50 p-5">
  <h3 className="mb-4 text-sm font-semibold">Language</h3>
  <div className="space-y-1.5">
    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">UI language</label>
    <select
      value={settings.language ?? 'en'}
      onChange={e => setSettings(s => ({ ...s, language: e.target.value as 'en' | 'da' }))}
      className="h-9 w-full rounded-xl border border-border/60 bg-background/60 px-3 text-sm outline-none focus:border-primary/60"
    >
      <option value="en">English</option>
      <option value="da">Dansk</option>
    </select>
    <p className="text-xs text-muted-foreground mt-1">Full translation coming soon. Saves your preference now.</p>
  </div>
</div>
```

- [ ] **Step 3: Pass weather prefs to loadWeatherForecast**

Find where `loadWeatherForecast` is called in `dashboard-app.tsx`. It currently takes a hardcoded or separate location. Update it to read from `settings.weather`:

```typescript
// In the useEffect that loads weather, change to:
if (settings.weather?.location) {
  const forecast = await loadWeatherForecast({
    location: settings.weather.location,
    country: settings.weather.country || undefined,
    unit: settings.weather.unit ?? 'C',
  });
  if (active) setWeatherForecast(forecast);
}
```

If the stored location is empty, the weather widget simply won't load (shows nothing), which is the correct behaviour for a new family.

- [ ] **Step 4: Typecheck frontend**

```bash
cd packages/frontend && npm run typecheck 2>&1 | head -20
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/components/dashboard-app.tsx
git commit -m "feat: weather + language settings sections in dashboard"
```

---

## Task 7: Deploy

- [ ] **Step 1: Push to GitHub**

```bash
git push
```

- [ ] **Step 2: Deploy on server**

```bash
ssh mhouborg@192.168.1.252 "/home/mhouborg/redeploy-mentalload.sh"
```

Expected: git pull picks up all 5 commits, backend and frontend rebuild, containers restart. Migration 010 runs automatically on backend startup.

- [ ] **Step 3: Verify settings are scoped**

Log in as the Houborg family → Settings → confirm weather and language fields appear. Change the city. Log in as a different family (or check the DB directly) and confirm the other family's settings are unaffected:

```bash
ssh mhouborg@192.168.1.252 "docker exec mentalload-postgres psql -U postgres mental_load -c \"select id, name, settings_json from families;\""
```

---

## Self-Review

**Spec coverage:**
- ✅ Migration 010: Task 1
- ✅ WeatherSettings + language in AppSettings: Task 2
- ✅ SettingsService DB-based, family-scoped, env var defaults: Task 3
- ✅ Forgot-password SMTP from env vars directly: Task 4
- ✅ getRequestServices() includes settingsService: Task 5
- ✅ Settings routes moved inside auth boundary: Task 5
- ✅ scheduleMailpitPull removed: Task 5
- ✅ sendInviteEmailsForEntry + sendTimelineCompletionEmails updated: Task 5
- ✅ Frontend weather section: Task 6
- ✅ Frontend language section: Task 6
- ✅ loadWeatherForecast reads from family settings: Task 6
- ✅ Deploy: Task 7

**Type consistency check:**
- `SettingsService` constructor: `(pool: Pool, familyId: string)` — used consistently in Tasks 3, 4, 5
- `svc(request).settingsService` — returned from `getRequestServices()` in Task 5
- `WeatherSettings` — defined in Task 2, used in Task 3 and Task 6
- `settings.weather?.location` in frontend — correctly optional since existing families have `{}` stored

**Edge cases covered:**
- In-memory mode (no postgres): `getRequestServices()` throws if `settingsService` is accessed — acceptable since prod always uses postgres
- Existing families with `{}` stored: `mergeWithDefaults` fills everything from env vars
- `previewMode` is not persisted (correctly stripped in `settingsToStorable`)
