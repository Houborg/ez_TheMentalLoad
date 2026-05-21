import { Pool } from 'pg';
import { SyncConnectionService } from '../sync/sync-connection-service';
import { AppleCalDavAdapter } from '../sync/apple-caldav-adapter';
import { PostgresEntryRepository } from '../repositories/postgres/entry-repository';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.log('[sync-worker] DATABASE_URL not set — sync worker idle.');
  setInterval(() => undefined, 60_000);
} else {
  const pool = new Pool({ connectionString: DATABASE_URL });

  async function runSyncForAllFamilies(): Promise<void> {
    const families = await pool.query<{ id: string }>('select id from families');

    for (const { id: familyId } of families.rows) {
      const svc = new SyncConnectionService(pool, familyId, new AppleCalDavAdapter());
      const connections = await svc.listConnections();
      const active = connections.filter((c) => c.isConnected);

      for (const conn of active) {
        const minutesSinceLast = conn.lastSyncAt
          ? (Date.now() - new Date(conn.lastSyncAt).getTime()) / 60_000
          : Infinity;

        if (minutesSinceLast < conn.syncIntervalMinutes) continue;

        console.log(`[sync-worker] syncing connection ${conn.id} (${conn.provider}) for family ${familyId}`);
        try {
          const entryRepo = new PostgresEntryRepository(pool);
          const entryRepository = { list: () => entryRepo.list(familyId) };
          await svc.runSync(conn.id, entryRepository);
        } catch (error) {
          console.error(`[sync-worker] sync failed for connection ${conn.id}:`, error);
        }
      }
    }
  }

  // Check every 60 seconds — each connection's syncIntervalMinutes is enforced inside
  setInterval(() => {
    runSyncForAllFamilies().catch((err) => console.error('[sync-worker] error:', err));
  }, 60_000);

  // Run once on startup after a short delay (let the app finish initialising)
  setTimeout(() => {
    runSyncForAllFamilies().catch((err) => console.error('[sync-worker] startup error:', err));
  }, 5_000);

  console.log('[sync-worker] started — polling every 60 seconds');
}
