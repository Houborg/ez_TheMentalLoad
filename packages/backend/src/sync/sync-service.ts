import type { SyncConnectRequest, SyncConnectResponse, SyncRunRequest, SyncRunResponse, SyncProvider } from '@mental-load/contracts';
import { EntryService } from '../domains/entries/entry-service';
import { ISettingsService } from '../settings/settings-service';

export class SyncService {
  constructor(
    private readonly settingsService: ISettingsService,
    private readonly entryService: EntryService,
  ) {}

  async connect(input: SyncConnectRequest): Promise<SyncConnectResponse> {
    return this.settingsService.connectSyncProvider(input.provider, input.configJson);
  }

  async run(input: SyncRunRequest): Promise<SyncRunResponse> {
    const settings = await this.settingsService.getSettings();
    const provider = input.provider ?? settings.sync.provider;
    const rawSource = await resolveSyncSource(provider, input, settings.sync.configJson);
    const ics = extractIcs(rawSource);
    const lastSyncAt = new Date().toISOString();

    if (!ics) {
      return {
        ok: false,
        provider,
        importedCount: 0,
        lastSyncAt,
        message: 'No ICS calendar payload was available to import.',
      };
    }

    const result = await this.entryService.importFromIcs({
      calendarId: input.calendarId,
      ownerMemberId: input.ownerMemberId,
      ics,
    });

    await this.settingsService.markSyncRun(provider, result.importedCount, {
      ...settings.sync.configJson,
      lastProvider: provider,
    });

    return {
      ok: true,
      provider,
      importedCount: result.importedCount,
      lastSyncAt,
      message: `Imported ${result.importedCount} event(s) from ${provider} sync.`,
    };
  }
}

async function resolveSyncSource(
  provider: SyncProvider,
  input: SyncRunRequest,
  configJson: Record<string, unknown>,
): Promise<string> {
  if (input.rawContent?.trim()) {
    return input.rawContent;
  }

  const configuredFeed = typeof input.icsUrl === 'string' && input.icsUrl.trim()
    ? input.icsUrl
    : typeof configJson.feedUrl === 'string'
      ? configJson.feedUrl
      : '';

  if (configuredFeed) {
    try {
      const response = await fetch(configuredFeed);
      if (response.ok) {
        return await response.text();
      }
    } catch {
      // fall back to locally configured content
    }
  }

  if (typeof configJson.sampleIcs === 'string') {
    return configJson.sampleIcs;
  }

  return '';
}

function extractIcs(value: string): string {
  const start = value.indexOf('BEGIN:VCALENDAR');
  const end = value.indexOf('END:VCALENDAR');

  if (start < 0 || end < 0) {
    return '';
  }

  return `${value.slice(start, end + 'END:VCALENDAR'.length)}\r\n`;
}
