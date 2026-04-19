import { promises as fs } from 'node:fs';
import path from 'node:path';
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
  private cache?: AppSettings;

  constructor(private readonly settingsPath = resolveSettingsPath()) {}

  async getSettings(): Promise<AppSettings> {
    if (!this.cache) {
      this.cache = await this.load();
    }

    return cloneSettings(this.cache);
  }

  async updateSettings(patch: UpdateSettingsRequest): Promise<AppSettings> {
    const current = await this.getSettings();
    const next = normalizeLoadedSettings(mergeSettings(current, patch));

    if (next.sync.provider !== 'none' && !next.sync.isConnected) {
      throw new Error('Connect the selected sync provider before saving settings.');
    }

    this.cache = next;
    await this.persist(next);
    return cloneSettings(next);
  }

  async connectSyncProvider(provider: SyncProvider, configJson: Record<string, unknown>): Promise<SyncConnectionResult> {
    const settings = await this.getSettings();
    const validation = validateSyncProvider(provider, configJson, settings);

    this.cache = normalizeLoadedSettings({
      ...settings,
      sync: {
        ...settings.sync,
        provider,
        configJson: {
          ...settings.sync.configJson,
          ...configJson,
        },
        isConnected: validation.ok,
      },
      updatedAt: new Date().toISOString(),
    });

    if (validation.ok) {
      await this.persist(this.cache);
    }

    return validation;
  }

  async markSyncRun(provider: SyncProvider, importedCount: number, configJson?: Record<string, unknown>): Promise<AppSettings> {
    const current = await this.getSettings();
    const lastSyncAt = new Date().toISOString();
    const next = normalizeLoadedSettings({
      ...current,
      sync: {
        ...current.sync,
        provider,
        isConnected: true,
        lastSyncAt,
        configJson: {
          ...current.sync.configJson,
          ...configJson,
          lastImportCount: importedCount,
        },
      },
      mail: {
        ...current.mail,
        lastSyncAt,
      },
      updatedAt: lastSyncAt,
    });

    this.cache = next;
    await this.persist(next);
    return cloneSettings(next);
  }

  private async load(): Promise<AppSettings> {
    try {
      const existing = await fs.readFile(this.settingsPath, 'utf8');
      const parsed = JSON.parse(existing) as AppSettings;
      const merged = mergeSettings(createDefaultSettings(), parsed);
      const normalized = normalizeLoadedSettings(merged);
      if (JSON.stringify(normalized) !== JSON.stringify(merged)) {
        await this.persist(normalized);
      }
      return normalized;
    } catch {
      const defaults = createDefaultSettings();
      await this.persist(defaults);
      return defaults;
    }
  }

  private async persist(settings: AppSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }
}

function createDefaultSettings(): AppSettings {
  const now = new Date().toISOString();

  return {
    id: 'local-settings',
    theme: { mode: 'light', appearance: 'classic' },
    assistant: {
      id: 'assistant-default',
      enabled: true,
      language: 'en',
      modelName: process.env.OLLAMA_MODEL ?? 'llama3.2:3b',
      ollamaUrl: resolveDefaultOllamaUrl(),
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
      configJson: {
        mailpitPullMinutes: 1,
        mailpitAutoPullEnabled: true,
        mailpitLastUid: 0,
      },
      isConnected: true,
    },
    updatedAt: now,
  };
}

function mergeSettings(current: AppSettings, patch: UpdateSettingsRequest): AppSettings {
  const updatedAt = new Date().toISOString();

  return {
    ...current,
    ...patch,
    theme: {
      ...current.theme,
      ...(patch.theme ?? {}),
    },
    assistant: {
      ...current.assistant,
      ...(patch.assistant ?? {}),
    },
    mail: {
      ...current.mail,
      ...(patch.mail ?? {}),
    },
    sync: {
      ...current.sync,
      ...(patch.sync ?? {}),
      configJson: {
        ...current.sync.configJson,
        ...(patch.sync?.configJson ?? {}),
      },
    },
    updatedAt,
  };
}

function normalizeLoadedSettings(settings: AppSettings): AppSettings {
  const normalizedTheme = {
    ...settings.theme,
    mode: THEME_MODES.has(settings.theme.mode) ? settings.theme.mode : 'light',
    appearance: THEME_APPEARANCES.has(settings.theme.appearance) ? settings.theme.appearance : 'classic',
  };

  const envOllamaUrl = process.env.OLLAMA_URL?.trim();
  const currentUrl = settings.assistant.ollamaUrl?.trim();
  const nextAssistant = { ...settings.assistant };

  if ((!currentUrl || isLoopbackOllamaUrl(currentUrl)) && envOllamaUrl) {
    nextAssistant.ollamaUrl = envOllamaUrl;
  }

  if (!nextAssistant.modelName?.trim() && process.env.OLLAMA_MODEL?.trim()) {
    nextAssistant.modelName = process.env.OLLAMA_MODEL.trim();
  }

  const themeChanged = normalizedTheme.mode !== settings.theme.mode || normalizedTheme.appearance !== settings.theme.appearance;
  const assistantChanged = nextAssistant.modelName !== settings.assistant.modelName || nextAssistant.ollamaUrl !== settings.assistant.ollamaUrl;

  if (!themeChanged && !assistantChanged) {
    return settings;
  }

  return {
    ...settings,
    theme: normalizedTheme,
    assistant: nextAssistant,
  };
}

function resolveDefaultOllamaUrl(): string {
  return process.env.OLLAMA_URL?.trim() || 'http://127.0.0.1:11434';
}

function isLoopbackOllamaUrl(value: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(value.trim());
}

function validateSyncProvider(
  provider: SyncProvider,
  configJson: Record<string, unknown>,
  settings: AppSettings,
): SyncConnectionResult {
  if (provider === 'none') {
    return { ok: true, isConnected: true, provider, message: 'Local-only mode is ready.' };
  }

  const stringValues = Object.values(configJson).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const hasConfig = stringValues.length > 0;
  const hasFeedUrl = typeof configJson.feedUrl === 'string' && configJson.feedUrl.trim().length > 0;
  const hasCalendarId = typeof configJson.calendarId === 'string' && configJson.calendarId.trim().length > 0;
  const hasInboxSource = typeof configJson.inboxSource === 'string' && configJson.inboxSource.includes('BEGIN:VCALENDAR');
  const hasMailConnection = Boolean(settings.mail.imapHost || settings.mail.smtpHost);

  if (provider === 'invite-mail') {
    const ok = hasInboxSource || hasMailConnection || hasConfig;
    return {
      ok,
      isConnected: ok,
      provider,
      message: ok ? 'Invite-mail sync is connected.' : 'Add IMAP/SMTP details or a sample invite source first.',
    };
  }

  const ok = hasFeedUrl || hasCalendarId || hasConfig;
  return {
    ok,
    isConnected: ok,
    provider,
    message: ok ? `${provider} sync is connected.` : `Add ${provider} calendar details before connecting.`,
  };
}

function cloneSettings(settings: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(settings)) as AppSettings;
}

function resolveSettingsPath(): string {
  if (process.env.SETTINGS_FILE) {
    return path.resolve(process.env.SETTINGS_FILE);
  }

  return path.resolve(process.cwd(), 'packages', 'backend', 'data', 'app-settings.json');
}
