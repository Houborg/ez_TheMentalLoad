// packages/backend/src/aula/aula-sync-service.ts
import { v4 as uuid } from 'uuid';
import type { Pool } from 'pg';
import type { Entry } from '@mental-load/contracts';
import { AulaClient } from './aula-client.js';
import { AulaConnectionService } from './aula-connection-service.js';
import { AulaAuthExpiredError, type AulaCalendarEvent } from './aula-types.js';
import { PostgresEntryRepository } from '../repositories/postgres/entry-repository.js';

export class AulaSyncService {
  constructor(private readonly pool: Pool, private readonly familyId: string) {}

  async runSync(): Promise<{ entriesCreated: number; itemsCreated: number }> {
    const connSvc = new AulaConnectionService(this.pool, this.familyId);
    const conn = await connSvc.getConnection();

    if (!conn || !conn.isConnected) return { entriesCreated: 0, itemsCreated: 0 };

    let entriesCreated = 0;
    let itemsCreated = 0;

    const client = new AulaClient(
      { accessToken: conn.accessToken, refreshToken: conn.refreshToken, expiresAt: conn.expiresAt },
      async (tokens) => connSvc.updateTokens(tokens),
    );

    try {
      if (conn.syncOptions.calendarEvents) {
        const from = conn.lastSyncAt
          ? new Date(conn.lastSyncAt).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        const to = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        for (const mapping of conn.childMappings) {
          const events = await client.getCalendarEvents([mapping.aulaChildId], from, to);
          for (const event of events) {
            const externalUid = `aula-${event.id}`;
            const exists = await this.findByExternalUid(externalUid);
            if (exists) continue;

            if (conn.syncOptions.importToCalendar) {
              await this.createEntry(event, externalUid, mapping.mentalLoadMemberId, mapping.calendarId);
              entriesCreated++;
            }
          }
        }
      }

      if (conn.syncOptions.dailyOverview) {
        const childIds = conn.childMappings.map(m => m.aulaChildId);
        const overviews = await client.getDailyOverview(childIds);
        for (const ov of overviews) {
          const mapping = conn.childMappings.find(m => m.aulaChildId === ov.childId);
          const inserted = await this.upsertAulaItem({
            aulaId: `daily-${ov.childId}-${ov.date}`,
            type: 'daily_overview',
            title: `Dagsoverblik ${ov.date}`,
            body: ov.status ?? '',
            memberId: mapping?.mentalLoadMemberId ?? null,
            publishedAt: ov.date,
            rawJson: ov,
          });
          if (inserted) itemsCreated++;
        }
      }

      if (conn.syncOptions.posts) {
        const posts = await client.getPosts(50);
        for (const post of posts) {
          const inserted = await this.upsertAulaItem({
            aulaId: `post-${post.id}`,
            type: 'post',
            title: post.title ?? null,
            body: post.body,
            author: post.author ?? null,
            memberId: null,
            publishedAt: post.publishedAt ?? null,
            rawJson: post,
          });
          if (inserted) itemsCreated++;
        }
      }

      if (conn.syncOptions.messages) {
        const messages = await client.getThreads(20);
        for (const msg of messages) {
          const inserted = await this.upsertAulaItem({
            aulaId: `msg-${msg.id}`,
            type: 'message',
            title: msg.subject ?? null,
            body: msg.body,
            author: msg.author ?? null,
            memberId: null,
            publishedAt: msg.sentAt ?? null,
            rawJson: msg,
          });
          if (inserted) itemsCreated++;
        }
      }

      await connSvc.updateSyncStats({ entriesCreated, itemsCreated });
      return { entriesCreated, itemsCreated };
    } catch (err) {
      if (err instanceof AulaAuthExpiredError) {
        await connSvc.setConnected(false);
        console.error(`[aula-sync] auth expired for family ${this.familyId} — disconnected`);
      } else {
        console.error(`[aula-sync] sync error for family ${this.familyId}:`, err);
      }
      return { entriesCreated, itemsCreated };
    }
  }

  private async findByExternalUid(uid: string): Promise<boolean> {
    const result = await this.pool.query(
      'select id from entries where external_uid = $1 and family_id = $2 limit 1',
      [uid, this.familyId],
    );
    return result.rows.length > 0;
  }

  private async createEntry(
    event: AulaCalendarEvent,
    externalUid: string,
    ownerMemberId: string,
    calendarId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const repo = new PostgresEntryRepository(this.pool);
    const entry: Entry = {
      id: uuid(),
      externalUid,
      title: event.title,
      type: 'event',
      ownerMemberId,
      calendarId,
      startTime: event.startTime,
      endTime: event.endTime,
      timezone: 'Europe/Copenhagen',
      allDay: event.allDay,
      location: event.location,
      reminders: [],
      checklist: [],
      invitees: [],
      linkedEntryIds: [],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await repo.create(entry, this.familyId);
  }

  private async upsertAulaItem(item: {
    aulaId: string;
    type: string;
    title: string | null;
    body: string;
    author?: string | null;
    memberId: string | null;
    publishedAt: string | null;
    rawJson: unknown;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `insert into aula_items (family_id, aula_id, type, title, body, author, member_id, published_at, raw_json)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (family_id, aula_id, type) do nothing`,
      [
        this.familyId, item.aulaId, item.type, item.title, item.body,
        item.author ?? null, item.memberId, item.publishedAt,
        JSON.stringify(item.rawJson),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
