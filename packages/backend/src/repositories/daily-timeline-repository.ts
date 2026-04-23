import type {
  DailyTimelineTemplateTask,
  MemberTimelineSettings,
  TimelineTaskInstance,
  TimelineTaskSource,
  TimelineTaskStatus,
} from '@mental-load/contracts';

export interface TimelineDayState {
  id: string;
  memberId: string;
  date: string;
  timezone: string;
  blockedByTaskId?: string;
  resetAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTimelineTemplateTaskInput {
  memberId: string;
  title: string;
  position: number;
  expectedTime?: string;
  isActive?: boolean;
  appliesToEntryTask?: boolean;
  appliesToEventDerivedTask?: boolean;
}

export type UpdateTimelineTemplateTaskInput = Partial<Omit<CreateTimelineTemplateTaskInput, 'memberId'>>;

export interface CreateTimelineTaskInstanceInput {
  dayId: string;
  memberId: string;
  title: string;
  position: number;
  source: TimelineTaskSource;
  status: TimelineTaskStatus;
  dueAt?: string;
  linkedEntryId?: string;
  templateTaskId?: string;
}

export type UpdateTimelineTaskInstanceInput = Partial<Pick<TimelineTaskInstance, 'title' | 'position' | 'status' | 'dueAt' | 'confirmedAt' | 'linkedEntryId' | 'templateTaskId'>>;

export interface DailyTimelineRepository {
  getMemberSettings(memberId: string): Promise<MemberTimelineSettings | undefined>;
  upsertMemberSettings(memberId: string, patch: Partial<Pick<MemberTimelineSettings, 'enabled' | 'maxTasksPerDay'>>): Promise<MemberTimelineSettings>;

  listTemplateTasks(memberId: string): Promise<DailyTimelineTemplateTask[]>;
  createTemplateTask(input: CreateTimelineTemplateTaskInput): Promise<DailyTimelineTemplateTask>;
  updateTemplateTask(memberId: string, id: string, patch: UpdateTimelineTemplateTaskInput): Promise<DailyTimelineTemplateTask | undefined>;
  deleteTemplateTask(memberId: string, id: string): Promise<boolean>;

  getTimelineDay(memberId: string, date: string): Promise<TimelineDayState | undefined>;
  getTimelineDayById(id: string): Promise<TimelineDayState | undefined>;
  createTimelineDay(memberId: string, date: string, timezone: string): Promise<TimelineDayState>;
  updateTimelineDay(id: string, patch: Partial<Pick<TimelineDayState, 'blockedByTaskId' | 'resetAt'>>): Promise<TimelineDayState | undefined>;

  listTimelineTasks(dayId: string): Promise<TimelineTaskInstance[]>;
  getTimelineTaskById(id: string): Promise<TimelineTaskInstance | undefined>;
  createTimelineTask(input: CreateTimelineTaskInstanceInput): Promise<TimelineTaskInstance>;
  updateTimelineTask(id: string, patch: UpdateTimelineTaskInstanceInput): Promise<TimelineTaskInstance | undefined>;
  deleteTimelineTask(dayId: string, id: string): Promise<boolean>;
}

export class InMemoryDailyTimelineRepository implements DailyTimelineRepository {
  private readonly settings = new Map<string, MemberTimelineSettings>();
  private readonly templates = new Map<string, DailyTimelineTemplateTask[]>();
  private readonly days = new Map<string, TimelineDayState>();
  private readonly tasksByDay = new Map<string, TimelineTaskInstance[]>();

  async getMemberSettings(memberId: string): Promise<MemberTimelineSettings | undefined> {
    return this.settings.get(memberId);
  }

  async upsertMemberSettings(memberId: string, patch: Partial<Pick<MemberTimelineSettings, 'enabled' | 'maxTasksPerDay'>>): Promise<MemberTimelineSettings> {
    const now = new Date().toISOString();
    const current = this.settings.get(memberId);
    const next: MemberTimelineSettings = {
      memberId,
      enabled: patch.enabled ?? current?.enabled ?? false,
      maxTasksPerDay: patch.maxTasksPerDay ?? current?.maxTasksPerDay ?? 10,
      updatedAt: now,
    };
    this.settings.set(memberId, next);
    return next;
  }

