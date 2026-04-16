import { Worker } from 'bullmq';
import { MailService } from '../mail/mail-service';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.log('Reminder worker idle: set REDIS_URL to enable BullMQ processing.');
  setInterval(() => undefined, 60_000);
} else {
  const url = new URL(redisUrl);
  const mailService = new MailService();

  const worker = new Worker(
    'mental-load-reminders',
    async (job) => {
      const entryId = String(job.data.entryId ?? 'unknown');
      await mailService.sendReminder({
        to: process.env.REMINDER_TEST_EMAIL ?? 'family@local.test',
        subject: `Reminder for entry ${entryId}`,
        text: `MentalLoad reminder triggered for entry ${entryId} at ${job.data.runAt}.`,
      });
      console.log(`[worker] processed ${job.name} for ${entryId}`);
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
