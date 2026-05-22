// packages/backend/src/workers/sync-worker.ts
import { Pool } from 'pg';
import { SyncConnectionService } from '../sync/sync-connection-service.js';
import { AppleCalDavAdapter } from '../sync/apple-caldav-adapter.js';
import { PostgresEntryRepository } from '../repositories/postgres/entry-repository.js';
import { AulaConnectionService } from '../aula/aula-connection-service.js';
import { AulaSyncService } from '../aula/aula-sync-service.js';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.log('[sync-worker] DATABASE_URL not set — sync worker idle.');
  setInterval(() => undefined, 60_000);
} else {
  const pool = new Pool({ connectionString: DATABASE_URL });

  async function runCalDavSyncForAllFamilies(): Promise<void> {
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

        console.log(`[sync-worker] syncing CalDAV connection ${conn.id} for family ${familyId}`);
        try {
          const entryRepo = new PostgresEntryRepository(pool);
          const entryRepository = {
            list: () => entryRepo.list(familyId),
            create: (e: import('@mental-load/contracts').Entry) => entryRepo.create(e, familyId),
            findByExternalUid: (uid: string) => entryRepo.findByExternalUid(uid, familyId),
          };
          await svc.runSync(conn.id, entryRepository);
        } catch (error) {
          console.error(`[sync-worker] CalDAV sync failed for connection ${conn.id}:`, error);
        }
      }
    }
  }

  async function runAulaSyncForAllFamilies(): Promise<void> {
    const families = await pool.query<{ id: string }>('select id from families');

    for (const { id: familyId } of families.rows) {
      const connSvc = new AulaConnectionService(pool, familyId);
      const conn = await connSvc.getConnection();

      if (!conn || !conn.isConnected) continue;

      const minutesSinceLast = conn.lastSyncAt
        ? (Date.now() - new Date(conn.lastSyncAt).getTime()) / 60_000
        : Infinity;

      if (minutesSinceLast < conn.syncIntervalMinutes) continue;

      console.log(`[aula-worker] syncing Aula for family ${familyId}`);
      try {
        const syncSvc = new AulaSyncService(pool, familyId);
        const stats = await syncSvc.runSync();
        console.log(`[aula-worker] family ${familyId}: +${stats.entriesCreated} entries, +${stats.itemsCreated} items`);
      } catch (error) {
        console.error(`[aula-worker] sync failed for family ${familyId}:`, error);
      }
    }
  }

  setInterval(() => {
    runCalDavSyncForAllFamilies().catch((err) => console.error('[sync-worker] CalDAV error:', err));
  }, 60_000);

  setInterval(() => {
    runAulaSyncForAllFamilies().catch((err) => console.error('[sync-worker] Aula error:', err));
  }, 60_000);

  setTimeout(() => {
    runCalDavSyncForAllFamilies().catch((err) => console.error('[sync-worker] CalDAV startup error:', err));
    runAulaSyncForAllFamilies().catch((err) => console.error('[aula-worker] startup error:', err));
  }, 5_000);

  console.log('[sync-worker] started — polling CalDAV + Aula every 60 seconds');
}
