import { Router,urlencoded } from 'express';
import { loadConfig } from '../config.js';
import { sendWebhookTest } from '../dispatcher/testWebhook.js';
import { tokensMatch } from '../receiver/auth.js';
import { addBankAccount,createTenant,issueApiKey,listTenantSummaries,revokeApiKey,tenantDashboard,upsertWebhook } from '../tenant/store.js';
import { clearSession,createSession,parseSession,requireAdmin,requireCsrf,setSession } from './session.js';
import { layout,login,tenantPage,tenantsPage } from './views.js';

const oneTime=new Map<string,{title:string;value:string;expires:number}>();
export function dashboardRoutes():Router{
 const r=Router(),form=urlencoded({extended:false,limit:'32kb'}),config=loadConfig();
 r.get('/admin/login',(req,res)=>{if(parseSession(req.header('cookie'))){res.redirect('/admin');return;}res.send(login());});
 r.post('/admin/login',form,(req,res)=>{if(!tokensMatch(String(req.body.token??''),config.inspectToken)){res.status(401).send(login('Token không đúng'));return;}setSession(res,createSession());res.redirect('/admin');});
 r.post('/admin/logout',form,(req,res)=>{clearSession(res);res.redirect('/admin/login');});
 r.use('/admin',requireAdmin);
 r.get('/admin',async(_req,res,next)=>{try{res.send(tenantsPage(await listTenantSummaries(),res.locals.session.csrf));}catch(e){next(e);}});
 r.post('/admin/tenants',form,requireCsrf,async(req,res,next)=>{try{const t=await createTenant(String(req.body.name),String(req.body.slug));res.redirect(`/admin/tenants/${t.id}`);}catch(e){next(e);}});
 r.get('/admin/tenants/:id',async(req,res,next)=>{try{const id=String(String(req.params.id));const data=await tenantDashboard(id);if(!data){res.status(404).send(layout('Không tìm thấy','<h1>Không tìm thấy tenant</h1>'));return;}const flash=oneTime.get(id);if(flash){oneTime.delete(id);if(flash.expires<Date.now())res.send(tenantPage(data,res.locals.session.csrf));else res.send(tenantPage(data,res.locals.session.csrf,flash));}else res.send(tenantPage(data,res.locals.session.csrf));}catch(e){next(e);}});
 r.post('/admin/tenants/:id/bank-accounts',form,requireCsrf,async(req,res,next)=>{try{await addBankAccount(String(req.params.id),{account_number:String(req.body.account_number),bank_code:String(req.body.bank_code||''),label:String(req.body.label||'')});res.redirect(`/admin/tenants/${String(req.params.id)}`);}catch(e){next(e);}});
 r.post('/admin/tenants/:id/api-keys',form,requireCsrf,async(req,res,next)=>{try{const key=await issueApiKey(String(req.params.id),String(req.body.name));oneTime.set(String(req.params.id),{title:'API key',value:key.key,expires:Date.now()+120000});res.redirect(`/admin/tenants/${String(req.params.id)}`);}catch(e){next(e);}});
 r.post('/admin/api-keys/:id/revoke',form,requireCsrf,async(req,res,next)=>{try{await revokeApiKey(String(req.params.id));res.redirect(req.header('referer')??'/admin');}catch(e){next(e);}});
 r.post('/admin/tenants/:id/webhook',form,requireCsrf,async(req,res,next)=>{try{if(!config.webhookEncryptionKey)throw new Error('Chưa cấu hình WEBHOOK_ENCRYPTION_KEY');const id=String(req.params.id),hook=await upsertWebhook(id,String(req.body.url),req.body.secret?String(req.body.secret):undefined,config.webhookEncryptionKey);oneTime.set(id,{title:'Webhook secret',value:hook.secret,expires:Date.now()+120000});res.redirect(`/admin/tenants/${id}`);}catch(e){next(e);}});
 r.post('/admin/tenants/:id/webhook/test',form,requireCsrf,async(req,res,next)=>{try{const id=String(req.params.id),result=await sendWebhookTest(id);oneTime.set(id,{title:result.success?'Webhook test thành công':'Webhook test thất bại',value:result.success?`HTTP ${result.status} · event ${result.eventId}`:result.error??'Unknown error',expires:Date.now()+120000});res.redirect(`/admin/tenants/${id}`);}catch(e){next(e);}});
 return r;
}
