import type {
  DailyTimelineTemplateTask,
  MemberTimelineSettings,
  TimelineTaskInstance,
  TodayMemberTimeline,
} from '@mental-load/contracts';
import type {
  CreateTimelineTemplateTaskInput,
  DailyTimelineRepository,
  UpdateTimelineTemplateTaskInput,
} from '../../repositories/daily-timeline-repository';

export class DailyTimelineService {
  constructor(private readonly dailyTimelineRepository: DailyTimelineRepository) {}

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

  async getTodayTimeline(memberId: string, date: string, timezone: string): Promise<TodayMemberTimeline> {
    const day = (await this.dailyTimelineRepository.getTimelineDay(memberId, date))
      ?? (await this.dailyTimelineRepository.createTimelineDay(memberId, date, timezone));
    let tasks = await this.dailyTimelineRepository.listTimelineTasks(day.id);

    const settings = await this.getMemberSettings(memberId);
    if (settings.enabled) {
      const templates = await this.dailyTimelineRepository.listTemplateTasks(memberId);
      const activeTemplates = templates
        .filter((template) => template.isActive)
        .sort((left, right) => left.position - right.position)
        .slice(0, settings.maxTasksPerDay);

      const activeTemplateIds = new Set(activeTemplates.map((t) => t.id));

      // Remove template-sourced tasks whose template was deactivated or deleted.
      const staleTemplateTasks = tasks.filter(
        (task) => task.source === 'template' &&
          task.templateTaskId &&
          !activeTemplateIds.has(task.templateTaskId),
      );
      for (const stale of staleTemplateTasks) {
        await this.dailyTimelineRepository.deleteTimelineTask(day.id, stale.id);
      }

      tasks = await this.dailyTimelineRepository.listTimelineTasks(day.id);

      // Add tasks for active templates that don't have a task instance yet.
      const existingTemplateTaskIds = new Set(
        tasks.filter((t) => t.templateTaskId).map((t) => t.templateTaskId as string),
      );
      const templatesNeedingTasks = activeTemplates.filter((t) => !existingTemplateTaskIds.has(t.id));

      for (const template of templatesNeedingTasks) {
        // Compute position: after all non-stale existing tasks.
        const currentTasks = await this.dailyTimelineRepository.listTimelineTasks(day.id);
        const nextPosition = currentTasks.length > 0 ? Math.max(...currentTasks.map((t) => t.position)) + 1 : 1;
        const dueAt = template.expectedTime ? buildDueAtIso(date, template.expectedTime) : undefined;
        await this.dailyTimelineRepository.createTimelineTask({
          dayId: day.id,
          memberId,
          title: template.title,
          position: nextPosition,
          source: 'template',
          status: 'pending',
          dueAt,
          templateTaskId: template.id,
          isMilestone: template.isMilestone,
          rewardText: template.rewardText,
        });
      }

      // Update generated template tasks whose template metadata changed.
      for (const task of tasks) {
        if (task.source !== 'template' || !task.templateTaskId) {
          continue;
        }
        const template = activeTemplates.find((t) => t.id === task.templateTaskId);
        if (!template) {
          continue;
        }
        const newDueAt = template.expectedTime ? buildDueAtIso(date, template.expectedTime) : undefined;
        if (
          task.title !== template.title
          || task.dueAt !== newDueAt
          || task.isMilestone !== template.isMilestone
          || task.rewardText !== template.rewardText
        ) {
          await this.dailyTimelineRepository.updateTimelineTask(task.id, {
            title: template.title,
            dueAt: newDueAt,
            isMilestone: template.isMilestone,
            rewardText: template.rewardText,
          });
        }
      }

      tasks = await this.dailyTimelineRepository.listTimelineTasks(day.id);
      tasks = await this.reorderTimelineTasks(tasks, activeTemplates);
    }

    const synchronized = await this.synchronizeTaskStatuses(day.id, tasks);
    const resolvedDay = synchronized.blockedByTaskId !== day.blockedByTaskId
      ? (await this.dailyTimelineRepository.getTimelineDayById(day.id)) ?? day
      : day;

    return {
      memberId,
      date,
      timezone: resolvedDay.timezone,
      blockedByTaskId: synchronized.blockedByTaskId,
      tasks: synchronized.tasks,
    };
  }

