import { findDue } from '../store/deliveries.js';
import { deliver } from './dispatch.js';

let running = false;
export async function runRetryPass(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const due = await findDue(20);
    for (const row of due) await deliver(row.transaction_id, row.url, row.attempt + 1);
    return due.length;
  } finally { running = false; }
}
export function startRetryWorker(intervalMs = 30_000): NodeJS.Timeout {
  const timer = setInterval(() => void runRetryPass().catch((error) => console.error('retry worker lỗi:', error)), intervalMs);
  timer.unref();
  return timer;
}
