import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      if ((await client.query('select 1 from schema_migrations where name=$1', [file])).rowCount) continue;
      await client.query('begin');
      try {
        await client.query(await readFile(join(migrationsDir, file), 'utf8'));
        await client.query('insert into schema_migrations(name) values($1)', [file]);
        await client.query('commit');
        console.log(`đã chạy migration: ${file}`);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`migration ${file} thất bại: ${String(error)}`);
      }
    }
  } finally { client.release(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations().then(() => pool.end()).catch((error) => { console.error(error); process.exitCode = 1; });
}
