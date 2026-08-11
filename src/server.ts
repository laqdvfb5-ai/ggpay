import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { pool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { startRetryWorker } from './dispatcher/retryWorker.js';

async function main(): Promise<void> {
  const config = loadConfig(); await runMigrations(); const worker = startRetryWorker();
  const server = createApp().listen(config.port,() => console.log(`đang nghe cổng ${config.port}`));
  const shutdown = (signal:string) => { console.log(`nhận ${signal}, đang dừng`); clearInterval(worker); server.close(() => void pool.end().finally(() => process.exit(0))); setTimeout(() => process.exit(1),10_000).unref(); };
  process.once('SIGTERM',() => shutdown('SIGTERM')); process.once('SIGINT',() => shutdown('SIGINT'));
}
main().catch((error) => { console.error(error); process.exitCode=1; });
