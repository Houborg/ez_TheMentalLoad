import { v4 as uuid } from 'uuid';
import * as ical from 'node-ical';
import type { Pool } from 'pg';
import type { Entry, SyncConnection } from '@mental-load/contracts';
import type { CalendarAdapter, ConnectionConfig } from './calendar-adapter';

export interface CreateConnectionInput {
  provider: 'apple' | 'google';
  importEnabled: boolean;
  exportEnabled: boolean;
  syncIntervalMinutes?: number;
  appleId?: string;
  caldavUrl?: string;
  appPassword?: string;
  calendarPath?: string;
  calendarName?: string;
  targetCalendarId?: string;
  targetMemberId?: string;
}

export class SyncConnectionService {
  constructor(
    private readonly pool: Pool,
    private readonly familyId: string,
    private readonly adapter: CalendarAdapter,
  ) {}

  private async listConnectionsRaw(): Promise<SyncConnection[]> {
    const result = await this.pool.query<{ settings_json: Record<string, unknown> }>(
      'select settings_json from families where id = $1',
      [this.familyId],
    );
    const raw = result.rows[0]?.settings_json ?? {};
    return (raw.sync_connections as SyncConnection[] | undefined) ?? [];
  }

  async listConnections(): Promise<SyncConnection[]> {
    return (await this.listConnectionsRaw()).map((c) => this.toPublic(c));
  }

  private async getConnectionRaw(connectionId: string): Promise<SyncConnection | undefined> {
    const connections = await this.listConnectionsRaw();
    return connections.find((c) => c.id === connectionId);
  }

  async getConnection(connectionId: string): Promise<SyncConnection | undefined> {
    const found = await this.getConnectionRaw(connectionId);
    return found ? this.toPublic(found) : undefined;
  }

  async createConnection(input: CreateConnectionInput): Promise<SyncConnection> {
    const connections = await this.listConnectionsRaw();
    const duplicate = connections.find((c) => c.provider === input.provider);
    if (duplicate) {
      throw new Error(`${input.provider} is already connected. Disconnect it first or use reconfigure.`);
    }

    const connection: SyncConnection = {
      id: uuid(),
      provider: input.provider,
      isConnected: true,
      importEnabled: input.importEnabled,
      exportEnabled: input.exportEnabled,
      syncIntervalMinutes: input.syncIntervalMinutes ?? 15,
      appleId: input.appleId,
      caldavUrl: input.caldavUrl ?? 'https://caldav.icloud.com',
      appPassword: input.appPassword,
      calendarPath: input.calendarPath,
      calendarName: input.calendarName,
      targetCalendarId: input.targetCalendarId,
      targetMemberId: input.targetMemberId,
      createdAt: new Date().toISOString(),
    };

    await this.saveConnections([...connections, connection]);
    return this.toPublic(connection);
  }

  async updateConnection(connectionId: string, patch: Partial<SyncConnection>): Promise<SyncConnection> {
    const connections = await this.listConnectionsRaw();
    const idx = connections.findIndex((c) => c.id === connectionId);
    if (idx < 0) throw new Error(`Connection ${connectionId} not found`);
    const updated = { ...connections[idx], ...patch };
    connections[idx] = updated;
    await this.saveConnections(connections);
    return this.toPublic(updated);
  }

  async deleteConnection(connectionId: string): Promise<void> {
    const connections = await this.listConnectionsRaw();
    await this.saveConnections(connections.filter((c) => c.id !== connectionId));
  }

  async verify(config: Pick<ConnectionConfig, 'caldavUrl' | 'username' | 'password'> & { provider: 'apple' | 'google' }): Promise<boolean> {
    return this.adapter.verify({
      provider: config.provider,
      caldavUrl: config.caldavUrl,
      username: config.username,
      password: config.password,
      calendarPath: '',
    });
  }

  async listRemoteCalendars(config: Pick<ConnectionConfig, 'caldavUrl' | 'username' | 'password'>) {
    return this.adapter.listCalendars(config);
  }

