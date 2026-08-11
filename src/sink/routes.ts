import { Router, raw } from 'express';
import { loadConfig } from '../config.js';
import { timestampIsFresh, verifySignature } from '../dispatcher/hmac.js';

export function sinkRoutes(): Router {
  const router = Router();
  const config = loadConfig();
  router.post('/test-sink', raw({ type: '*/*', limit: '256kb' }), (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const signature = req.header('x-signature') ?? '';
    const timestamp = req.header('x-timestamp') ?? '';
    if (!timestampIsFresh(timestamp) || !verifySignature(body,timestamp,config.outboundSecret,signature)) {
      res.status(401).json({ ok:false, message:'chữ ký không hợp lệ' }); return;
    }
    console.log('test-sink nhận được:', body);
    res.json({ ok:true });
  });
  return router;
}
