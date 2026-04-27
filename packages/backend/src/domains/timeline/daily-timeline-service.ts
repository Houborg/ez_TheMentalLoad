import type {
  DailyTimelineTemplateTask,
  Entry,
  EntryStatus,
  MemberTimelineSettings,
  TimelineTaskInstance,
  TodayMemberTimeline,
} from '@mental-load/contracts';
import type {
  CreateTimelineTemplateTaskInput,
  DailyTimelineRepository,
  UpdateTimelineTemplateTaskInput,
} from '../../repositories/daily-timeline-repository';

interface TimelineEntryProvider {
  listOccurrences(from: string, to: string): Promise<Entry[]>;
  findEntryById(id: string): Promise<Entry | undefined>;
  createTaskEntry(input: {
    title: string;
    ownerMemberId: string;
    startTime: string;
    endTime: string;
    timezone: string;
    recurrenceRule?: string;
  }): Promise<Entry>;
  updateEntry(id: string, patch: Partial<Entry>): Promise<Entry | undefined>;
  deleteEntry(id: string): Promise<boolean>;
}

export class DailyTimelineService {
  constructor(
    private readonly dailyTimelineRepository: DailyTimelineRepository,
    private readonly timelineEntryProvider?: TimelineEntryProvider,
  ) {}

  async getMemberSettings(memberId: string): Promise<MemberTimelineSettings> {
    const settings = await this.dailyTimelineRepository.getMemberSettings(memberId);
    if (settings) {
      return settings;
    }

    return {
      memberId,
      enabled: false,
      maxTasksPerDay: 10,
      updatedAt: new Date().toISOString(),
    };
  }

  async updateMemberSettings(memberId: string, patch: Partial<Pick<MemberTimelineSettings, 'enabled' | 'maxTasksPerDay'>>): Promise<MemberTimelineSettings> {
    return this.dailyTimelineRepository.upsertMemberSettings(memberId, patch);
  }

  async listTemplates(memberId: string): Promise<DailyTimelineTemplateTask[]> {
    return this.dailyTimelineRepository.listTemplateTasks(memberId);
  }

  async createTemplate(input: CreateTimelineTemplateTaskInput): Promise<DailyTimelineTemplateTask> {
    return this.dailyTimelineRepository.createTemplateTask(input);
  }

  async updateTemplate(memberId: string, id: string, patch: UpdateTimelineTemplateTaskInput): Promise<DailyTimelineTemplateTask | undefined> {
    return this.dailyTimelineRepository.updateTemplateTask(memberId, id, patch);
  }

  async deleteTemplate(memberId: string, id: string): Promise<boolean> {
    return this.dailyTimelineRepository.deleteTemplateTask(memberId, id);
  }

  async deleteTask(memberId: string, taskId: string): Promise<boolean> {
    if (!this.timelineEntryProvider) {
      return false;
    }

    const ref = parseTaskId(taskId);
    if (!ref) {
      return false;
    }

    if (ref.kind === 'entry') {
      const entry = await this.timelineEntryProvider.findEntryById(ref.entryId);
      if (!entry || !belongsToMember(entry, memberId)) {
        return false;
      }
      return this.timelineEntryProvider.deleteEntry(ref.entryId);
    }

    const entry = await this.timelineEntryProvider.findEntryById(ref.entryId);
    if (!entry || !belongsToMember(entry, memberId)) {
      return false;
    }

    const checklist = entry.checklist.filter((item) => item.id !== ref.checklistItemId);
    if (checklist.length === entry.checklist.length) {
      return false;
    }

    const updated = await this.timelineEntryProvider.updateEntry(entry.id, { checklist });
    return Boolean(updated);
  }

  async getTodayTimeline(memberId: string, date: string, timezone: string): Promise<TodayMemberTimeline> {
    const settings = await this.getMemberSettings(memberId);
    if (!settings.enabled) {
      return {
        memberId,
        date,
        timezone,
        blockedByTaskId: undefined,
        tasks: [],
      };
    }

    const tasks = await this.buildTimelineTasksFromEntries(memberId, date, settings.maxTasksPerDay, new Date());
    const blockedByTaskId = tasks.find((task) => task.status === 'waiting_confirmation')?.id;

    return {
      memberId,
      date,
      timezone,
      blockedByTaskId,
      tasks,
    };
  }

