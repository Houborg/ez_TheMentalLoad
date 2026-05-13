import { Queue } from 'bullmq';
import type { Entry } from '@mental-load/contracts';

export interface ReminderJobRecord {
  id: string;
  entryId: string;
  reminderId: string;
  minutesBefore: number;
  runAt: string;
  transport: 'memory' | 'redis';
}

export interface TimelinePromptJobRecord {
  id: string;
  taskId: string;
  memberId: string;
  runAt: string;
  transport: 'memory' | 'redis';
}

export interface TimelineResetJobRecord {
  id: string;
  memberId: string;
  date: string;
  timezone: string;
  runAt: string;
  transport: 'memory' | 'redis';
}

export interface ReminderScheduler {
  scheduleForEntry(entry: Entry, familyId: string): Promise<ReminderJobRecord[]>;
  scheduleTimelinePrompt(taskId: string, memberId: string, runAt: string): Promise<TimelinePromptJobRecord>;
  scheduleTimelineReset(memberId: string, date: string, timezone: string, runAt: string): Promise<TimelineResetJobRecord>;
  listJobs(): Promise<ReminderJobRecord[]>;
  listTimelinePromptJobs(): Promise<TimelinePromptJobRecord[]>;
  listTimelineResetJobs(): Promise<TimelineResetJobRecord[]>;
}

export class InMemoryReminderScheduler implements ReminderScheduler {
  private readonly jobs = new Map<string, ReminderJobRecord>();
  private readonly timelinePromptJobs = new Map<string, TimelinePromptJobRecord>();
  private readonly timelineResetJobs = new Map<string, TimelineResetJobRecord>();

  async scheduleForEntry(entry: Entry, _familyId: string): Promise<ReminderJobRecord[]> {
    for (const [key, job] of this.jobs.entries()) {
      if (job.entryId === entry.id) {
        this.jobs.delete(key);
      }
    }

    const scheduledJobs = entry.reminders.map((reminder) => {
      const runAt = new Date(new Date(entry.startTime).getTime() - reminder.minutesBefore * 60_000).toISOString();
      const job: ReminderJobRecord = {
        id: `${entry.id}:${reminder.id}`,
        entryId: entry.id,
        reminderId: reminder.id,
        minutesBefore: reminder.minutesBefore,
        runAt,
        transport: 'memory',
      };
      this.jobs.set(job.id, job);
      return job;
    });

    return scheduledJobs;
  }

  async listJobs(): Promise<ReminderJobRecord[]> {
    return [...this.jobs.values()].sort((left, right) => left.runAt.localeCompare(right.runAt));
  }

  async scheduleTimelinePrompt(taskId: string, memberId: string, runAt: string): Promise<TimelinePromptJobRecord> {
    const job: TimelinePromptJobRecord = {
      id: `${taskId}:${memberId}:timeline-prompt`,
      taskId,
      memberId,
      runAt,
      transport: 'memory',
    };
    this.timelinePromptJobs.set(job.id, job);
    return job;
  }

  async scheduleTimelineReset(memberId: string, date: string, timezone: string, runAt: string): Promise<TimelineResetJobRecord> {
    const job: TimelineResetJobRecord = {
      id: `${memberId}:${date}:timeline-reset`,
      memberId,
      date,
      timezone,
      runAt,
      transport: 'memory',
    };
    this.timelineResetJobs.set(job.id, job);
    return job;
  }

  async listTimelinePromptJobs(): Promise<TimelinePromptJobRecord[]> {
    return [...this.timelinePromptJobs.values()].sort((left, right) => left.runAt.localeCompare(right.runAt));
  }

  async listTimelineResetJobs(): Promise<TimelineResetJobRecord[]> {
    return [...this.timelineResetJobs.values()].sort((left, right) => left.runAt.localeCompare(right.runAt));
  }
}

export class RedisReminderScheduler implements ReminderScheduler {
  private readonly queue: Queue;
  private readonly jobs = new Map<string, ReminderJobRecord>();
  private readonly timelinePromptJobs = new Map<string, TimelinePromptJobRecord>();
  private readonly timelineResetJobs = new Map<string, TimelineResetJobRecord>();

  constructor(redisUrl: string) {
    const url = new URL(redisUrl);
    this.queue = new Queue('mental-load-reminders', {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
      },
    });
  }

  async scheduleForEntry(entry: Entry, familyId: string): Promise<ReminderJobRecord[]> {
    const scheduledJobs = entry.reminders.map((reminder) => {
      const runAtDate = new Date(new Date(entry.startTime).getTime() - reminder.minutesBefore * 60_000);
      const job: ReminderJobRecord = {
        id: `${entry.id}:${reminder.id}`,
        entryId: entry.id,
        reminderId: reminder.id,
        minutesBefore: reminder.minutesBefore,
        runAt: runAtDate.toISOString(),
        transport: 'redis',
      };
      this.jobs.set(job.id, job);
      return job;
    });

    for (const job of scheduledJobs) {
      const delay = Math.max(new Date(job.runAt).getTime() - Date.now(), 0);
      try {
        await this.queue.add(
          'reminder.triggered',
          {
            entryId: job.entryId,
            reminderId: job.reminderId,
            runAt: job.runAt,
            familyId,
            ownerMemberId: entry.ownerMemberId,
            entryTitle: entry.title,
            entryStart: entry.startTime,
          },
          { delay, removeOnComplete: 100, removeOnFail: 100 },
        );
      } catch {
        // keep the app responsive even if Redis is unavailable
      }
    }

    return scheduledJobs;
  }

  async listJobs(): Promise<ReminderJobRecord[]> {
    return [...this.jobs.values()].sort((left, right) => left.runAt.localeCompare(right.runAt));
  }

  async scheduleTimelinePrompt(taskId: string, memberId: string, runAt: string): Promise<TimelinePromptJobRecord> {
    const job: TimelinePromptJobRecord = {
      id: `${taskId}:${memberId}:timeline-prompt`,
      taskId,
      memberId,
      runAt,
      transport: 'redis',
    };
    this.timelinePromptJobs.set(job.id, job);

    const delay = Math.max(new Date(runAt).getTime() - Date.now(), 0);
    try {
      await this.queue.add(
        'timeline.step.reached',
        { taskId, memberId, runAt },
        { delay, removeOnComplete: 100, removeOnFail: 100 },
      );
    } catch {
      // keep the app responsive even if Redis is unavailable
    }

    return job;
  }

  async scheduleTimelineReset(memberId: string, date: string, timezone: string, runAt: string): Promise<TimelineResetJobRecord> {
    const job: TimelineResetJobRecord = {
      id: `${memberId}:${date}:timeline-reset`,
      memberId,
      date,
      timezone,
      runAt,
      transport: 'redis',
    };
    this.timelineResetJobs.set(job.id, job);

    const delay = Math.max(new Date(runAt).getTime() - Date.now(), 0);
    try {
      await this.queue.add(
        'timeline.day.reset',
        { memberId, date, timezone, runAt },
        { delay, removeOnComplete: 100, removeOnFail: 100 },
      );
    } catch {
      // keep the app responsive even if Redis is unavailable
    }

    return job;
  }

  async listTimelinePromptJobs(): Promise<TimelinePromptJobRecord[]> {
    return [...this.timelinePromptJobs.values()].sort((left, right) => left.runAt.localeCompare(right.runAt));
  }

  async listTimelineResetJobs(): Promise<TimelineResetJobRecord[]> {
    return [...this.timelineResetJobs.values()].sort((left, right) => left.runAt.localeCompare(right.runAt));
  }
}
