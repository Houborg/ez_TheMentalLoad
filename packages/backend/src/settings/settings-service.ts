import type { Pool } from 'pg';
import { v4 as uuid } from 'uuid';
import type { AppSettings, SyncProvider, UpdateSettingsRequest } from '@mental-load/contracts';

const THEME_MODES = new Set(['system', 'light', 'dark']);
const THEME_APPEARANCES = new Set(['classic', 'glass']);

async function migrateSyncSettings(pool: Pool, familyId: string): Promise<void> {
  const result = await pool.query<{ settings_json: Record<string, unknown> }>(
    'select settings_json from families where id = $1',
    [familyId],
  );
  const stored = result.rows[0]?.settings_json ?? {};

  // Already migrated — nothing to do
  if ('sync_connections' in stored) return;

  const oldSync = stored.sync as Record<string, unknown> | undefined;
  const syncConnections: unknown[] = [];

  if (oldSync && oldSync.provider && oldSync.provider !== 'none') {
    // Migrate the old single-provider entry as a disconnected placeholder.
    // User must reconfigure via the wizard to supply CalDAV credentials.
    syncConnections.push({
      id: uuid(),
      provider: oldSync.provider,
      isConnected: false,
      importEnabled: true,
      exportEnabled: false,
      syncIntervalMinutes: 15,
      createdAt: new Date().toISOString(),
    });
  }

  // Remove the old 'sync' key and add 'sync_connections'
  await pool.query(
    `update families
     set settings_json = (settings_json - 'sync') || jsonb_build_object('sync_connections', $1::jsonb)
     where id = $2`,
    [JSON.stringify(syncConnections), familyId],
  );
}

export interface SyncConnectionResult {
  ok: boolean;
  isConnected: boolean;
  provider: SyncProvider;
  message: string;
}

/** File/in-memory settings service used when no Postgres pool is available (dev/test). */
export interface ISettingsService {
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: UpdateSettingsRequest): Promise<AppSettings>;
  connectSyncProvider(provider: SyncProvider, configJson: Record<string, unknown>): Promise<SyncConnectionResult>;
  markSyncRun(provider: SyncProvider, importedCount: number, configJson?: Record<string, unknown>): Promise<AppSettings>;
}

export class InMemorySettingsService implements ISettingsService {
  private settings: AppSettings = normalizeSettings(mergeWithDefaults({}));

  async getSettings(): Promise<AppSettings> {
    return this.settings;
  }

  async updateSettings(patch: UpdateSettingsRequest): Promise<AppSettings> {
    const merged = mergeSettings(this.settings, patch);
    const next = normalizeSettings(merged);
    if (next.sync.provider !== 'none' && !next.sync.isConnected) {
      throw new Error('Connect the selected sync provider before saving settings.');
    }
    this.settings = next;
    return next;
  }

  async connectSyncProvider(provider: SyncProvider, configJson: Record<string, unknown>): Promise<SyncConnectionResult> {
    const validation = validateSyncProvider(provider, configJson, this.settings);
    if (validation.ok) {
      this.settings = normalizeSettings({
        ...this.settings,
        sync: { ...this.settings.sync, provider, configJson: { ...this.settings.sync.configJson, ...configJson }, isConnected: true },
        updatedAt: new Date().toISOString(),
      });
    }
    return validation;
  }

  async markSyncRun(provider: SyncProvider, importedCount: number, configJson?: Record<string, unknown>): Promise<AppSettings> {
    const lastSyncAt = new Date().toISOString();
    this.settings = normalizeSettings({
      ...this.settings,
      sync: { ...this.settings.sync, provider, isConnected: true, lastSyncAt, configJson: { ...this.settings.sync.configJson, ...configJson, lastImportCount: importedCount } },
      mail: { ...this.settings.mail, lastSyncAt },
      updatedAt: lastSyncAt,
    });
    return this.settings;
  }
}

export class SettingsService implements ISettingsService {
  constructor(
    private readonly pool: Pool,
    private readonly familyId: string,
  ) {}

  async getSettings(): Promise<AppSettings> {
    await migrateSyncSettings(this.pool, this.familyId);
    const result = await this.pool.query<{ settings_json: Record<string, unknown> }>(
      'select settings_json from families where id = $1',
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
      modelName: 'claude-haiku-4-5',
      provider: process.env.ANTHROPIC_API_KEY ? 'claude' : 'none',
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      openaiModel: 'gpt-4o-mini',
      ollamaUrl: process.env.OLLAMA_URL?.trim() ?? '',
      ollamaModel: process.env.OLLAMA_MODEL?.trim() ?? 'llama3.2:3b',
    },
    mail: {
      smtpHost: process.env.SMTP_HOST ?? '',
      smtpPort: Number(process.env.SMTP_PORT ?? 1025),
      smtpUser: process.env.SMTP_USER ?? '',
      smtpPass: process.env.SMTP_PASS ?? '',
      smtpFrom: process.env.SMTP_FROM ?? 'mental-load@local.test',
      testRecipient: process.env.REMINDER_TEST_EMAIL ?? 'family@local.test',
      previewMode: !process.env.SMTP_HOST,
    },
    sync: {
      id: 'sync-default',
      provider: 'none',
      configJson: {},
      isConnected: true,
    },
    weather: {
      location: process.env.DEFAULT_WEATHER_LOCATION ?? '',
      country: process.env.DEFAULT_WEATHER_COUNTRY ?? '',
      unit: process.env.DEFAULT_WEATHER_UNIT === 'F' ? 'F' : 'C',
    },
    language: process.env.DEFAULT_LANGUAGE === 'da' ? 'da' : 'en',
    updatedAt: now,
  };

  return deepMerge(defaults, stored) as AppSettings;
}

function deepMerge(base: unknown, overlay: unknown): unknown {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return overlay ?? base;
  if (typeof overlay !== 'object' || overlay === null || Array.isArray(overlay)) return overlay ?? base;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
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
    ...(patch.language !== undefined ? { language: patch.language } : {}),
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

function settingsToStorable(s: AppSettings): Record<string, unknown> {
  const { id: _id, updatedAt: _updatedAt, ...storable } = s;
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

  const ok = hasFeedUrl || hasCalendarId || hasConfig;
  return { ok, isConnected: ok, provider, message: ok ? `${provider} sync is connected.` : `Add ${provider} calendar details before connecting.` };
}
