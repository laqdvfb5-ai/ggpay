import { Router,urlencoded } from 'express';
import { loadConfig } from '../config.js';
import { activateAccount,beginOauth,consumeState,deactivateAccount,exchangeCode,syncAccounts } from '../sepay/oauth.js';
import { clearPortalSession,createPortalSession,requirePortal,requirePortalCsrf,setPortalSession } from './session.js';
import { consumeLoginToken,portalDashboard } from './store.js';
import { portalLogin,portalPage } from './views.js';
export function portalRoutes():Router{const r=Router(),form=urlencoded({extended:false,limit:'16kb'});
 r.get('/portal/login',(_req,res)=>res.send(portalLogin()));
 r.get('/portal/auth',async(req,res,next)=>{try{const row=await consumeLoginToken(String(req.query.token??''));if(!row){res.status(401).send(portalLogin('Liên kết không hợp lệ hoặc đã hết hạn.'));return;}setPortalSession(res,createPortalSession(row.user_id,row.tenant_id));res.redirect('/portal');}catch(e){next(e);}});
 r.use('/portal',requirePortal);
 r.get('/portal',async(_req,res,next)=>{try{res.send(portalPage(await portalDashboard(res.locals.portal.tenantId),res.locals.portal.csrf,String(_req.query.message??'')));}catch(e){next(e);}});
 r.post('/portal/logout',form,requirePortalCsrf,(_req,res)=>{clearPortalSession(res);res.redirect('/portal/login');});
 r.post('/portal/sepay/connect',form,requirePortalCsrf,async(_req,res,next)=>{try{res.redirect(await beginOauth(res.locals.portal.tenantId,res.locals.portal.userId));}catch(e){next(e);}});
 r.get('/portal/sepay/callback',async(req,res,next)=>{try{if(req.query.error){res.redirect('/portal?message='+encodeURIComponent('Bạn đã từ chối cấp quyền SePay.'));return;}const state=await consumeState(String(req.query.state??''));if(!state||state.tenant_id!==res.locals.portal.tenantId||state.user_id!==res.locals.portal.userId){res.status(400).send('OAuth state không hợp lệ');return;}await exchangeCode(state.tenant_id,String(req.query.code??''));await syncAccounts(state.tenant_id);res.redirect('/portal?message='+encodeURIComponent('Đã kết nối và đồng bộ SePay.'));}catch(e){next(e);}});
 r.post('/portal/sepay/sync',form,requirePortalCsrf,async(_req,res,next)=>{try{const count=await syncAccounts(res.locals.portal.tenantId);res.redirect('/portal?message='+encodeURIComponent(`Đã đồng bộ ${count} tài khoản từ SePay.`));}catch(e){next(e);}});
 r.post('/portal/bank-accounts/:id/enable',form,requirePortalCsrf,async(req,res,next)=>{try{const c=loadConfig();if(!c.publicBaseUrl)throw new Error('Chưa cấu hình PUBLIC_BASE_URL');await activateAccount(res.locals.portal.tenantId,String(req.params.id),c.sepayWebhookToken,`${c.publicBaseUrl}/webhooks/sepay`);res.redirect('/portal?message='+encodeURIComponent('Đã bật nhận giao dịch.'));}catch(e){next(e);}});
 r.post('/portal/bank-accounts/:id/disable',form,requirePortalCsrf,async(req,res,next)=>{try{await deactivateAccount(res.locals.portal.tenantId,String(req.params.id));res.redirect('/portal?message='+encodeURIComponent('Đã tắt nhận giao dịch.'));}catch(e){next(e);}});
 return r;}
