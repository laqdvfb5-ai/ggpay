import { Router } from 'express';
import { pool } from '../db/pool.js';
import { extractAuthToken } from '../receiver/auth.js';
import { authenticateApiKey } from '../tenant/store.js';

declare global { namespace Express { interface Request { tenantId?:string } } }
function limit(raw:unknown){const n=Number(raw??50);return Number.isFinite(n)?Math.min(200,Math.max(1,Math.trunc(n))):50;}
export function customerRoutes():Router{
 const r=Router();
 r.use('/v1',async(req,res,next)=>{const token=extractAuthToken(req.header('authorization'));const tenantId=token?await authenticateApiKey(token):null;if(!tenantId){res.status(401).json({error:'Unauthorized'});return;}req.tenantId=tenantId;next();});
 r.get('/v1/transactions',async(req,res,next)=>{try{const rows=(await pool.query(`select id,source_event_id,channel,bank_code,account_number,direction,amount::text,balance_after::text,content,payment_code,reference_code,occurred_at,received_at,latency_ms::float8 from transactions where tenant_id=$1 order by occurred_at desc limit $2`,[req.tenantId,limit(req.query.limit)])).rows;res.json({data:rows});}catch(e){next(e);}});
 r.get('/v1/transactions/:id',async(req,res,next)=>{try{const row=(await pool.query(`select id,source_event_id,channel,bank_code,account_number,direction,amount::text,balance_after::text,content,payment_code,reference_code,occurred_at,received_at,latency_ms::float8 from transactions where tenant_id=$1 and id=$2`,[req.tenantId,req.params.id])).rows[0];if(!row){res.status(404).json({error:'Not found'});return;}res.json(row);}catch(e){next(e);}});
 r.get('/v1/deliveries',async(req,res,next)=>{try{const rows=(await pool.query(`select id,event_id,transaction_id,url,attempt,status_code,error,next_retry_at,delivered_at,created_at from deliveries where tenant_id=$1 order by created_at desc limit $2`,[req.tenantId,limit(req.query.limit)])).rows;res.json({data:rows});}catch(e){next(e);}});
 r.get('/v1/usage',async(req,res,next)=>{try{const month=String(req.query.month??new Date().toISOString().slice(0,7));if(!/^\d{4}-\d{2}$/.test(month)){res.status(400).json({error:'month phải có dạng YYYY-MM'});return;}const row=(await pool.query(`select count(*)::int incoming_transactions from usage_events where tenant_id=$1 and occurred_at>=($2||'-01')::date and occurred_at<(($2||'-01')::date+interval '1 month')`,[req.tenantId,month])).rows[0];res.json({month,...row});}catch(e){next(e);}});
 return r;
}