  async confirmTaskCompletion(taskId: string, completedByMemberId?: string): Promise<TimelineTaskInstance | undefined> {
    if (!this.timelineEntryProvider) {
      return undefined;
    }

    const ref = parseTaskId(taskId);
    if (!ref) {
      return undefined;
    }

    if (ref.kind === 'entry') {
      const entry = await this.timelineEntryProvider.findEntryById(ref.entryId);
      if (!entry) {
        return undefined;
      }
      if (completedByMemberId && !belongsToMember(entry, completedByMemberId)) {
        return undefined;
      }
      if (entry.status !== 'completed') {
        await this.timelineEntryProvider.updateEntry(entry.id, { status: 'completed' as EntryStatus });
      }

      const updated = await this.timelineEntryProvider.findEntryById(entry.id);
      if (!updated) {
        return undefined;
      }

      return mapEntryTaskToTimelineTask(updated, 1, new Date());
    }

    const entry = await this.timelineEntryProvider.findEntryById(ref.entryId);
    if (!entry) {
      return undefined;
    }
    if (completedByMemberId && !belongsToMember(entry, completedByMemberId)) {
      return undefined;
    }

    const current = entry.checklist.find((item) => item.id === ref.checklistItemId);
    if (!current) {
      return undefined;
    }

    const checklist = entry.checklist.map((item) => (
      item.id === ref.checklistItemId ? { ...item, isCompleted: true } : item
    ));

    await this.timelineEntryProvider.updateEntry(entry.id, { checklist });
    const updated = await this.timelineEntryProvider.findEntryById(entry.id);
    if (!updated) {
      return undefined;
    }

    const completedItem = updated.checklist.find((item) => item.id === ref.checklistItemId);
    if (!completedItem) {
      return undefined;
    }

    const dueAt = deriveDueAt(updated, new Date());
    const normalizedStatus = completedItem.isCompleted ? 'completed' : normalizePendingStatus(dueAt, new Date());
    return {
      id: taskId,
      dayId: `${updated.ownerMemberId}:${(dueAt ?? new Date().toISOString()).slice(0, 10)}`,
      memberId: updated.ownerMemberId,
      title: completedItem.text,
      position: 1,
      source: 'event_derived_task',
      status: normalizedStatus,
      dueAt,
      confirmedAt: completedItem.isCompleted ? new Date().toISOString() : undefined,
      linkedEntryId: `${updated.id}#checklist:${completedItem.id}`,
      isMilestone: false,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };

  }

