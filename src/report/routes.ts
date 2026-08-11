import { Router } from 'express';
import { loadConfig } from '../config.js';
import { pool } from '../db/pool.js';
import { extractAuthToken, tokensMatch } from '../receiver/auth.js';

export function reportRoutes(): Router {
  const router = Router(); const config = loadConfig();
  router.get('/report', async (req,res,next) => {
    if (!tokensMatch(extractAuthToken(req.header('authorization')),config.inspectToken)) { res.status(401).json({success:false,message:'Unauthorized'}); return; }
    try {
      // Cast các aggregate về number Postgres an toàn cho JSON. Pool cố ý parse
      // bigint thành JS BigInt để giữ chính xác số tiền, nhưng JSON.stringify
      // không hỗ trợ BigInt.
      const latency = await pool.query(`select channel,count(*)::int as n,round(percentile_cont(0.5) within group(order by latency_ms))::float8 as p50_ms,round(percentile_cont(0.95) within group(order by latency_ms))::float8 as p95_ms,max(latency_ms)::float8 as max_ms from transactions group by channel`);
      const fieldCoverage = await pool.query(`select channel,count(*)::int as n,count(reference_code)::int as has_reference_code,count(balance_after)::int as has_balance_after,count(content)::int as has_content,count(payment_code)::int as has_payment_code,count(sub_account)::int as has_sub_account from transactions group by channel`);
      const sepayRetries = await pool.query(`select body->>'id' as sepay_id,count(*)::int as deliveries,min(received_at) as first_seen,max(received_at) as last_seen,extract(epoch from(max(received_at)-min(received_at)))::float8 as spread_seconds from raw_events group by body->>'id' having count(*)>1 order by count(*) desc limit 50`);
      const failures = await pool.query(`select id,received_at,error from raw_events where status='normalize_failed' order by received_at desc limit 50`);
      res.json({latency:latency.rows,fieldCoverage:fieldCoverage.rows,sepayRetries:sepayRetries.rows,normalizeFailures:failures.rows});
    } catch (error) { next(error); }
  });
  return router;
}
