// packages/backend/src/aula/aula-sync-service.ts
import { v4 as uuid } from 'uuid';
import type { Pool } from 'pg';
import type { Entry, AulaPresence } from '@mental-load/contracts';
import { AulaConnectionService } from './aula-connection-service.js';
import { AulaAuthExpiredError } from './aula-types.js';
import { PostgresEntryRepository } from '../repositories/postgres/entry-repository.js';
import type { DomainEventBus } from '../events/domain-event-bus.js';

const SIDECAR_URL = process.env.AULA_SIDECAR_URL ?? 'http://localhost:8765';

function parsePublishedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

interface SidecarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location?: string;
  childId: number;
}

interface SidecarPost {
  id: string;
  title?: string;
  body: string;
  author?: string;
  publishedAt?: string;
}

interface SidecarMessage {
  id: string;
  threadId?: number;
  subject?: string;
  body: string;
  author?: string;
  sentAt?: string;
}

interface SidecarWeekplanLesson {
  childId: number;
  date: string;            // 'YYYY-MM-DD'
  startTime?: string | null;
  endTime?: string | null;
  title: string;
  description?: string | null;
  source: 'meebook' | 'easyiq' | 'ugeplan';
  seq: number;
}

interface SidecarMuTask {
  childId: number;
  id: string;
  title: string;
  subject?: string;
  dueDate: string;
  description?: string;
  status: string;
  url?: string;
}

interface SidecarPresence {
  childId: number;
  status: string;
  statusLabel: string;
  entryTime?: string | null;
  exitTime?: string | null;
  comment?: string | null;
  asOf: string;
}

export class AulaSyncService {
  constructor(
    private readonly pool: Pool,
    private readonly familyId: string,
    private readonly eventBus?: DomainEventBus,
  ) {}

