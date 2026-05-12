import type { Pool } from 'pg';
import type { AppSettings, SyncProvider, UpdateSettingsRequest } from '@mental-load/contracts';

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
  const hasInboxSource = typeof configJson.inboxSource === 'string' && configJson.inboxSource.includes('BEGIN:VCALENDAR');
  const hasMailConnection = Boolean(settings.mail.imapHost || settings.mail.smtpHost);

  if (provider === 'invite-mail') {
    const ok = hasInboxSource || hasMailConnection || hasConfig;
    return { ok, isConnected: ok, provider, message: ok ? 'Invite-mail sync is connected.' : 'Add IMAP/SMTP details or a sample invite source first.' };
  }

  const ok = hasFeedUrl || hasCalendarId || hasConfig;
  return { ok, isConnected: ok, provider, message: ok ? `${provider} sync is connected.` : `Add ${provider} calendar details before connecting.` };
}
