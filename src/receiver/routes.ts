import { Router } from 'express';
import { loadConfig } from '../config.js';
import { deliver } from '../dispatcher/dispatch.js';
import { normalizeSepay } from '../normalizer/sepay.js';
import { insertRawEvent, listRawEvents, markRawEvent } from '../store/rawEvents.js';
import { insertTransaction } from '../store/transactions.js';
import { extractAuthToken, tokensMatch } from './auth.js';

const SEPAY_IPS = new Set(['172.236.138.20','172.233.83.68','171.244.35.2','151.158.108.68','151.158.109.79','103.255.238.139','2400:8905::2000:8cff:fe98:45cd','2600:3c15::2000:8aff:fedd:874b']);
function boundedLimit(raw: unknown): number { const value = Number(raw ?? 50); return Number.isFinite(value) ? Math.min(500, Math.max(1, Math.trunc(value))) : 50; }

export function receiverRoutes(): Router {
  const router = Router();
  const config = loadConfig();
  router.post('/webhooks/sepay', async (req, res) => {
    if (!tokensMatch(extractAuthToken(req.header('authorization')), config.sepayWebhookToken)) { res.status(401).json({success:false,message:'Unauthorized'}); return; }
    const remoteIp = req.ip ?? null;
    if (remoteIp && !SEPAY_IPS.has(remoteIp.replace(/^::ffff:/,''))) console.warn(`webhook đến từ IP lạ: ${remoteIp}`);
    let raw: { id:string; receivedAt:Date };
    try { raw = await insertRawEvent({source:'sepay',headers:req.headers,body:req.body,remoteIp}); }
    catch (error) { console.error('ghi raw_events thất bại:',error); res.status(500).json({success:false,message:'storage failed'}); return; }
    try {
      const tx = normalizeSepay(req.body as Record<string,unknown>);
      const txId = await insertTransaction(tx,raw.id,raw.receivedAt);
      await markRawEvent(raw.id,'normalized',null);
      res.json({success:true});
      if (txId?.tenantId && txId.webhookId) void deliver(txId.id,txId.tenantId,txId.webhookId).catch((error) => console.error('dispatcher lỗi:',error));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markRawEvent(raw.id,'normalize_failed',message);
      console.error(`chuẩn hoá thất bại raw_id=${raw.id}: ${message}`);
      res.json({success:true});
    }
  });
  router.get('/events', async (req,res) => {
    if (!tokensMatch(extractAuthToken(req.header('authorization')),config.inspectToken)) { res.status(401).json({success:false,message:'Unauthorized'}); return; }
    const events = await listRawEvents(boundedLimit(req.query.limit));
    res.json({count:events.length,events});
  });
  return router;
}