  async listTemplateTasks(memberId: string): Promise<DailyTimelineTemplateTask[]> {
    return [...(this.templates.get(memberId) ?? [])].sort((a, b) => a.position - b.position);
  }

  async createTemplateTask(input: CreateTimelineTemplateTaskInput): Promise<DailyTimelineTemplateTask> {
    const now = new Date().toISOString();
    const created: DailyTimelineTemplateTask = {
      id: crypto.randomUUID(),
      memberId: input.memberId,
      title: input.title,
      position: input.position,
      expectedTime: input.expectedTime,
      isActive: input.isActive ?? true,
      appliesToEntryTask: input.appliesToEntryTask ?? true,
      appliesToEventDerivedTask: input.appliesToEventDerivedTask ?? true,
      createdAt: now,
      updatedAt: now,
    };

    const items = this.templates.get(input.memberId) ?? [];
    items.push(created);
    this.templates.set(input.memberId, items);
    return created;
  }

  async updateTemplateTask(memberId: string, id: string, patch: UpdateTimelineTemplateTaskInput): Promise<DailyTimelineTemplateTask | undefined> {
    const items = this.templates.get(memberId) ?? [];
    const current = items.find((item) => item.id === id);
    if (!current) {
      return undefined;
    }

    Object.assign(current, patch, { updatedAt: new Date().toISOString() });
    return current;
  }

  async deleteTemplateTask(memberId: string, id: string): Promise<boolean> {
    const items = this.templates.get(memberId) ?? [];
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) {
      return false;
    }

    this.templates.set(memberId, next);
    return true;
  }

  async getTimelineDay(memberId: string, date: string): Promise<TimelineDayState | undefined> {
    return this.days.get(`${memberId}:${date}`);
  }

  async getTimelineDayById(id: string): Promise<TimelineDayState | undefined> {
    return [...this.days.values()].find((item) => item.id === id);
  }

  async createTimelineDay(memberId: string, date: string, timezone: string): Promise<TimelineDayState> {
    const now = new Date().toISOString();
    const created: TimelineDayState = {
      id: crypto.randomUUID(),
      memberId,
      date,
      timezone,
      createdAt: now,
      updatedAt: now,
    };

    this.days.set(`${memberId}:${date}`, created);
    this.tasksByDay.set(created.id, []);
    return created;
  }

  async updateTimelineDay(id: string, patch: Partial<Pick<TimelineDayState, 'blockedByTaskId' | 'resetAt'>>): Promise<TimelineDayState | undefined> {
    const current = [...this.days.values()].find((item) => item.id === id);
    if (!current) {
      return undefined;
    }

    Object.assign(current, patch, { updatedAt: new Date().toISOString() });
    return current;
  }

  async listTimelineTasks(dayId: string): Promise<TimelineTaskInstance[]> {
    return [...(this.tasksByDay.get(dayId) ?? [])].sort((a, b) => a.position - b.position);
  }

  async getTimelineTaskById(id: string): Promise<TimelineTaskInstance | undefined> {
    return [...this.tasksByDay.values()].flat().find((item) => item.id === id);
  }

  async createTimelineTask(input: CreateTimelineTaskInstanceInput): Promise<TimelineTaskInstance> {
    const now = new Date().toISOString();
    const created: TimelineTaskInstance = {
      id: crypto.randomUUID(),
      dayId: input.dayId,
      memberId: input.memberId,
      title: input.title,
      position: input.position,
      source: input.source,
      status: input.status,
      dueAt: input.dueAt,
      linkedEntryId: input.linkedEntryId,
      templateTaskId: input.templateTaskId,
      createdAt: now,
      updatedAt: now,
    };

    const items = this.tasksByDay.get(input.dayId) ?? [];
    items.push(created);
    this.tasksByDay.set(input.dayId, items);
    return created;
  }

  async updateTimelineTask(id: string, patch: UpdateTimelineTaskInstanceInput): Promise<TimelineTaskInstance | undefined> {
    const current = [...this.tasksByDay.values()].flat().find((item) => item.id === id);
    if (!current) {
      return undefined;
    }

    Object.assign(current, patch, { updatedAt: new Date().toISOString() });
    return current;
  }

  async deleteTimelineTask(dayId: string, id: string): Promise<boolean> {
    const items = this.tasksByDay.get(dayId) ?? [];
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) {
      return false;
    }

    this.tasksByDay.set(dayId, next);
    return true;
  }
}
