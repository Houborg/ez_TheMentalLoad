import type { DailyTimelineTemplateTask, MemberTimelineSettings, TimelineTaskInstance } from '@mental-load/contracts';
import type { Pool } from 'pg';
import type {
  CreateTimelineTaskInstanceInput,
  CreateTimelineTemplateTaskInput,
  DailyTimelineRepository,
  TimelineDayState,
  UpdateTimelineTaskInstanceInput,
  UpdateTimelineTemplateTaskInput,
} from '../daily-timeline-repository';

export class PostgresDailyTimelineRepository implements DailyTimelineRepository {
  constructor(private readonly pool: Pool) {}

  async getMemberSettings(memberId: string): Promise<MemberTimelineSettings | undefined> {
    const result = await this.pool.query(
      'select member_id, enabled, max_tasks_per_day, updated_at from member_timeline_settings where member_id = $1',
      [memberId],
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return {
      memberId: String(row.member_id),
      enabled: Boolean(row.enabled),
      maxTasksPerDay: Number(row.max_tasks_per_day),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }

  async upsertMemberSettings(memberId: string, patch: Partial<Pick<MemberTimelineSettings, 'enabled' | 'maxTasksPerDay'>>): Promise<MemberTimelineSettings> {
    const current = await this.getMemberSettings(memberId);
    const nextEnabled = patch.enabled ?? current?.enabled ?? false;
    const nextMaxTasksPerDay = patch.maxTasksPerDay ?? current?.maxTasksPerDay ?? 10;

    const result = await this.pool.query(
      `insert into member_timeline_settings (member_id, enabled, max_tasks_per_day, updated_at)
       values ($1, $2, $3, now())
       on conflict (member_id)
       do update set enabled = excluded.enabled, max_tasks_per_day = excluded.max_tasks_per_day, updated_at = now()
       returning member_id, enabled, max_tasks_per_day, updated_at`,
      [memberId, nextEnabled, nextMaxTasksPerDay],
    );

    const row = result.rows[0];
    return {
      memberId: String(row.member_id),
      enabled: Boolean(row.enabled),
      maxTasksPerDay: Number(row.max_tasks_per_day),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }

  async listTemplateTasks(memberId: string): Promise<DailyTimelineTemplateTask[]> {
    const result = await this.pool.query(
      `select id, member_id, title, position, expected_time, is_active, is_milestone, reward_text, applies_to_entry_task, applies_to_event_derived_task, created_at, updated_at
       from daily_timeline_templates
       where member_id = $1
       order by position asc, created_at asc`,
      [memberId],
    );

    return result.rows.map((row) => this.mapTemplate(row));
  }

  async createTemplateTask(input: CreateTimelineTemplateTaskInput): Promise<DailyTimelineTemplateTask> {
    const result = await this.pool.query(
      `insert into daily_timeline_templates
         (member_id, title, position, expected_time, is_active, is_milestone, reward_text, applies_to_entry_task, applies_to_event_derived_task, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
       returning id, member_id, title, position, expected_time, is_active, is_milestone, reward_text, applies_to_entry_task, applies_to_event_derived_task, created_at, updated_at`,
      [
        input.memberId,
        input.title,
        input.position,
        input.expectedTime ?? null,
        input.isActive ?? true,
        input.isMilestone ?? false,
        input.rewardText ?? null,
        input.appliesToEntryTask ?? true,
        input.appliesToEventDerivedTask ?? true,
      ],
    );

    return this.mapTemplate(result.rows[0]);
  }

  async updateTemplateTask(memberId: string, id: string, patch: UpdateTimelineTemplateTaskInput): Promise<DailyTimelineTemplateTask | undefined> {
    const currentResult = await this.pool.query(
      `select id, member_id, title, position, expected_time, is_active, is_milestone, reward_text, applies_to_entry_task, applies_to_event_derived_task, created_at, updated_at
       from daily_timeline_templates
       where member_id = $1 and id = $2`,
      [memberId, id],
    );

    const current = currentResult.rows[0];
    if (!current) {
      return undefined;
    }
    const nextRewardText = Object.prototype.hasOwnProperty.call(patch, 'rewardText')
      ? patch.rewardText ?? null
      : (current.reward_text ? String(current.reward_text) : null);

    const result = await this.pool.query(
      `update daily_timeline_templates
       set title = $3,
           position = $4,
           expected_time = $5,
           is_active = $6,
           is_milestone = $7,
           reward_text = $8,
           applies_to_entry_task = $9,
           applies_to_event_derived_task = $10,
           updated_at = now()
       where member_id = $1 and id = $2
       returning id, member_id, title, position, expected_time, is_active, is_milestone, reward_text, applies_to_entry_task, applies_to_event_derived_task, created_at, updated_at`,
      [
        memberId,
        id,
        patch.title ?? String(current.title),
        patch.position ?? Number(current.position),
        patch.expectedTime ?? (current.expected_time ? String(current.expected_time) : null),
        patch.isActive ?? Boolean(current.is_active),
        patch.isMilestone ?? Boolean(current.is_milestone),
        nextRewardText,
        patch.appliesToEntryTask ?? Boolean(current.applies_to_entry_task),
        patch.appliesToEventDerivedTask ?? Boolean(current.applies_to_event_derived_task),
      ],
    );

    return this.mapTemplate(result.rows[0]);
  }

  async deleteTemplateTask(memberId: string, id: string): Promise<boolean> {
    const result = await this.pool.query('delete from daily_timeline_templates where member_id = $1 and id = $2', [memberId, id]);
    return (result.rowCount ?? 0) > 0;
  }

  async getTimelineDay(memberId: string, date: string): Promise<TimelineDayState | undefined> {
    const result = await this.pool.query(
      `select id, member_id, day_date, timezone, blocked_by_task_id, reset_at, created_at, updated_at
       from daily_timeline_days
       where member_id = $1 and day_date = $2`,
      [memberId, date],
    );

    const row = result.rows[0];
    return row ? this.mapDay(row) : undefined;
  }

  async getTimelineDayById(id: string): Promise<TimelineDayState | undefined> {
    const result = await this.pool.query(
      `select id, member_id, day_date, timezone, blocked_by_task_id, reset_at, created_at, updated_at
       from daily_timeline_days
       where id = $1`,
      [id],
    );

    const row = result.rows[0];
    return row ? this.mapDay(row) : undefined;
  }

  async createTimelineDay(memberId: string, date: string, timezone: string): Promise<TimelineDayState> {
    const result = await this.pool.query(
      `insert into daily_timeline_days (member_id, day_date, timezone, created_at, updated_at)
       values ($1, $2, $3, now(), now())
       on conflict (member_id, day_date)
       do update set timezone = excluded.timezone, updated_at = now()
       returning id, member_id, day_date, timezone, blocked_by_task_id, reset_at, created_at, updated_at`,
      [memberId, date, timezone],
    );

    return this.mapDay(result.rows[0]);
  }

  async updateTimelineDay(id: string, patch: Partial<Pick<TimelineDayState, 'blockedByTaskId' | 'resetAt'>>): Promise<TimelineDayState | undefined> {
    const currentResult = await this.pool.query(
      `select id, member_id, day_date, timezone, blocked_by_task_id, reset_at, created_at, updated_at
       from daily_timeline_days
       where id = $1`,
      [id],
    );

    const current = currentResult.rows[0];
    if (!current) {
      return undefined;
    }

    const result = await this.pool.query(
      `update daily_timeline_days
       set blocked_by_task_id = $2,
           reset_at = $3,
           updated_at = now()
       where id = $1
       returning id, member_id, day_date, timezone, blocked_by_task_id, reset_at, created_at, updated_at`,
      [
        id,
        patch.blockedByTaskId ?? (current.blocked_by_task_id ? String(current.blocked_by_task_id) : null),
        patch.resetAt ?? (current.reset_at ? new Date(String(current.reset_at)).toISOString() : null),
      ],
    );

    return this.mapDay(result.rows[0]);
  }

  async listTimelineTasks(dayId: string): Promise<TimelineTaskInstance[]> {
    const result = await this.pool.query(
      `select id, day_id, member_id, title, position, source, status, due_at, confirmed_at, linked_entry_id, template_task_id, is_milestone, reward_text, created_at, updated_at
       from daily_timeline_tasks
       where day_id = $1
       order by position asc, created_at asc`,
      [dayId],
    );

    return result.rows.map((row) => this.mapTask(row));
  }

  async getTimelineTaskById(id: string): Promise<TimelineTaskInstance | undefined> {
    const result = await this.pool.query(
      `select id, day_id, member_id, title, position, source, status, due_at, confirmed_at, linked_entry_id, template_task_id, is_milestone, reward_text, created_at, updated_at
       from daily_timeline_tasks
       where id = $1`,
      [id],
    );

    const row = result.rows[0];
    return row ? this.mapTask(row) : undefined;
  }

  async createTimelineTask(input: CreateTimelineTaskInstanceInput): Promise<TimelineTaskInstance> {
    const result = await this.pool.query(
      `insert into daily_timeline_tasks
         (day_id, member_id, title, position, source, status, due_at, linked_entry_id, template_task_id, is_milestone, reward_text, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
       returning id, day_id, member_id, title, position, source, status, due_at, confirmed_at, linked_entry_id, template_task_id, is_milestone, reward_text, created_at, updated_at`,
      [
        input.dayId,
        input.memberId,
        input.title,
        input.position,
        input.source,
        input.status,
        input.dueAt ?? null,
        input.linkedEntryId ?? null,
        input.templateTaskId ?? null,
        input.isMilestone ?? false,
        input.rewardText ?? null,
      ],
    );

    return this.mapTask(result.rows[0]);
  }

  async updateTimelineTask(id: string, patch: UpdateTimelineTaskInstanceInput): Promise<TimelineTaskInstance | undefined> {
    const currentResult = await this.pool.query(
      `select id, day_id, member_id, title, position, source, status, due_at, confirmed_at, linked_entry_id, template_task_id, is_milestone, reward_text, created_at, updated_at
       from daily_timeline_tasks
       where id = $1`,
      [id],
    );

    const current = currentResult.rows[0];
    if (!current) {
      return undefined;
    }
    const nextRewardText = Object.prototype.hasOwnProperty.call(patch, 'rewardText')
      ? patch.rewardText ?? null
      : (current.reward_text ? String(current.reward_text) : null);

    const result = await this.pool.query(
      `update daily_timeline_tasks
       set title = $2,
           position = $3,
           status = $4,
           due_at = $5,
           confirmed_at = $6,
           linked_entry_id = $7,
           template_task_id = $8,
           is_milestone = $9,
           reward_text = $10,
           updated_at = now()
       where id = $1
      returning id, day_id, member_id, title, position, source, status, due_at, confirmed_at, linked_entry_id, template_task_id, is_milestone, reward_text, created_at, updated_at`,
      [
        id,
        patch.title ?? String(current.title),
        patch.position ?? Number(current.position),
        patch.status ?? String(current.status),
        patch.dueAt ?? (current.due_at ? new Date(String(current.due_at)).toISOString() : null),
        patch.confirmedAt ?? (current.confirmed_at ? new Date(String(current.confirmed_at)).toISOString() : null),
        patch.linkedEntryId ?? (current.linked_entry_id ? String(current.linked_entry_id) : null),
        patch.templateTaskId ?? (current.template_task_id ? String(current.template_task_id) : null),
        patch.isMilestone ?? Boolean(current.is_milestone),
        nextRewardText,
      ],
    );

    return this.mapTask(result.rows[0]);
  }

  async deleteTimelineTask(dayId: string, id: string): Promise<boolean> {
    const result = await this.pool.query('delete from daily_timeline_tasks where day_id = $1 and id = $2', [dayId, id]);
    return (result.rowCount ?? 0) > 0;
  }

  private mapTemplate(row: Record<string, unknown>): DailyTimelineTemplateTask {
    return {
      id: String(row.id),
      memberId: String(row.member_id),
      title: String(row.title),
      position: Number(row.position),
      expectedTime: row.expected_time ? String(row.expected_time) : undefined,
      isActive: Boolean(row.is_active),
      isMilestone: Boolean(row.is_milestone),
      rewardText: row.reward_text ? String(row.reward_text) : undefined,
      appliesToEntryTask: Boolean(row.applies_to_entry_task),
      appliesToEventDerivedTask: Boolean(row.applies_to_event_derived_task),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }

  private mapDay(row: Record<string, unknown>): TimelineDayState {
    return {
      id: String(row.id),
      memberId: String(row.member_id),
      date: String(row.day_date),
      timezone: String(row.timezone),
      blockedByTaskId: row.blocked_by_task_id ? String(row.blocked_by_task_id) : undefined,
      resetAt: row.reset_at ? new Date(String(row.reset_at)).toISOString() : undefined,
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }

  private mapTask(row: Record<string, unknown>): TimelineTaskInstance {
    return {
      id: String(row.id),
      dayId: String(row.day_id),
      memberId: String(row.member_id),
      title: String(row.title),
      position: Number(row.position),
      source: row.source as TimelineTaskInstance['source'],
      status: row.status as TimelineTaskInstance['status'],
      dueAt: row.due_at ? new Date(String(row.due_at)).toISOString() : undefined,
      confirmedAt: row.confirmed_at ? new Date(String(row.confirmed_at)).toISOString() : undefined,
      linkedEntryId: row.linked_entry_id ? String(row.linked_entry_id) : undefined,
      templateTaskId: row.template_task_id ? String(row.template_task_id) : undefined,
      isMilestone: Boolean(row.is_milestone),
      rewardText: row.reward_text ? String(row.reward_text) : undefined,
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }
}
