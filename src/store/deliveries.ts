import { pool } from '../db/pool.js';

export const RETRY_SCHEDULE_SECONDS = [10, 60, 300, 1800, 7200, 21600];
export interface DeliveryRow { id: string; transaction_id: string; url: string; attempt: number; }
export async function recordSuccess(transactionId: string, url: string, attempt: number, statusCode: number): Promise<void> {
  await pool.query(`insert into deliveries(transaction_id,url,attempt,status_code,delivered_at) values($1,$2,$3,$4,now())`, [transactionId,url,attempt,statusCode]);
}
export async function recordFailure(transactionId: string, url: string, attempt: number, statusCode: number | null, error: string): Promise<void> {
  const delay = RETRY_SCHEDULE_SECONDS[attempt - 1];
  const next = delay === undefined ? null : new Date(Date.now() + delay * 1000);
  await pool.query(`insert into deliveries(transaction_id,url,attempt,status_code,error,next_retry_at) values($1,$2,$3,$4,$5,$6)`, [transactionId,url,attempt,statusCode,error,next]);
}
export async function findDue(limit: number): Promise<DeliveryRow[]> {
  return (await pool.query<DeliveryRow>(
    `select id, transaction_id, url, attempt
     from (
       select distinct on (transaction_id)
         id, transaction_id, url, attempt, next_retry_at, delivered_at
       from deliveries
       order by transaction_id, attempt desc
     ) latest
     where delivered_at is null
       and next_retry_at is not null
       and next_retry_at <= now()
     limit $1`,
    [limit],
  )).rows;
}