  async addOneOffTask(input: { memberId: string; date: string; timezone: string; title: string; dueAt?: string }): Promise<TimelineTaskInstance> {
    if (!this.timelineEntryProvider) {
      throw new Error('Timeline task source is unavailable');
    }

    const startTime = input.dueAt ?? randomFreeTimeForDate(input.date, input.memberId, input.title);
    const endTime = new Date(new Date(startTime).getTime() + 30 * 60 * 1000).toISOString();
    const created = await this.timelineEntryProvider.createTaskEntry({
      title: input.title,
      ownerMemberId: input.memberId,
      startTime,
      endTime,
      timezone: input.timezone,
    });

    return {
      id: makeEntryTaskId(created.id),
      dayId: `${input.memberId}:${input.date}`,
      memberId: input.memberId,
      title: created.title,
      position: 1,
      source: 'entry_task',
      status: 'pending',
      dueAt: created.startTime,
      linkedEntryId: created.id,
      isMilestone: Boolean(extractTreatFromLocation(created.location)),
      rewardText: extractTreatFromLocation(created.location),
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  private async buildTimelineTasksFromEntries(memberId: string, date: string, maxTasksPerDay: number, now: Date): Promise<TimelineTaskInstance[]> {
    if (!this.timelineEntryProvider) {
      return [];
    }

    const from = `${date}T00:00:00.000Z`;
    const to = `${date}T23:59:59.999Z`;
    const occurrences = await this.timelineEntryProvider.listOccurrences(from, to);
    const timelineTasks: TimelineTaskInstance[] = [];

    for (const occurrence of occurrences) {
      if (occurrence.status === 'cancelled') {
        continue;
      }

      const belongsToMember = occurrence.ownerMemberId === memberId || occurrence.assignedToMemberId === memberId;
      if (!belongsToMember) {
        continue;
      }

      if (occurrence.type === 'task') {
        timelineTasks.push(mapEntryTaskToTimelineTask(occurrence, 0, now));
        continue;
      }

      for (const item of occurrence.checklist) {
        if (item.assignedToMemberId && item.assignedToMemberId !== memberId) {
          continue;
        }

        const text = item.text.trim();
        if (!text) {
          continue;
        }

        timelineTasks.push(mapChecklistTaskToTimelineTask(occurrence, item.id, text, item.isCompleted, now));
      }
    }

    timelineTasks.sort((left, right) => {
      if (left.dueAt && right.dueAt && left.dueAt !== right.dueAt) {
        return left.dueAt.localeCompare(right.dueAt);
      }
      if (left.dueAt && !right.dueAt) {
        return -1;
      }
      if (!left.dueAt && right.dueAt) {
        return 1;
      }

      const leftSeed = pseudoRandomOrderSeed(left.id);
      const rightSeed = pseudoRandomOrderSeed(right.id);
      if (leftSeed !== rightSeed) {
        return leftSeed - rightSeed;
      }
      return left.title.localeCompare(right.title);
    });

    const limited = timelineTasks.slice(0, maxTasksPerDay);
    let waitingAssigned = false;
    return limited.map((task, index) => {
      if (task.status === 'completed') {
        return { ...task, position: index + 1 };
      }

      const canConfirm = canConfirmTaskNow(task, now);
      if (!waitingAssigned && canConfirm) {
        waitingAssigned = true;
        return { ...task, position: index + 1, status: 'waiting_confirmation' };
      }

      return { ...task, position: index + 1, status: 'pending' };
    });
  }
}

export class TimelineTaskConfirmationError extends Error {}

function canConfirmTaskNow(task: TimelineTaskInstance, now: Date): boolean {
  if (!task.dueAt) {
    return true;
  }

  const dueAt = new Date(task.dueAt);
  if (Number.isNaN(dueAt.getTime())) {
    return true;
  }

  return dueAt.getTime() <= now.getTime();
}

function extractTreatFromLocation(location?: string): string | undefined {
  if (!location) {
    return undefined;
  }

  const trimmed = location.trim();
  if (!trimmed.toUpperCase().startsWith('TREAT:')) {
    return undefined;
  }

  const value = trimmed.slice(6).trim();
  return value || undefined;
}

function belongsToMember(entry: Entry, memberId: string): boolean {
  return entry.ownerMemberId === memberId || entry.assignedToMemberId === memberId;
}

function makeEntryTaskId(entryId: string): string {
  return `entry:${entryId}`;
}

function makeChecklistTaskId(entryId: string, checklistItemId: string): string {
  return `check:${entryId}:${checklistItemId}`;
}

function parseTaskId(taskId: string):
  | { kind: 'entry'; entryId: string }
  | { kind: 'checklist'; entryId: string; checklistItemId: string }
  | undefined {
  if (taskId.startsWith('entry:')) {
    const entryId = taskId.slice(6).trim();
    return entryId ? { kind: 'entry', entryId } : undefined;
  }

  if (taskId.startsWith('check:')) {
    const parts = taskId.slice(6).split(':');
    if (parts.length < 2) {
      return undefined;
    }
    const entryId = parts[0]?.trim();
    const checklistItemId = parts.slice(1).join(':').trim();
    if (!entryId || !checklistItemId) {
      return undefined;
    }
    return { kind: 'checklist', entryId, checklistItemId };
  }

  return undefined;
}

function deriveDueAt(entry: Entry, now: Date): string | undefined {
  if (entry.allDay) {
    return undefined;
  }

  const parsed = new Date(entry.startTime);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
}

function normalizePendingStatus(dueAt: string | undefined, now: Date): 'pending' | 'waiting_confirmation' {
  if (!dueAt) {
    return 'waiting_confirmation';
  }

  const dueDate = new Date(dueAt);
  if (Number.isNaN(dueDate.getTime())) {
    return 'waiting_confirmation';
  }

  return dueDate.getTime() <= now.getTime() ? 'waiting_confirmation' : 'pending';
}

function mapEntryTaskToTimelineTask(entry: Entry, position: number, now: Date): TimelineTaskInstance {
  const dueAt = deriveDueAt(entry, now);
  const rewardText = extractTreatFromLocation(entry.location);
  const status = entry.status === 'completed' ? 'completed' : normalizePendingStatus(dueAt, now);

  return {
    id: makeEntryTaskId(entry.id),
    dayId: `${entry.ownerMemberId}:${(dueAt ?? now.toISOString()).slice(0, 10)}`,
    memberId: entry.ownerMemberId,
    title: entry.title,
    position,
    source: 'entry_task',
    status,
    dueAt,
    confirmedAt: entry.status === 'completed' ? entry.updatedAt : undefined,
    linkedEntryId: entry.id,
    isMilestone: Boolean(rewardText),
    rewardText,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function mapChecklistTaskToTimelineTask(entry: Entry, checklistItemId: string, text: string, isCompleted: boolean, now: Date): TimelineTaskInstance {
  const dueAt = deriveDueAt(entry, now);
  const status = isCompleted ? 'completed' : normalizePendingStatus(dueAt, now);

  return {
    id: makeChecklistTaskId(entry.id, checklistItemId),
    dayId: `${entry.ownerMemberId}:${(dueAt ?? now.toISOString()).slice(0, 10)}`,
    memberId: entry.ownerMemberId,
    title: text,
    position: 0,
    source: 'event_derived_task',
    status,
    dueAt,
    confirmedAt: isCompleted ? entry.updatedAt : undefined,
    linkedEntryId: `${entry.id}#checklist:${checklistItemId}`,
    isMilestone: false,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function pseudoRandomOrderSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function randomFreeTimeForDate(date: string, memberId: string, title: string): string {
  const seed = pseudoRandomOrderSeed(`${date}:${memberId}:${title}`);
  const minutes = seed % (24 * 60);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}
