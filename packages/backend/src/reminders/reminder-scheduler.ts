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

export interface ReminderScheduler {
  scheduleForEntry(entry: Entry): Promise<ReminderJobRecord[]>;
  listJobs(): Promise<ReminderJobRecord[]>;
}

export class InMemoryReminderScheduler implements ReminderScheduler {
  private readonly jobs = new Map<string, ReminderJobRecord>();

  async scheduleForEntry(entry: Entry): Promise<ReminderJobRecord[]> {
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
}

export class RedisReminderScheduler implements ReminderScheduler {
  private readonly queue: Queue;
  private readonly jobs = new Map<string, ReminderJobRecord>();

  constructor(redisUrl: string) {
    const url = new URL(redisUrl);
    this.queue = new Queue('mental-load-reminders', {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
      },
    });
  }

  async scheduleForEntry(entry: Entry): Promise<ReminderJobRecord[]> {
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
          { entryId: job.entryId, reminderId: job.reminderId, runAt: job.runAt },
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
}