  async runSync(
    connectionId: string,
    entryRepository: {
      list(): Promise<Entry[]>;
      create(entry: Entry): Promise<Entry>;
      findByExternalUid(uid: string): Promise<Entry | undefined>;
    },
  ): Promise<{ importedCount: number; exportedCount: number }> {
    const conn = await this.getConnectionRaw(connectionId);
    if (!conn || !conn.isConnected || !conn.caldavUrl || !conn.appPassword || !conn.calendarPath) {
      return { importedCount: 0, exportedCount: 0 };
    }

    const adapterConfig: ConnectionConfig = {
      provider: conn.provider as 'apple' | 'google',
      caldavUrl: conn.caldavUrl,
      username: conn.appleId ?? '',
      password: conn.appPassword,
      calendarPath: conn.calendarPath,
    };

    let importedCount = 0;
    let exportedCount = 0;

    if (conn.importEnabled && conn.targetCalendarId && conn.targetMemberId) {
      const since = conn.lastSyncAt ? new Date(conn.lastSyncAt) : undefined;
      const remoteEvents = await this.adapter.importEvents(adapterConfig, since);

      for (const event of remoteEvents) {
        if (!event.uid) continue;
        // Skip events we exported ourselves — their UIDs follow the pattern mental-load-{id}@mentalload
        if (event.uid.startsWith('mental-load-') && event.uid.endsWith('@mentalload')) continue;
        const existing = await entryRepository.findByExternalUid(event.uid);
        if (existing) continue;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsed = ical.sync.parseICS(event.icalData) as Record<string, any>;
        for (const component of Object.values(parsed)) {
          if (component.type !== 'VEVENT' || !(component.start instanceof Date)) continue;
          const now = new Date().toISOString();
          await entryRepository.create({
            id: uuid(),
            externalUid: event.uid,
            title: (component.summary as string | undefined) ?? 'Imported event',
            type: 'event',
            ownerMemberId: conn.targetMemberId,
            calendarId: conn.targetCalendarId,
            startTime: component.start.toISOString(),
            endTime: component.end instanceof Date ? component.end.toISOString() : component.start.toISOString(),
            timezone: (component.start.tz as string | undefined) ?? 'UTC',
            allDay: component.datetype === 'date',
            location: typeof component.location === 'string' ? component.location : undefined,
            reminders: [],
            checklist: [],
            invitees: [],
            linkedEntryIds: [],
            status: 'active',
            createdAt: now,
            updatedAt: now,
          });
          importedCount++;
        }
      }
    } else if (conn.importEnabled) {
      console.warn(`[sync] connection ${connectionId} has importEnabled but no targetCalendarId/targetMemberId — skipping import`);
    }

    if (conn.exportEnabled) {
      const entries = await entryRepository.list();
      const now = new Date().toISOString();
      // Only export one-off upcoming events — skip recurring entries (they have recurrenceRule)
      // to avoid Apple Calendar expanding RRULE into all future occurrences
      const toExport = entries.filter((e) => !e.parentEntryId && !e.recurrenceRule && !e.externalUid && e.endTime >= now);
      for (const entry of toExport) {
        await this.adapter.exportEntry(adapterConfig, entry);
        exportedCount++;
      }
    }

    await this.updateConnection(connectionId, {
      lastSyncAt: new Date().toISOString(),
      lastImportCount: importedCount,
      lastExportCount: exportedCount,
    });

    return { importedCount, exportedCount };
  }

  private async saveConnections(connections: SyncConnection[]): Promise<void> {
    await this.pool.query(
      `update families
       set settings_json = jsonb_set(settings_json, '{sync_connections}', $1::jsonb)
       where id = $2`,
      [JSON.stringify(connections), this.familyId],
    );
  }

  private toPublic(connection: SyncConnection): SyncConnection {
    const { appPassword: _stripped, ...rest } = connection;
    return rest as SyncConnection;
  }
}
