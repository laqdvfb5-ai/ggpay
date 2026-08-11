import { pool } from '../db/pool.js';

export interface RawEventInput { source: string; headers: unknown; body: unknown; remoteIp: string | null; }
export interface RawEventRow { id: string; source: string; received_at: Date; headers: Record<string, unknown>; body: Record<string, unknown>; remote_ip: string | null; status: string; error: string | null; }

function redactHeaders(headers: unknown): unknown {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return headers;
  const copy = { ...(headers as Record<string, unknown>) };
  for (const key of Object.keys(copy)) if (['authorization', 'cookie', 'x-api-key'].includes(key.toLowerCase())) copy[key] = '[REDACTED]';
  return copy;
}
export async function insertRawEvent(input: RawEventInput): Promise<{ id: string; receivedAt: Date }> {
  const { rows } = await pool.query<{ id: string; received_at: Date }>(
    `insert into raw_events(source,headers,body,remote_ip) values($1,$2,$3,$4) returning id,received_at`,
    [input.source, JSON.stringify(redactHeaders(input.headers)), JSON.stringify(input.body), input.remoteIp],
  );
  return { id: rows[0].id, receivedAt: rows[0].received_at };
}
export async function markRawEvent(id: string, status: 'normalized' | 'normalize_failed', error: string | null): Promise<void> {
  await pool.query('update raw_events set status=$2,error=$3 where id=$1', [id, status, error]);
}
export async function listRawEvents(limit: number): Promise<RawEventRow[]> {
  return (await pool.query<RawEventRow>('select * from raw_events order by received_at desc limit $1', [limit])).rows;
}
