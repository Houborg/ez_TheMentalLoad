import { Worker } from 'bullmq';
import { Pool } from 'pg';
import { SystemMailService } from '../mail/system-mail-service';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.log('Reminder worker idle: set REDIS_URL to enable BullMQ processing.');
  setInterval(() => undefined, 60_000);
} else {
  const url = new URL(redisUrl);
  const systemMail = new SystemMailService();
  const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

  const worker = new Worker(
    'mental-load-reminders',
    async (job) => {
      const { entryId, familyId, ownerMemberId, entryTitle, entryStart } = job.data as {
        entryId: string;
        familyId?: string;
        ownerMemberId?: string;
        entryTitle?: string;
        entryStart?: string;
      };

      if (!familyId || !ownerMemberId) {
        console.warn(`[worker] job ${job.id} missing familyId/ownerMemberId, skipping email`);
        return;
      }

      if (!pool) {
        console.warn(`[worker] no DATABASE_URL set, cannot look up member email for entry ${entryId}`);
        return;
      }

      const result = await pool.query<{ name: string; email: string | null }>(
        'select name, email from members where id = $1 and family_id = $2',
        [ownerMemberId, familyId],
      );

      const member = result.rows[0];
      if (!member?.email) {
        console.log(`[worker] member ${ownerMemberId} has no email address, skipping reminder for entry ${entryId}`);
        return;
      }

      const title = entryTitle ?? `entry ${entryId}`;
      const start = entryStart ?? job.data.runAt ?? new Date().toISOString();

      await systemMail.sendReminder(member.email, member.name, title, start);
      console.log(`[worker] sent reminder for "${title}" to ${member.email}`);
    },
    {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
      },
    },
  );

  worker.on('completed', (job) => {
    console.log(`[worker] completed job ${job?.id}`);
  });

  worker.on('failed', (job, error) => {
    console.error(`[worker] failed job ${job?.id}`, error);
  });
}
