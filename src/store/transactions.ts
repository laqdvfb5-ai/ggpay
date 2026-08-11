import type { CanonicalTransaction } from '../contract.js';
import { pool } from '../db/pool.js';

export async function insertTransaction(tx: CanonicalTransaction, rawId: string, receivedAt: Date): Promise<string | null> {
  const latencyMs = receivedAt.getTime() - tx.occurredAt.getTime();
  const { rows } = await pool.query<{ id: string }>(
    `insert into transactions(source,source_event_id,channel,bank_code,account_number,sub_account,direction,amount,balance_after,content,payment_code,reference_code,occurred_at,received_at,latency_ms,raw_id)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict(source,source_event_id) do nothing returning id`,
    [tx.source,tx.sourceEventId,tx.channel,tx.bankCode,tx.accountNumber,tx.subAccount,tx.direction,tx.amount.toString(),tx.balanceAfter?.toString() ?? null,tx.content,tx.paymentCode,tx.referenceCode,tx.occurredAt,receivedAt,latencyMs,rawId],
  );
  return rows[0]?.id ?? null;
}
