import { loadConfig } from '../config.js';
import { pool } from '../db/pool.js';
import { recordFailure, recordSuccess } from '../store/deliveries.js';
import { signPayload } from './hmac.js';

async function buildPayload(transactionId: string): Promise<string> {
  const { rows } = await pool.query('select * from transactions where id=$1', [transactionId]);
  if (!rows[0]) throw new Error(`không tìm thấy transaction ${transactionId}`);
  const t = rows[0];
  return JSON.stringify({
    event_id:t.id, source:t.source, channel:t.channel, bank_code:t.bank_code, account_number:t.account_number,
    sub_account:t.sub_account, direction:t.direction, amount:t.amount.toString(), balance_after:t.balance_after?.toString() ?? null,
    content:t.content, payment_code:t.payment_code, reference_code:t.reference_code,
    occurred_at:t.occurred_at.toISOString(), received_at:t.received_at.toISOString(), latency_ms:Number(t.latency_ms),
  });
}
export async function deliver(transactionId: string, urlOverride?: string, attempt = 1): Promise<void> {
  const config = loadConfig();
  const url = urlOverride ?? config.outboundUrl;
  if (!url) return;
  const body = await buildPayload(transactionId);
  const timestamp = String(Math.floor(Date.now() / 1000));
  try {
    const response = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','X-Signature':signPayload(body,timestamp,config.outboundSecret),'X-Timestamp':timestamp}, body, signal:AbortSignal.timeout(10_000) });
    if (response.ok) await recordSuccess(transactionId,url,attempt,response.status);
    else await recordFailure(transactionId,url,attempt,response.status,`HTTP ${response.status}`);
  } catch (error) { await recordFailure(transactionId,url,attempt,null,String(error)); }
}
