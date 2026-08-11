import { loadConfig } from '../config.js';
import { pool } from '../db/pool.js';
import { recordFailure, recordSuccess } from '../store/deliveries.js';
import { webhookSecret } from '../tenant/store.js';
import { signPayload } from './hmac.js';

async function context(transactionId:string,webhookId:string){const row=(await pool.query(`select t.*,w.url,w.secret_encrypted from transactions t join tenant_webhooks w on w.id=$2 and w.tenant_id=t.tenant_id and w.active where t.id=$1`,[transactionId,webhookId])).rows[0];if(!row)throw new Error('Không tìm thấy transaction/webhook tenant');return row;}
export async function deliver(transactionId:string,tenantId:string,webhookId:string,attempt=1,eventId?:string):Promise<void>{
 const c=loadConfig(),t=await context(transactionId,webhookId);if(!c.webhookEncryptionKey)throw new Error('Chưa cấu hình WEBHOOK_ENCRYPTION_KEY');
 const stableEventId=eventId??(await pool.query('select gen_random_uuid() id')).rows[0].id;
 const body=JSON.stringify({event_id:stableEventId,event_type:'transaction.created',tenant_id:tenantId,source:t.source,channel:t.channel,bank_code:t.bank_code,account_number:t.account_number,sub_account:t.sub_account,direction:t.direction,amount:t.amount.toString(),balance_after:t.balance_after?.toString()??null,content:t.content,payment_code:t.payment_code,reference_code:t.reference_code,occurred_at:t.occurred_at.toISOString(),received_at:t.received_at.toISOString(),latency_ms:Number(t.latency_ms)});
 const timestamp=String(Math.floor(Date.now()/1000)),signature=signPayload(body,timestamp,webhookSecret(t.secret_encrypted,c.webhookEncryptionKey));
 try{const response=await fetch(t.url,{method:'POST',headers:{'Content-Type':'application/json','X-GGPay-Event-Id':stableEventId,'X-GGPay-Timestamp':timestamp,'X-GGPay-Signature':`sha256=${signature}`},body,redirect:'manual',signal:AbortSignal.timeout(10_000)});if(response.ok)await recordSuccess(transactionId,t.url,attempt,response.status,tenantId,webhookId,stableEventId);else await recordFailure(transactionId,t.url,attempt,response.status,`HTTP ${response.status}`,tenantId,webhookId,stableEventId);}catch(error){await recordFailure(transactionId,t.url,attempt,null,String(error),tenantId,webhookId,stableEventId);}
}
