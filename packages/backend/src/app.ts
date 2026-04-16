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
  SyncConnectRequest,
  SyncRunRequest,
  TestEmailRequest,
  UpdateEntryRequest,
  UpdateSettingsRequest,
} from '@mental-load/contracts';
import { AssistantService } from './domains/assistant/assistant-service';
import { DomainEventBus } from './events/domain-event-bus';
import { EntryService } from './domains/entries/entry-service';
import { MailService } from './mail/mail-service';
import { createRepositoryBundle } from './repositories/repository-factory';
import { SettingsService } from './settings/settings-service';
import { SyncService } from './sync/sync-service';

export async function buildApp() {
  const app = Fastify({ logger: false });
  const eventBus = new DomainEventBus();
  const infrastructure = await createRepositoryBundle();
  const { memberRepository, calendarRepository, entryRepository, reminderScheduler, persistence, close } = infrastructure;
  const entryService = new EntryService(entryRepository, eventBus, reminderScheduler);
  const settingsService = new SettingsService();
  const mailService = new MailService();
  const syncService = new SyncService(settingsService, entryService);
  const assistantService = new AssistantService(
    () => memberRepository.list(),
    () => calendarRepository.list(),
    (input) => entryService.createEntry(input),
  );
  const sockets = new Set<{ send: (message: string) => void }>();

  await app.register(cors, { origin: true });
  await app.register(websocket);
  app.addHook('onClose', close);

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
      createdAt: new Date().toISOString(),
    };

    await memberRepository.create(created);
    reply.code(201);
    return created;
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

  return app;
}