  async runSync(): Promise<{ entriesCreated: number; itemsCreated: number }> {
    const connSvc = new AulaConnectionService(this.pool, this.familyId);
    const conn = await connSvc.getConnection();

    if (!conn || !conn.isConnected) return { entriesCreated: 0, itemsCreated: 0 };
    if (!conn.tokenData) {
      console.warn(`[aula-sync] family ${this.familyId} has no tokenData — reconnect via Settings → Aula`);
      throw new Error('Aula-forbindelsen mangler tokenData — afbryd og forbind igen via Indstillinger → Aula');
    }

    let entriesCreated = 0;
    let itemsCreated = 0;

    try {
      const from = conn.lastSyncAt
        ? new Date(conn.lastSyncAt).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const childIds = conn.childMappings.map(m => m.aulaChildId);

      const res = await fetch(`${SIDECAR_URL}/fetch-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token_data: conn.tokenData,
          child_ids: conn.syncOptions.calendarEvents ? childIds : [],
          from_date: from,
          to_date: to,
          fetch_posts: conn.syncOptions.posts,
          fetch_messages: conn.syncOptions.messages,
          fetch_weekplan: conn.syncOptions.dailyOverview,
          fetch_mu_tasks: conn.syncOptions.muTasks,
          fetch_presence: conn.syncOptions.presence,
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        if (res.status === 401 || txt.toLowerCase().includes('auth')) {
          await connSvc.setConnected(false);
          throw new AulaAuthExpiredError();
        }
        throw new Error(`Sidecar fetch-data failed: ${res.status} ${txt.slice(0, 200)}`);
      }

      const data = await res.json() as {
        calendar_events: SidecarEvent[];
        weekplan_lessons: SidecarWeekplanLesson[];
        posts: SidecarPost[];
        messages: SidecarMessage[];
        mu_tasks: SidecarMuTask[];
        presence: SidecarPresence[];
      };

      // Calendar events → entries
      if (conn.syncOptions.calendarEvents) {
        for (const event of data.calendar_events) {
          const externalUid = `aula-${event.id}`;
          const exists = await this.findByExternalUid(externalUid);
          if (exists) continue;

          if (conn.syncOptions.importToCalendar) {
            const mapping = conn.childMappings.find(m => m.aulaChildId === event.childId);
            if (mapping) {
              await this.createEntry(event, externalUid, mapping.mentalLoadMemberId, mapping.calendarId);
              entriesCreated++;
            }
          }
        }
      }

      // Weekplan lessons → aula_items (one row per lesson per child per day).
      // published_at is date-only (midnight in server TZ). The actual lesson
      // start/end times live in raw_json.startTime / raw_json.endTime — encoding
      // them in published_at would require a TZ library since the sidecar
      // emits HH:MM in Europe/Copenhagen local time.
      if (conn.syncOptions.dailyOverview) {
        for (const lesson of data.weekplan_lessons ?? []) {
          const mapping = conn.childMappings.find(m => m.aulaChildId === lesson.childId);
          if (!mapping) continue;
          const aulaId = `weekplan-${lesson.childId}-${lesson.date}-${lesson.seq}`;
          const inserted = await this.upsertAulaItem({
            aulaId,
            type: 'weekplan_lesson',
            title: lesson.title,
            body: lesson.description ?? '',
            memberId: mapping.mentalLoadMemberId,
            publishedAt: lesson.date,
            rawJson: lesson,
          });
          if (inserted) itemsCreated++;
        }
      }

      // Posts → aula_items
      if (conn.syncOptions.posts) {
        for (const post of data.posts) {
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

      // Messages → aula_items
      if (conn.syncOptions.messages) {
        for (const msg of data.messages) {
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

      // MU homework → aula_items (one row per task per child).
      if (conn.syncOptions.muTasks) {
        for (const task of data.mu_tasks ?? []) {
          const mapping = conn.childMappings.find(m => m.aulaChildId === task.childId);
          if (!mapping) continue;
          const inserted = await this.upsertAulaItem({
            aulaId: `mu-${task.id}`,
            type: 'mu_task',
            title: task.title,
            body: task.description ?? '',
            memberId: mapping.mentalLoadMemberId,
            publishedAt: task.dueDate,
            rawJson: task,
            mode: 'insert',
          });
          if (inserted) itemsCreated++;
        }
      }

      // Presence → aula_items (one row per child, overwritten on every sync).
      if (conn.syncOptions.presence) {
        for (const p of data.presence ?? []) {
          const mapping = conn.childMappings.find(m => m.aulaChildId === p.childId);
          if (!mapping) continue;
          const bodyText = p.entryTime
            ? `${p.statusLabel} — kom kl. ${p.entryTime}`
            : p.statusLabel;
          const inserted = await this.upsertAulaItem({
            aulaId: `presence-${p.childId}`,
            type: 'presence',
            title: p.status,
            body: bodyText,
            memberId: mapping.mentalLoadMemberId,
            publishedAt: p.asOf,
            rawJson: p,
            mode: 'upsert',
          });
          // Emit on every presence sync — even if rowCount==0 from the upsert,
          // the row's content was overwritten and listeners should refresh.
          this.eventBus?.emit({
            name: 'aula.presence.updated',
            payload: {
              memberId: mapping.mentalLoadMemberId,
              presence: {
                status: p.status,
                statusLabel: p.statusLabel,
                entryTime: p.entryTime ?? undefined,
                exitTime: p.exitTime ?? undefined,
                comment: p.comment ?? undefined,
                asOf: p.asOf,
              } satisfies AulaPresence,
            },
            occurredAt: new Date().toISOString(),
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
      throw err;
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
    event: SidecarEvent,
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
    mode?: 'insert' | 'upsert';   // NEW — defaults to 'insert' for back-compat
  }): Promise<boolean> {
    const publishedAt = parsePublishedAt(item.publishedAt);
    const mode = item.mode ?? 'insert';
    const conflictClause = mode === 'upsert'
      ? `on conflict (family_id, aula_id, type) do update set
           title = excluded.title,
           body = excluded.body,
           author = excluded.author,
           published_at = excluded.published_at,
           raw_json = excluded.raw_json`
      : `on conflict (family_id, aula_id, type) do nothing`;

    const result = await this.pool.query(
      `insert into aula_items (family_id, aula_id, type, title, body, author, member_id, published_at, raw_json)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ${conflictClause}`,
      [
        this.familyId, item.aulaId, item.type, item.title, item.body,
        item.author ?? null, item.memberId, publishedAt,
        JSON.stringify(item.rawJson),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