  async confirmTaskCompletion(taskId: string, completedByMemberId?: string): Promise<TimelineTaskInstance | undefined> {
    const task = await this.dailyTimelineRepository.getTimelineTaskById(taskId);
    if (!task) {
      return undefined;
    }

    if (task.status === 'completed') {
      return task;
    }

    const day = await this.dailyTimelineRepository.getTimelineDayById(task.dayId);
    if (!day) {
      return undefined;
    }

    const currentTasks = await this.dailyTimelineRepository.listTimelineTasks(day.id);
    const synchronized = await this.synchronizeTaskStatuses(day.id, currentTasks);
    const synchronizedTask = synchronized.tasks.find((candidate) => candidate.id === taskId);
    if (!synchronizedTask) {
      return undefined;
    }

    const nextIncompleteTask = synchronized.tasks.find((candidate) => candidate.status !== 'completed' && candidate.status !== 'skipped');
    if (!nextIncompleteTask || nextIncompleteTask.id !== taskId) {
      throw new TimelineTaskConfirmationError('Only the current due task can be completed.');
    }

    if (synchronizedTask.status !== 'waiting_confirmation') {
      throw new TimelineTaskConfirmationError('This task cannot be completed before its scheduled time.');
    }

    const updated = await this.dailyTimelineRepository.updateTimelineTask(taskId, {
      status: 'completed',
      confirmedAt: new Date().toISOString(),
    });

    if (!updated) {
      return undefined;
    }

    if (completedByMemberId) {
      // Placeholder for Phase 5 notification fan-out metadata usage.
      void completedByMemberId;
    }

    return updated;
  }

  async addOneOffTask(input: { memberId: string; date: string; timezone: string; title: string; dueAt?: string }): Promise<TimelineTaskInstance> {
    const day = (await this.dailyTimelineRepository.getTimelineDay(input.memberId, input.date))
      ?? (await this.dailyTimelineRepository.createTimelineDay(input.memberId, input.date, input.timezone));
    const existing = await this.dailyTimelineRepository.listTimelineTasks(day.id);
    const nextPosition = existing.length > 0 ? Math.max(...existing.map((item) => item.position)) + 1 : 1;

    return this.dailyTimelineRepository.createTimelineTask({
      dayId: day.id,
      memberId: input.memberId,
      title: input.title,
      position: nextPosition,
      source: 'one_off',
      status: 'pending',
      dueAt: input.dueAt,
    });
  }

  private async reorderTimelineTasks(
    tasks: TimelineTaskInstance[],
    activeTemplates: DailyTimelineTemplateTask[],
  ): Promise<TimelineTaskInstance[]> {
    const templatePositionById = new Map(activeTemplates.map((template) => [template.id, template.position]));
    const orderedTasks = [...tasks].sort((left, right) => {
      const leftTemplatePosition = left.templateTaskId ? templatePositionById.get(left.templateTaskId) : undefined;
      const rightTemplatePosition = right.templateTaskId ? templatePositionById.get(right.templateTaskId) : undefined;
      const leftGroup = leftTemplatePosition === undefined ? 1 : 0;
      const rightGroup = rightTemplatePosition === undefined ? 1 : 0;

      if (leftGroup !== rightGroup) {
        return leftGroup - rightGroup;
      }

      if (leftTemplatePosition !== undefined && rightTemplatePosition !== undefined && leftTemplatePosition !== rightTemplatePosition) {
        return leftTemplatePosition - rightTemplatePosition;
      }

      if (left.position !== right.position) {
        return left.position - right.position;
      }

      return left.createdAt.localeCompare(right.createdAt);
    });

    let didChange = false;
    for (const [index, task] of orderedTasks.entries()) {
      const nextPosition = index + 1;
      if (task.position === nextPosition) {
        continue;
      }

      didChange = true;
      await this.dailyTimelineRepository.updateTimelineTask(task.id, { position: nextPosition });
    }

    if (!didChange) {
      return tasks;
    }

    return this.dailyTimelineRepository.listTimelineTasks(tasks[0]?.dayId ?? '');
  }

  private async synchronizeTaskStatuses(
    dayId: string,
    tasks: TimelineTaskInstance[],
  ): Promise<{ tasks: TimelineTaskInstance[]; blockedByTaskId?: string }> {
    if (tasks.length === 0) {
      await this.dailyTimelineRepository.updateTimelineDay(dayId, { blockedByTaskId: undefined });
      return { tasks, blockedByTaskId: undefined };
    }

    const nextIncompleteTask = tasks.find((task) => task.status !== 'completed' && task.status !== 'skipped');
    const blockedByTaskId = nextIncompleteTask && canConfirmTaskNow(nextIncompleteTask, new Date())
      ? nextIncompleteTask.id
      : undefined;

    let didChange = false;
    for (const task of tasks) {
      if (task.status === 'completed' || task.status === 'skipped') {
        continue;
      }

      const nextStatus = task.id === blockedByTaskId ? 'waiting_confirmation' : 'pending';
      if (task.status === nextStatus) {
        continue;
      }

      didChange = true;
      await this.dailyTimelineRepository.updateTimelineTask(task.id, { status: nextStatus });
    }

    await this.dailyTimelineRepository.updateTimelineDay(dayId, { blockedByTaskId });

    if (!didChange) {
      return { tasks, blockedByTaskId };
    }

    return {
      tasks: await this.dailyTimelineRepository.listTimelineTasks(dayId),
      blockedByTaskId,
    };
  }
}

export class TimelineTaskConfirmationError extends Error {}

function buildDueAtIso(date: string, expectedTime: string): string | undefined {
  const match = expectedTime.trim().match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return undefined;
  }

  return `${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000Z`;
}

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
