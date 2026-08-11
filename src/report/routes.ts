import { Router } from 'express';
import { loadConfig } from '../config.js';
import { pool } from '../db/pool.js';
import { extractBearer, tokensMatch } from '../receiver/auth.js';

export function reportRoutes(): Router {
  const router = Router(); const config = loadConfig();
  router.get('/report', async (req,res,next) => {
    if (!tokensMatch(extractBearer(req.header('authorization')),config.inspectToken)) { res.status(401).json({success:false,message:'Unauthorized'}); return; }
    try {
      const latency = await pool.query(`select channel,count(*) as n,round(percentile_cont(0.5) within group(order by latency_ms)) as p50_ms,round(percentile_cont(0.95) within group(order by latency_ms)) as p95_ms,max(latency_ms) as max_ms from transactions group by channel`);
      const fieldCoverage = await pool.query(`select channel,count(*) as n,count(reference_code) as has_reference_code,count(balance_after) as has_balance_after,count(content) as has_content,count(payment_code) as has_payment_code,count(sub_account) as has_sub_account from transactions group by channel`);
      const sepayRetries = await pool.query(`select body->>'id' as sepay_id,count(*) as deliveries,min(received_at) as first_seen,max(received_at) as last_seen,extract(epoch from(max(received_at)-min(received_at))) as spread_seconds from raw_events group by body->>'id' having count(*)>1 order by count(*) desc limit 50`);
      const failures = await pool.query(`select id,received_at,error from raw_events where status='normalize_failed' order by received_at desc limit 50`);
      res.json({latency:latency.rows,fieldCoverage:fieldCoverage.rows,sepayRetries:sepayRetries.rows,normalizeFailures:failures.rows});
    } catch (error) { next(error); }
  });
  return router;
}
