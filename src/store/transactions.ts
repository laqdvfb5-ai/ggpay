import type { CanonicalTransaction } from '../contract.js';
import { pool } from '../db/pool.js';

export interface InsertedTransaction { id:string; tenantId:string|null; webhookId:string|null; }
export async function insertTransaction(tx: CanonicalTransaction, rawId: string, receivedAt: Date): Promise<InsertedTransaction | null> {
  const client=await pool.connect();
  try{
    await client.query('begin');
    const route=(await client.query(`select b.id bank_account_id,b.tenant_id,w.id webhook_id from bank_accounts b join tenants t on t.id=b.tenant_id left join tenant_webhooks w on w.tenant_id=t.id and w.active where b.account_number=$1 and b.active and t.status='active'`,[tx.accountNumber])).rows[0]??null;
    const latencyMs = receivedAt.getTime() - tx.occurredAt.getTime();
    const { rows } = await client.query<{ id: string }>(
      `insert into transactions(source,source_event_id,channel,bank_code,account_number,sub_account,direction,amount,balance_after,content,payment_code,reference_code,occurred_at,received_at,latency_ms,raw_id,tenant_id,bank_account_id,routing_status)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       on conflict(source,source_event_id) do nothing returning id`,
      [tx.source,tx.sourceEventId,tx.channel,tx.bankCode,tx.accountNumber,tx.subAccount,tx.direction,tx.amount.toString(),tx.balanceAfter?.toString() ?? null,tx.content,tx.paymentCode,tx.referenceCode,tx.occurredAt,receivedAt,latencyMs,rawId,route?.tenant_id??null,route?.bank_account_id??null,route?'routed':'unrouted'],
    );
    const id=rows[0]?.id;
    if(id&&route&&tx.direction==='in')await client.query(`insert into usage_events(tenant_id,transaction_id,occurred_at) values($1,$2,$3) on conflict(transaction_id) do nothing`,[route.tenant_id,id,tx.occurredAt]);
    await client.query('commit');
    return id?{id,tenantId:route?.tenant_id??null,webhookId:route?.webhook_id??null}:null;
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
