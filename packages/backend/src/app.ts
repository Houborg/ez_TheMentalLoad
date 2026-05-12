import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { v4 as uuid } from 'uuid';
import type {
  AssistantStatusResponse,
  AssistantConfirmRequest,
  AssistantFunRequest,
  AssistantParseRequest,
  ConfirmTimelineTaskCompletionRequest,
  CreateEntryRequest,
  CreateMemberRequest,
  CreateMemberTimelineTemplateRequest,
  DeleteFoodPlanItemRequest,
  Entry,
  FoodPlanDay,
  ListFoodPlanResponse,
  UpdateMemberTimelineSettingsRequest,
  UpdateMemberTimelineTemplateRequest,
  UpsertOneOffTimelineTaskRequest,
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
import { createRepositoryBundle, type RepositoryBundle } from './repositories/repository-factory';
import type { MemberRepository } from './repositories/member-repository';
import type { CalendarRepository } from './repositories/calendar-repository';
import type { EntryRepository } from './repositories/entry-repository';
import type { FoodPlanRepository } from './repositories/food-plan-repository';
import { DailyTimelineService, TimelineTaskConfirmationError } from './domains/timeline/daily-timeline-service';
import { SettingsService } from './settings/settings-service';
import { SyncService } from './sync/sync-service';
import { registerAuthRoutes } from './auth/auth-routes';
import { verifyToken } from './auth/auth-service';

const DEFAULT_FAMILY_ID = '00000000-0000-4000-8000-000000000001';
const MEMBER_COLORS = ['#6366f1', '#f59e0b', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4', '#84cc16'];

function makeScopedBundle(infra: RepositoryBundle, familyId: string) {
  const memberRepository: MemberRepository = {
    list: () => infra.memberRepository.list(familyId),
    findById: (id) => infra.memberRepository.findById(id, familyId),
    create: (m) => infra.memberRepository.create(m, familyId),
    update: (id, p) => infra.memberRepository.update(id, p, familyId),
    delete: (id) => infra.memberRepository.delete(id, familyId),
  };
  const calendarRepository: CalendarRepository = {
    list: () => infra.calendarRepository.list(familyId),
    findById: (id) => infra.calendarRepository.findById(id, familyId),
    create: (c) => infra.calendarRepository.create(c, familyId),
    delete: (id) => infra.calendarRepository.delete(id, familyId),
  };
  const entryRepository: EntryRepository = {
    list: () => infra.entryRepository.list(familyId),
    findById: (id) => infra.entryRepository.findById(id, familyId),
    findByOwnerAndAssignedMember: (o, a) => infra.entryRepository.findByOwnerAndAssignedMember(o, a, familyId),
    create: (e) => infra.entryRepository.create(e, familyId),
    update: (id, p) => infra.entryRepository.update(id, p, familyId),
    delete: (id) => infra.entryRepository.delete(id, familyId),
  };
  const foodPlanRepository: FoodPlanRepository = {
    listByWeek: (w) => infra.foodPlanRepository.listByWeek(w, familyId),
    upsert: (i) => infra.foodPlanRepository.upsert(i, familyId),
    deleteByWeekAndDay: (w, d) => infra.foodPlanRepository.deleteByWeekAndDay(w, d, familyId),
  };
  return { memberRepository, calendarRepository, entryRepository, foodPlanRepository };
}

export async function buildApp() {
  const app = Fastify({ logger: false });
  const eventBus = new DomainEventBus();
  const infrastructure = await createRepositoryBundle();
  const { dailyTimelineRepository, reminderScheduler, persistence, close } = infrastructure;

  // On startup (in-memory / new postgres deployment): ensure every member in the default family
  // has a personal calendar and a shared Family calendar exists.
  const seedBundle = makeScopedBundle(infrastructure, DEFAULT_FAMILY_ID);
  const allMembers = await seedBundle.memberRepository.list();
  const existingCalendars = await seedBundle.calendarRepository.list();
  const calendarOwners = new Set(existingCalendars.map((c) => c.ownerMemberId).filter(Boolean));

  for (const member of allMembers) {
    if (!calendarOwners.has(member.id)) {
      const color = MEMBER_COLORS[existingCalendars.length % MEMBER_COLORS.length];
      await seedBundle.calendarRepository.create({
        id: uuid(),
        name: member.name,
        color,
        ownerMemberId: member.id,
        createdAt: new Date().toISOString(),
      });
    }
  }

  const hasSharedCalendar = existingCalendars.some((c) => !c.ownerMemberId);
  if (!hasSharedCalendar) {
    await seedBundle.calendarRepository.create({
      id: uuid(),
      name: 'Family',
      color: '#10b981',
      ownerMemberId: '',
      createdAt: new Date().toISOString(),
    });
  }

  const mailService = new MailService();
  const inboxBridgeService = new InboxBridgeService();
  const sockets = new Set<{ send: (message: string) => void }>();
  let appClosed = false;

  await app.register(cors, { origin: true });
  await app.register(cookie);
  await app.register(websocket);

  // Auth routes — no JWT required on these paths
  if (infrastructure.pool) {
    await registerAuthRoutes(app, infrastructure.pool);
  }

  // JWT preHandler — verifies session and attaches scoped services to request
  const PUBLIC_PATHS = ['/api/auth/', '/api/v1/health', '/ws'];
  app.addHook('preHandler', async (request, reply) => {
    if (PUBLIC_PATHS.some(p => request.url.startsWith(p))) return;
    const token = request.cookies['ml_session'];
    if (!token) {
      reply.code(401);
      return reply.send({ message: 'Not authenticated' });
    }
    try {
      const payload = verifyToken(token);

      // Check email verification
      if (infrastructure.pool) {
        const result = await infrastructure.pool.query<{ email_verified: boolean }>(
          'select email_verified from users where id = $1',
          [payload.userId],
        );
        if (!result.rows[0]?.email_verified) {
          reply.code(403);
          return reply.send({ code: 'EMAIL_VERIFICATION_REQUIRED' });
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (request as any).svc = getRequestServices(payload.familyId);
    } catch (err) {
      if (reply.statusCode === 403) throw err;
      reply.code(401);
      return reply.send({ message: 'Invalid or expired session' });
    }
  });

  app.addHook('onClose', async () => {
    appClosed = true;
    await close();
  });

  function getRequestServices(familyId: string) {
    const repo = makeScopedBundle(infrastructure, familyId);
    const settingsService = infrastructure.pool
      ? new SettingsService(infrastructure.pool, familyId)
      : (() => { throw new Error('SettingsService requires postgres'); })();
    const entryService = new EntryService(repo.entryRepository, eventBus, reminderScheduler);
    const dailyTimelineService = new DailyTimelineService(dailyTimelineRepository, {
      listOccurrences: (from, to) => entryService.listOccurrences(from, to),
      findEntryById: (id) => repo.entryRepository.findById(id),
      createTaskEntry: async (input) => {
        const calendars = await repo.calendarRepository.list();
        const ownerCalendar = calendars.find((calendar) => calendar.ownerMemberId === input.ownerMemberId) ?? calendars[0];
        if (!ownerCalendar) throw new Error('No calendar available for task creation');
        return entryService.createEntry({
          title: input.title, type: 'task', ownerMemberId: input.ownerMemberId,
          calendarId: ownerCalendar.id, startTime: input.startTime, endTime: input.endTime,
          timezone: input.timezone, allDay: false, reminders: [], checklist: [],
          recurrenceRule: input.recurrenceRule,
        });
      },
      updateEntry: (id, patch) => repo.entryRepository.update(id, patch),
      deleteEntry: (id) => repo.entryRepository.delete(id),
    });
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
  }

  app.get('/api/v1/health', async () => ({
    status: 'ok' as const,
    service: 'mental-load-backend',
    persistence,
    version: process.env.APP_VERSION ?? '0.0.0-dev',
    commit: process.env.APP_COMMIT ?? 'local',
    deployedAt: process.env.APP_DEPLOY_TIME ?? null,
    now: new Date().toISOString(),
  }));

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
    const result = await svc(request).syncService.connect(request.body);
    reply.code(result.ok ? 200 : 400);
    return result;
  });

  app.post<{ Body: SyncRunRequest }>('/api/v1/sync/run', async (request, reply) => {
    const result = await svc(request).syncService.run(request.body);
    reply.code(result.ok ? 200 : 400);
    return result;
  });

  app.post('/api/v1/deploy/update', async (request, reply) => {
    const webhookUrl = process.env.UPDATE_WEBHOOK_URL;
    const webhookSecret = process.env.UPDATE_WEBHOOK_SECRET;

    // Production mode: call the host-side webhook that has Docker access.
    if (webhookUrl) {
      try {
        const webhookResponse = await fetch(`${webhookUrl}/update`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${webhookSecret ?? ''}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await webhookResponse.json()) as { ok?: boolean; message?: string; error?: string };
        if (!webhookResponse.ok) {
          reply.code(502);
          return { ok: false, message: body.message ?? body.error ?? `Webhook error ${webhookResponse.status}` };
        }
        reply.code(200);
        return { ok: true, message: body.message ?? 'Deploy triggered via webhook.' };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('Update webhook unreachable', { error: msg });
        reply.code(502);
        return { ok: false, message: `Webhook unreachable: ${msg}. Is update-webhook.py running on the host?` };
      }
    }

    // Dev / local mode: git pull only. tsx watch hot-reloads automatically.
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      const { stdout } = await execAsync('git pull', { cwd: process.cwd(), timeout: 30_000 });
      const summary = stdout.trim() || 'Already up to date.';
      console.log('Dev mode git pull:', summary);
      reply.code(200);
      return { ok: true, message: `Dev mode – git pull: ${summary}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'git pull failed';
      reply.code(500);
      return { ok: false, message: msg };
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function svc(request: any) { return request.svc as ReturnType<typeof getRequestServices>; }

  app.get('/api/v1/members', async (request) => svc(request).memberRepository.list());
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
      avatar: typeof request.body.avatar === 'string' ? request.body.avatar.trim() || undefined : undefined,
      createdAt: new Date().toISOString(),
    };

    await svc(request).memberRepository.create(created);

    // Auto-create a personal calendar for the new member.
    const allCalendars = await svc(request).calendarRepository.list();
    const memberColor = MEMBER_COLORS[allCalendars.length % MEMBER_COLORS.length];
    await svc(request).calendarRepository.create({
      id: uuid(),
      name: created.name,
      color: memberColor,
      ownerMemberId: created.id,
      createdAt: new Date().toISOString(),
    });

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

    if (typeof request.body.avatar === 'string') {
      patch.avatar = request.body.avatar.trim() || undefined;
    }

    const updated = await svc(request).memberRepository.update(request.params.id, patch);
    if (!updated) {
      reply.code(404);
      return { message: 'Member not found' };
    }

    return updated;
  });

  app.delete<{ Params: { id: string }; Querystring: { actorMemberId?: string } }>('/api/v1/members/:id', async (request, reply) => {
    const actorMemberId = request.query.actorMemberId?.trim();
    if (actorMemberId && actorMemberId === request.params.id) {
      reply.code(400);
      return { message: 'You cannot delete your own member account' };
    }

    const members = await svc(request).memberRepository.list();
    if (members.length <= 1) {
      reply.code(400);
      return { message: 'At least one member must remain' };
    }

    const deleted = await svc(request).memberRepository.delete(request.params.id);
    if (!deleted) {
      reply.code(404);
      return { message: 'Member not found' };
    }

    reply.code(204);
    return null;
  });

  app.put<{ Params: { memberId: string }; Body: UpdateMemberTimelineSettingsRequest }>('/api/v1/members/:memberId/timeline-settings', async (request, reply) => {
    const maxTasksPerDay = request.body.maxTasksPerDay;
    if (typeof maxTasksPerDay === 'number' && (!Number.isInteger(maxTasksPerDay) || maxTasksPerDay < 1 || maxTasksPerDay > 50)) {
      reply.code(400);
      return { message: 'maxTasksPerDay must be an integer between 1 and 50' };
    }

    return svc(request).dailyTimelineService.updateMemberSettings(request.params.memberId, request.body);
  });

  app.get<{ Params: { memberId: string } }>('/api/v1/members/:memberId/timeline-settings', async (request) => {
    return svc(request).dailyTimelineService.getMemberSettings(request.params.memberId);
  });

  app.get<{ Params: { memberId: string } }>('/api/v1/members/:memberId/timeline-templates', async (request) => {
    const templates = await svc(request).dailyTimelineService.listTemplates(request.params.memberId);
    return {
      memberId: request.params.memberId,
      templates,
    };
  });

  app.post<{ Params: { memberId: string }; Body: CreateMemberTimelineTemplateRequest }>('/api/v1/members/:memberId/timeline-templates', async (request, reply) => {
    if (!request.body.title?.trim()) {
      reply.code(400);
      return { message: 'title is required' };
    }

    if (!Number.isInteger(request.body.position) || request.body.position < 1) {
      reply.code(400);
      return { message: 'position must be a positive integer' };
    }

    const rewardText = typeof request.body.rewardText === 'string' ? request.body.rewardText.trim() || undefined : undefined;

    const created = await svc(request).dailyTimelineService.createTemplate({
      memberId: request.params.memberId,
      title: request.body.title.trim(),
      position: request.body.position,
      expectedTime: request.body.expectedTime,
      isActive: request.body.isActive,
      isMilestone: request.body.isMilestone ?? Boolean(rewardText),
      rewardText,
      appliesToEntryTask: request.body.appliesToEntryTask,
      appliesToEventDerivedTask: request.body.appliesToEventDerivedTask,
    });

    reply.code(201);
    return created;
  });

  app.patch<{ Params: { memberId: string; templateId: string }; Body: UpdateMemberTimelineTemplateRequest }>('/api/v1/members/:memberId/timeline-templates/:templateId', async (request, reply) => {
    if (typeof request.body.position === 'number' && (!Number.isInteger(request.body.position) || request.body.position < 1)) {
      reply.code(400);
      return { message: 'position must be a positive integer' };
    }

    const hasRewardText = Object.prototype.hasOwnProperty.call(request.body, 'rewardText');
    const rewardText = typeof request.body.rewardText === 'string' ? request.body.rewardText.trim() || undefined : undefined;

    const updated = await svc(request).dailyTimelineService.updateTemplate(request.params.memberId, request.params.templateId, {
      ...request.body,
      title: typeof request.body.title === 'string' ? request.body.title.trim() : undefined,
      isMilestone: request.body.isMilestone ?? (rewardText ? true : undefined),
      ...(hasRewardText ? { rewardText } : {}),
    });

    if (!updated) {
      reply.code(404);
      return { message: 'Template task not found' };
    }

    return updated;
  });

  app.delete<{ Params: { memberId: string; templateId: string } }>('/api/v1/members/:memberId/timeline-templates/:templateId', async (request, reply) => {
    const deleted = await svc(request).dailyTimelineService.deleteTemplate(request.params.memberId, request.params.templateId);
    if (!deleted) {
      reply.code(404);
      return { message: 'Template task not found' };
    }

    reply.code(204);
    return null;
  });

  app.get<{ Params: { memberId: string }; Querystring: { date?: string; timezone?: string } }>('/api/v1/members/:memberId/today-timeline', async (request, reply) => {
    const date = normalizeIsoDate(request.query.date) ?? new Date().toISOString().slice(0, 10);
    const timezone = request.query.timezone?.trim() || 'UTC';

    const timeline = await svc(request).dailyTimelineService.getTodayTimeline(request.params.memberId, date, timezone);
    const settings = await svc(request).dailyTimelineService.getMemberSettings(request.params.memberId);
    reply.code(200);
    return { settings, timeline };
  });

  app.post<{ Params: { memberId: string }; Querystring: { date?: string; timezone?: string }; Body: UpsertOneOffTimelineTaskRequest }>('/api/v1/members/:memberId/today-timeline/one-off', async (request, reply) => {
    if (!request.body.title?.trim()) {
      reply.code(400);
      return { message: 'title is required' };
    }

    const date = normalizeIsoDate(request.query.date) ?? new Date().toISOString().slice(0, 10);
    const timezone = request.query.timezone?.trim() || 'UTC';
    const created = await svc(request).dailyTimelineService.addOneOffTask({
      memberId: request.params.memberId,
      date,
      timezone,
      title: request.body.title.trim(),
      dueAt: request.body.dueAt,
    });

    reply.code(201);
    return created;
  });

  app.delete<{ Params: { memberId: string; taskId: string } }>('/api/v1/members/:memberId/today-timeline/tasks/:taskId', async (request, reply) => {
    const deleted = await svc(request).dailyTimelineService.deleteTask(request.params.memberId, request.params.taskId);
    if (!deleted) {
      reply.code(404);
      return { message: 'Timeline task not found' };
    }

    reply.code(204);
    return null;
  });

  app.post<{ Params: { memberId: string }; Body: ConfirmTimelineTaskCompletionRequest }>('/api/v1/members/:memberId/today-timeline/confirm', async (request, reply) => {
    if (!request.body.taskId?.trim()) {
      reply.code(400);
      return { message: 'taskId is required' };
    }

    let confirmed;
    try {
      confirmed = await svc(request).dailyTimelineService.confirmTaskCompletion(request.body.taskId.trim(), request.params.memberId);
    } catch (error) {
      if (error instanceof TimelineTaskConfirmationError) {
        reply.code(400);
        return { message: error.message };
      }
      throw error;
    }
    if (!confirmed) {
      reply.code(404);
      return { message: 'Timeline task not found' };
    }

    eventBus.emit({
      name: 'timeline.step.completed',
      payload: {
        memberId: request.params.memberId,
        date: confirmed.createdAt.slice(0, 10),
        task: confirmed,
        completedByMemberId: request.params.memberId,
      },
      occurredAt: new Date().toISOString(),
    });
    void sendTimelineCompletionEmails({
      memberId: request.params.memberId,
      date: confirmed.createdAt.slice(0, 10),
      task: confirmed,
      completedByMemberId: request.params.memberId,
    }, svc(request).memberRepository, svc(request).settingsService);

    const date = normalizeIsoDate(confirmed.dueAt?.slice(0, 10)) ?? new Date().toISOString().slice(0, 10);
    const timeline = await svc(request).dailyTimelineService.getTodayTimeline(request.params.memberId, date, 'UTC');
    return { ok: true, timeline };
  });

  app.get<{ Querystring: { weekStart?: string } }>('/api/v1/food-plan', async (request, reply): Promise<ListFoodPlanResponse | { message: string }> => {
    const weekStart = normalizeWeekStart(request.query.weekStart);
    if (!weekStart) {
      reply.code(400);
      return { message: 'weekStart must be an ISO date (YYYY-MM-DD)' };
    }

    const items = await svc(request).foodPlanRepository.listByWeek(weekStart);
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
    const item = await svc(request).foodPlanRepository.upsert({
      weekStart,
      day: request.body.day,
      dishName,
      groceryList,
    });

    return item;
  });

  app.delete<{ Body?: DeleteFoodPlanItemRequest; Querystring: { weekStart?: string; day?: string } }>('/api/v1/food-plan', async (request, reply) => {
    const rawWeekStart = request.body?.weekStart ?? request.query.weekStart;
    const rawDay = (request.body?.day ?? request.query.day)?.trim().toLowerCase();
    const weekStart = normalizeWeekStart(rawWeekStart);

    if (!weekStart || !rawDay || !isFoodPlanDay(rawDay)) {
      reply.code(400);
      return { message: 'Invalid weekStart or day' };
    }

    const deleted = await svc(request).foodPlanRepository.deleteByWeekAndDay(weekStart, rawDay);
    if (!deleted) {
      reply.code(404);
      return { message: 'Food plan item not found' };
    }

    reply.code(204);
    return null;
  });

  app.get('/api/v1/calendars', async (request) => svc(request).calendarRepository.list());

  app.delete<{ Params: { id: string } }>('/api/v1/calendars/:id', async (request, reply) => {
    const calendar = await svc(request).calendarRepository.findById(request.params.id);
    if (!calendar) { reply.code(404); return { message: 'Calendar not found' }; }
    await svc(request).calendarRepository.delete(request.params.id);
    reply.code(204);
  });
  app.get<{ Querystring: { ownerMemberId?: string; assignedToMemberId?: string } }>('/api/v1/entries', async (request, reply) => {
    if (request.query.ownerMemberId && request.query.assignedToMemberId) {
      return svc(request).entryService.listMemberTasks(request.query.ownerMemberId, request.query.assignedToMemberId);
    }
    return svc(request).entryService.listEntries();
  });
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/v1/entries/occurrences', async (request, reply) => {
    const from = request.query.from ?? new Date().toISOString();
    const to = request.query.to ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    if (Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime())) {
      reply.code(400);
      return { message: 'Invalid date range' };
    }

    return svc(request).entryService.listOccurrences(from, to);
  });
  app.get('/api/v1/reminders/jobs', async (request) => svc(request).entryService.listReminderJobs());
  app.get('/api/v1/dashboard', async (request) => ({
    members: await svc(request).memberRepository.list(),
    calendars: await svc(request).calendarRepository.list(),
    entries: await svc(request).entryService.listEntries(),
    reminderJobs: await svc(request).entryService.listReminderJobs(),
    persistence,
  }));

  app.post<{ Body: CreateEntryRequest }>('/api/v1/entries', async (request, reply) => {
    const created = await svc(request).entryService.createEntry(request.body);
    try {
      await sendInviteEmailsForEntry(created, svc(request).memberRepository, svc(request).settingsService);
    } catch {
      // Keep entry creation successful even if outbound invite email fails.
    }
    reply.code(201);
    return created;
  });

  app.post<{ Body: AssistantParseRequest }>('/api/v1/assistant/parse', async (request, reply) => {
    const result = await svc(request).assistantService.parseRequest(request.body);
    reply.code(200);
    return result;
  });

  app.post<{ Body: AssistantFunRequest }>('/api/v1/assistant/fun', async (request, reply) => {
    const result = await svc(request).assistantService.funChat(request.body);
    reply.code(200);
    return result;
  });

  app.get('/api/v1/assistant/status', async (request): Promise<AssistantStatusResponse> => svc(request).assistantService.getStatus());

  app.post<{ Body: AssistantConfirmRequest }>('/api/v1/assistant/confirm', async (request, reply) => {
    try {
      const created = await svc(request).assistantService.confirmDraft(request.body);
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : 'Invalid assistant draft' };
    }
  });

  app.post<{ Body: { calendarId: string; ownerMemberId: string; ics: string } }>('/api/v1/entries/import/ics', async (request, reply) => {
    const result = await svc(request).entryService.importFromIcs(request.body);
    reply.code(200);
    return result;
  });

  app.get<{ Params: { id: string } }>('/api/v1/calendars/:id/export.ics', async (request, reply) => {
    const body = await svc(request).entryService.exportCalendarIcs(request.params.id);
    reply.header('Content-Type', 'text/calendar; charset=utf-8');
    return body;
  });

  app.patch<{ Params: { id: string }; Body: UpdateEntryRequest }>('/api/v1/entries/:id', async (request, reply) => {
    const updated = await svc(request).entryService.updateEntry(request.params.id, request.body);
    if (!updated) {
      reply.code(404);
      return { message: 'Entry not found' };
    }
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/v1/entries/:id', async (request, reply) => {
    const deleted = await svc(request).entryService.deleteEntry(request.params.id);
    if (!deleted) {
      reply.code(404);
      return { message: 'Entry not found' };
    }
    reply.code(204);
    return null;
  });

  app.patch<{ Params: { id: string; email: string }; Body: { status: 'accepted' | 'declined' } }>('/api/v1/entries/:id/invitees/:email', async (request, reply) => {
    const entry = await svc(request).entryService.respondToInvitation(request.params.id, request.params.email, request.body.status);
    if (!entry) {
      reply.code(404);
      return { message: 'Entry or invitee not found' };
    }
    return entry;
  });

  app.get<{ Params: { memberId: string } }>('/api/v1/members/:memberId/invitations', async (request, reply) => {
    const invitations = await svc(request).entryService.listInvitationsForMember(request.params.memberId);
    return invitations;
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

  eventBus.on('timeline.step.reached', (event) => {
    broadcast({ type: 'timeline.step.reached', payload: event.payload, occurredAt: event.occurredAt });
  });

  eventBus.on('timeline.step.completed', (event) => {
    broadcast({ type: 'timeline.step.completed', payload: event.payload, occurredAt: event.occurredAt });
    // Email notifications are sent directly from the confirm handler (needs scoped memberRepository)
  });

  function broadcast(message: unknown): void {
    const serialized = JSON.stringify(message);
    for (const socket of sockets) {
      socket.send(serialized);
    }
  }

  async function sendInviteEmailsForEntry(entry: Entry, scopedMemberRepository: MemberRepository, settingsService: SettingsService): Promise<void> {
    if (entry.type !== 'event') {
      return;
    }

    const settings = await settingsService.getSettings();
    const recipients = [...new Set(entry.invitees.map((invitee) => invitee.email.trim().toLowerCase()).filter(Boolean))];

    if (recipients.length === 0) {
      const owner = await scopedMemberRepository.findById(entry.ownerMemberId);
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

  async function sendTimelineCompletionEmails(payload: {
    memberId: string;
    date: string;
    task: { title: string; confirmedAt?: string };
    completedByMemberId?: string;
  }, scopedMemberRepository: MemberRepository, settingsService: SettingsService): Promise<void> {
    const [members, settings] = await Promise.all([
      scopedMemberRepository.list(),
      settingsService.getSettings(),
    ]);
    const completedByMember = members.find((member) => member.id === payload.memberId);
    const parentRecipients = members
      .filter((member) => member.role === 'parent' && typeof member.email === 'string' && member.email.trim().length > 0)
      .map((member) => member.email!.trim().toLowerCase());
    const uniqueRecipients = [...new Set(parentRecipients)];

    if (uniqueRecipients.length === 0) {
      return;
    }

    await Promise.all(uniqueRecipients.map(async (recipient) => {
      await mailService.sendTimelineTaskCompletedNotice({
        to: recipient,
        memberName: completedByMember?.name ?? 'A family member',
        taskTitle: payload.task.title,
        completedAt: payload.task.confirmedAt ?? new Date().toISOString(),
      }, settings.mail);
    }));
  }

  return app;
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

  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }

    return trimmed;
  }

  const isoPrefix = trimmed.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoPrefix) {
    const parsed = new Date(`${isoPrefix[1]}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }

    return isoPrefix[1];
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeIsoDate(value?: string): string | undefined {
  if (!value) {
    return undefined;
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
