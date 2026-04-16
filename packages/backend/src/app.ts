import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { v4 as uuid } from 'uuid';
import type {
  AssistantConfirmRequest,
  AssistantFunRequest,
  AssistantParseRequest,
  CreateEntryRequest,
  CreateMemberRequest,
  DeleteFoodPlanItemRequest,
  Entry,
  FoodPlanDay,
  ListFoodPlanResponse,
  SyncConnectRequest,
  SyncRunRequest,
  TestEmailRequest,
  PullInboxToMailpitRequest,
  UpdateEntryRequest,
  UpdateMemberRequest,
  UpdateSettingsRequest,
  UpsertFoodPlanItemRequest,
} from '@mental-load/contracts';
import { AssistantService } from './domains/assistant/assistant-service';
import { DomainEventBus } from './events/domain-event-bus';
import { EntryService } from './domains/entries/entry-service';
import { MailService } from './mail/mail-service';
import { InboxBridgeService } from './mail/inbox-bridge-service';
import { createRepositoryBundle } from './repositories/repository-factory';
import { SettingsService } from './settings/settings-service';
import { SyncService } from './sync/sync-service';

export async function buildApp() {
  const app = Fastify({ logger: false });
  const eventBus = new DomainEventBus();
  const infrastructure = await createRepositoryBundle();
  const { memberRepository, calendarRepository, entryRepository, foodPlanRepository, reminderScheduler, persistence, close } = infrastructure;
  const entryService = new EntryService(entryRepository, eventBus, reminderScheduler);
  const settingsService = new SettingsService();
  const mailService = new MailService();
  const inboxBridgeService = new InboxBridgeService();
  const syncService = new SyncService(settingsService, entryService);
  const assistantService = new AssistantService(
    () => memberRepository.list(),
    () => calendarRepository.list(),
    (input) => entryService.createEntry(input),
    async () => {
      const settings = await settingsService.getSettings();
      return {
        ollamaUrl: settings.assistant.ollamaUrl,
        modelName: settings.assistant.modelName,
      };
    },
  );
  const sockets = new Set<{ send: (message: string) => void }>();
  let mailpitTimer: NodeJS.Timeout | undefined;
  let mailpitClosed = false;

  await app.register(cors, { origin: true });
  await app.register(websocket);
  app.addHook('onClose', async () => {
    mailpitClosed = true;
    if (mailpitTimer) {
      clearTimeout(mailpitTimer);
    }
    await close();
  });

  app.get('/api/v1/health', async () => ({
    status: 'ok' as const,
    service: 'mental-load-backend',
    persistence,
    now: new Date().toISOString(),
  }));

  app.get('/api/v1/settings', async () => settingsService.getSettings());

  app.put<{ Body: UpdateSettingsRequest }>('/api/v1/settings', async (request, reply) => {
    try {
      return await settingsService.updateSettings(request.body ?? {});
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : 'Could not save settings' };
    }
  });

  app.post<{ Body: TestEmailRequest }>('/api/v1/settings/test-email', async (request) => {
    const settings = await settingsService.getSettings();
    return mailService.sendTestEmail(request.body?.to ?? settings.mail.testRecipient, settings.mail);
  });

  app.post<{ Body: PullInboxToMailpitRequest }>('/api/v1/mailpit/pull-inbox', async (request, reply) => {
    const settings = await settingsService.getSettings();
    const storedUid = Number(settings.sync.configJson.mailpitLastUid ?? 0);
    const requestedUid = Number(request.body?.sinceUid ?? storedUid);
    const limit = Number(request.body?.limit ?? 20);

    const result = await inboxBridgeService.pullInboxToMailpit(settings, Number.isFinite(requestedUid) ? requestedUid : 0, Number.isFinite(limit) ? limit : 20);
    if (!result.ok) {
      reply.code(400);
      return result;
    }

    if (result.latestUid > storedUid) {
      await settingsService.updateSettings({
        sync: {
          ...settings.sync,
          configJson: {
            ...settings.sync.configJson,
            mailpitLastUid: result.latestUid,
          },
        },
      });
    }

    return result;
  });

  app.post<{ Body: SyncConnectRequest }>('/api/v1/sync/connect', async (request, reply) => {
    const result = await syncService.connect(request.body);
    reply.code(result.ok ? 200 : 400);
    return result;
  });

  app.post<{ Body: SyncRunRequest }>('/api/v1/sync/run', async (request, reply) => {
    const result = await syncService.run(request.body);
    reply.code(result.ok ? 200 : 400);
    return result;
  });

  app.get('/api/v1/members', async () => memberRepository.list());
  app.post<{ Body: CreateMemberRequest }>('/api/v1/members', async (request, reply) => {
    const name = request.body.name?.trim();
    if (!name) {
      reply.code(400);
      return { message: 'Name is required' };
    }

    const created = {
      id: uuid(),
      name,
      role: request.body.role,
      email: request.body.email?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    await memberRepository.create(created);
    reply.code(201);
    return created;
  });

  app.patch<{ Params: { id: string }; Body: UpdateMemberRequest }>('/api/v1/members/:id', async (request, reply) => {
    const patch: UpdateMemberRequest = {};

    if (typeof request.body.name === 'string') {
      const trimmedName = request.body.name.trim();
      if (!trimmedName) {
        reply.code(400);
        return { message: 'Name cannot be empty' };
      }
      patch.name = trimmedName;
    }

    if (request.body.role) {
      patch.role = request.body.role;
    }

    if (typeof request.body.email === 'string') {
      const trimmedEmail = request.body.email.trim();
      patch.email = trimmedEmail || undefined;
    }

    const updated = await memberRepository.update(request.params.id, patch);
    if (!updated) {
      reply.code(404);
      return { message: 'Member not found' };
    }

    return updated;
  });

  app.get<{ Querystring: { weekStart?: string } }>('/api/v1/food-plan', async (request, reply): Promise<ListFoodPlanResponse | { message: string }> => {
    const weekStart = normalizeWeekStart(request.query.weekStart);
    if (!weekStart) {
      reply.code(400);
      return { message: 'weekStart must be an ISO date (YYYY-MM-DD)' };
    }

    const items = await foodPlanRepository.listByWeek(weekStart);
    return { weekStart, items };
  });

  app.put<{ Body: UpsertFoodPlanItemRequest }>('/api/v1/food-plan', async (request, reply) => {
    const weekStart = normalizeWeekStart(request.body.weekStart);
    if (!weekStart || !isFoodPlanDay(request.body.day)) {
      reply.code(400);
      return { message: 'Invalid weekStart or day' };
    }

    const dishName = request.body.dishName?.trim();
    if (!dishName) {
      reply.code(400);
      return { message: 'dishName is required' };
    }

    const groceryList = (request.body.groceryList ?? []).map((item) => item.trim()).filter(Boolean);
    const item = await foodPlanRepository.upsert({
      weekStart,
      day: request.body.day,
      dishName,
      groceryList,
    });

    return item;
  });

  app.delete<{ Body: DeleteFoodPlanItemRequest }>('/api/v1/food-plan', async (request, reply) => {
    const weekStart = normalizeWeekStart(request.body.weekStart);
    if (!weekStart || !isFoodPlanDay(request.body.day)) {
      reply.code(400);
      return { message: 'Invalid weekStart or day' };
    }

    const deleted = await foodPlanRepository.deleteByWeekAndDay(weekStart, request.body.day);
    if (!deleted) {
      reply.code(404);
      return { message: 'Food plan item not found' };
    }

    reply.code(204);
    return null;
  });

  app.get('/api/v1/calendars', async () => calendarRepository.list());
  app.get('/api/v1/entries', async () => entryService.listEntries());
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/v1/entries/occurrences', async (request, reply) => {
    const from = request.query.from ?? new Date().toISOString();
    const to = request.query.to ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    if (Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime())) {
      reply.code(400);
      return { message: 'Invalid date range' };
    }

    return entryService.listOccurrences(from, to);
  });
  app.get('/api/v1/reminders/jobs', async () => entryService.listReminderJobs());
  app.get('/api/v1/dashboard', async () => ({
    members: await memberRepository.list(),
    calendars: await calendarRepository.list(),
    entries: await entryService.listEntries(),
    reminderJobs: await entryService.listReminderJobs(),
    persistence,
  }));

  app.post<{ Body: CreateEntryRequest }>('/api/v1/entries', async (request, reply) => {
    const created = await entryService.createEntry(request.body);
    try {
      await sendInviteEmailsForEntry(created);
    } catch {
      // Keep entry creation successful even if outbound invite email fails.
    }
    reply.code(201);
    return created;
  });

  app.post<{ Body: AssistantParseRequest }>('/api/v1/assistant/parse', async (request, reply) => {
    const result = await assistantService.parseRequest(request.body);
    reply.code(200);
    return result;
  });

  app.post<{ Body: AssistantFunRequest }>('/api/v1/assistant/fun', async (request, reply) => {
    const result = await assistantService.funChat(request.body);
    reply.code(200);
    return result;
  });

  app.post<{ Body: AssistantConfirmRequest }>('/api/v1/assistant/confirm', async (request, reply) => {
    try {
      const created = await assistantService.confirmDraft(request.body);
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : 'Invalid assistant draft' };
    }
  });

  app.post<{ Body: { calendarId: string; ownerMemberId: string; ics: string } }>('/api/v1/entries/import/ics', async (request, reply) => {
    const result = await entryService.importFromIcs(request.body);
    reply.code(200);
    return result;
  });

  app.get<{ Params: { id: string } }>('/api/v1/calendars/:id/export.ics', async (request, reply) => {
    const body = await entryService.exportCalendarIcs(request.params.id);
    reply.header('Content-Type', 'text/calendar; charset=utf-8');
    return body;
  });

  app.patch<{ Params: { id: string }; Body: UpdateEntryRequest }>('/api/v1/entries/:id', async (request, reply) => {
    const updated = await entryService.updateEntry(request.params.id, request.body);
    if (!updated) {
      reply.code(404);
      return { message: 'Entry not found' };
    }
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/v1/entries/:id', async (request, reply) => {
    const deleted = await entryService.deleteEntry(request.params.id);
    if (!deleted) {
      reply.code(404);
      return { message: 'Entry not found' };
    }
    reply.code(204);
    return null;
  });

  app.get('/ws', { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: 'connected', id: uuid() }));
    socket.on('close', () => sockets.delete(socket));
  });

  eventBus.on('entry.created', (event) => {
    broadcast({ type: 'entry.created', payload: event.payload, occurredAt: event.occurredAt });
  });

  eventBus.on('entry.updated', (event) => {
    broadcast({ type: 'entry.updated', payload: event.payload, occurredAt: event.occurredAt });
  });

  eventBus.on('entry.deleted', (event) => {
    broadcast({ type: 'entry.deleted', payload: event.payload, occurredAt: event.occurredAt });
  });

  eventBus.on('reminder.scheduled', (event) => {
    broadcast({ type: 'reminder.scheduled', payload: event.payload, occurredAt: event.occurredAt });
  });

  function broadcast(message: unknown): void {
    const serialized = JSON.stringify(message);
    for (const socket of sockets) {
      socket.send(serialized);
    }
  }

  async function sendInviteEmailsForEntry(entry: Entry): Promise<void> {
    if (entry.type !== 'event') {
      return;
    }

    const settings = await settingsService.getSettings();
    const recipients = [...new Set(entry.invitees.map((invitee) => invitee.email.trim().toLowerCase()).filter(Boolean))];

    if (recipients.length === 0) {
      const owner = await memberRepository.findById(entry.ownerMemberId);
      const ownerEmail = owner?.email?.trim().toLowerCase();
      if (ownerEmail) {
        recipients.push(ownerEmail);
      }
    }

    if (recipients.length === 0) {
      const fallbackRecipient = settings.mail.testRecipient?.trim().toLowerCase();
      if (fallbackRecipient) {
        recipients.push(fallbackRecipient);
      }
    }

    if (recipients.length === 0) {
      return;
    }

    const ics = buildEntryInviteIcs(entry);
    await Promise.all(recipients.map(async (email) => {
      await mailService.sendInvite({
        to: email,
        subject: `Invitation: ${entry.title}`,
        text: [
          `You are invited to: ${entry.title}`,
          `When: ${new Date(entry.startTime).toLocaleString()} - ${new Date(entry.endTime).toLocaleString()}`,
          '',
          'An .ics calendar invite is attached.',
        ].join('\n'),
        attachments: [{
          filename: 'invite.ics',
          content: ics,
          contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        }],
      }, settings.mail);
    }));
  }

  scheduleMailpitPull(15_000);

  return app;

  function scheduleMailpitPull(delayMs?: number): void {
    if (mailpitClosed) {
      return;
    }

    if (mailpitTimer) {
      clearTimeout(mailpitTimer);
    }

    const nextDelayMs = typeof delayMs === 'number' ? delayMs : 60_000;
    mailpitTimer = setTimeout(async () => {
      try {
        const settings = await settingsService.getSettings();
        const autoPullEnabled = settings.sync.configJson.mailpitAutoPullEnabled !== false;
        const pullMinutes = getMailpitPullMinutes(settings.sync.configJson.mailpitPullMinutes);

        if (autoPullEnabled) {
          const storedUid = Number(settings.sync.configJson.mailpitLastUid ?? 0);
          const result = await inboxBridgeService.pullInboxToMailpit(settings, storedUid, 25);
          if (result.ok && result.latestUid > storedUid) {
            await settingsService.updateSettings({
              sync: {
                ...settings.sync,
                configJson: {
                  ...settings.sync.configJson,
                  mailpitLastUid: result.latestUid,
                },
              },
            });
          }
        }

        scheduleMailpitPull(pullMinutes * 60_000);
      } catch {
        scheduleMailpitPull(60_000);
      }
    }, nextDelayMs);
  }
}

const FOOD_PLAN_DAYS: FoodPlanDay[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function isFoodPlanDay(value: string): value is FoodPlanDay {
  return FOOD_PLAN_DAYS.includes(value as FoodPlanDay);
}

function normalizeWeekStart(value?: string): string | undefined {
  if (!value) {
    const now = new Date();
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = monday.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    monday.setUTCDate(monday.getUTCDate() + diff);
    return monday.toISOString().slice(0, 10);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return value;
}

function getMailpitPullMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return Math.floor(parsed);
}

function buildEntryInviteIcs(entry: Entry): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//MentalLoad//Planner//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${entry.id}`,
    `DTSTAMP:${toIcsTimestamp(entry.updatedAt)}`,
    `DTSTART:${toIcsTimestamp(entry.startTime, entry.allDay)}`,
    `DTEND:${toIcsTimestamp(entry.endTime, entry.allDay)}`,
    `SUMMARY:${escapeIcsText(entry.title)}`,
    `STATUS:${entry.status.toUpperCase()}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${lines.join('\r\n')}\r\n`;
}

function toIcsTimestamp(value: string, allDay = false): string {
  const date = new Date(value);
  if (allDay) {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }

  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}
