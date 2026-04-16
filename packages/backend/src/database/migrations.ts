import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query('create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now())');

  const migrationsDir = await resolveMigrationsDir();
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    const alreadyApplied = await pool.query('select 1 from schema_migrations where filename = $1', [file]);
    if (alreadyApplied.rowCount) {
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    await pool.query('begin');
    try {
      await pool.query(sql);
      await pool.query('insert into schema_migrations (filename) values ($1)', [file]);
      await pool.query('commit');
    } catch (error) {
      await pool.query('rollback');
      throw error;
    }
  }
}

async function resolveMigrationsDir(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), 'packages/backend/migrations'),
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(__dirname, '../../migrations'),
  ];

  for (const candidate of candidates) {
    try {
      const files = await readdir(candidate);
      if (files.length > 0) {
        return candidate;
      }
    } catch {
      // continue
    }
  }

  throw new Error('Could not locate backend migration directory.');
}
