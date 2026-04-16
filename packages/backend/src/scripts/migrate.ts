import { Pool } from 'pg';
import { runMigrations } from '../database/migrations';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for migrations.');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await runMigrations(pool);
    console.log('Database migrations applied successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
