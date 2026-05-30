import { Worker } from 'bullmq';
import { Pool } from 'pg';
import { PostgresAiMemoryRepository } from '../repositories/postgres/ai-memory-repository.js';
import { PostgresAiSuggestionRepository } from '../repositories/postgres/ai-suggestion-repository.js';
import { PostgresMemberRepository } from '../repositories/postgres/member-repository.js';
import { PostgresEntryRepository } from '../repositories/postgres/entry-repository.js';
import { PostgresFoodPlanRepository } from '../repositories/postgres/food-plan-repository.js';
import { runProactiveAnalysis } from '../domains/assistant/proactive-analysis-service.js';
import { AI_QUEUE_NAME, type AiJobData } from './ai-queue-types.js';

export { AI_QUEUE_NAME, type AiJobData };

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.log('[ai-worker] No REDIS_URL — AI worker idle');
  setInterval(() => undefined, 60_000);
} else {
  const url = new URL(redisUrl);
  const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

  if (!pool) {
    console.log('[ai-worker] No DATABASE_URL — AI worker idle');
    setInterval(() => undefined, 60_000);
  } else {
    const worker = new Worker<AiJobData>(
      AI_QUEUE_NAME,
      async (job) => {
        const { familyId, triggerType, triggerRef, triggerContext } = job.data;
        console.log(`[ai-worker] Processing ${triggerType} for family ${familyId}`);

        // All Postgres repos take only (pool); familyId is passed per-method call
        const aiMemoryRepo = new PostgresAiMemoryRepository(pool);
        const aiSuggestionRepo = new PostgresAiSuggestionRepository(pool);
        const memberRepo = new PostgresMemberRepository(pool);
        const entryRepo = new PostgresEntryRepository(pool);
        const foodRepo = new PostgresFoodPlanRepository(pool);

        // Rate limit: skip if entity-trigger already ran in last 10 min for same ref
        if (triggerType === 'event' && triggerRef) {
          const since = new Date(Date.now() - 10 * 60 * 1000);
          const recent = await aiSuggestionRepo.countByTriggerRef(familyId, triggerRef, since);
          if (recent > 0) {
            console.log(`[ai-worker] Rate limit hit for ${triggerRef} — skipping`);
            return;
          }
        }

        // Get family name
        const familyResult = await pool.query<{ name: string | null }>(
          'select name from families where id = $1',
          [familyId],
        );
        const familyName = familyResult.rows[0]?.name ?? null;

        const result = await runProactiveAnalysis({
          familyId,
          triggerType,
          triggerRef,
          triggerContext,
          contextDeps: {
            familyId,
            familyName,
            listMembers: () => memberRepo.list(familyId),
            listUpcomingEntries: (from, to) => {
              const rangeStart = new Date(from);
              const rangeEnd = new Date(to);
              return entryRepo.list(familyId).then((entries) =>
                entries.filter((e) => new Date(e.endTime) >= rangeStart && new Date(e.startTime) <= rangeEnd),
              );
            },
            listFoodPlan: (weekStart) => foodRepo.listByWeek(weekStart, familyId),
            aiMemoryRepository: aiMemoryRepo,
          },
          aiMemoryRepository: aiMemoryRepo,
          aiSuggestionRepository: aiSuggestionRepo,
        });

        console.log(`[ai-worker] Done: ${result.memoriesSaved} memories, ${result.suggestionsCreated} suggestions`);
      },
      {
        connection: { host: url.hostname, port: Number(url.port) || 6379 },
        concurrency: 1,
      },
    );

    worker.on('failed', (job, err) => {
      console.error(`[ai-worker] Job ${job?.id} failed:`, err.message);
    });

    console.log('[ai-worker] AI worker started');
  }
}
