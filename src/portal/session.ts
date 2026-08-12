import { createHmac,randomBytes,timingSafeEqual } from 'node:crypto';
import type { NextFunction,Request,Response } from 'express';
import { loadConfig } from '../config.js';
const COOKIE='ggpay_portal';
type PortalSession={userId:string;tenantId:string;issued:number;csrf:string};
function secret(){const c=loadConfig();return c.webhookEncryptionKey||c.inspectToken;}
function sign(value:string,key=secret()){return createHmac('sha256',key).update(value).digest('base64url');}
export function createPortalSession(userId:string,tenantId:string,key=secret()){const data:PortalSession={userId,tenantId,issued:Math.floor(Date.now()/1000),csrf:randomBytes(24).toString('base64url')},payload=Buffer.from(JSON.stringify(data)).toString('base64url');return`${payload}.${sign(payload,key)}`;}
export function parsePortalSession(cookie:string|undefined,key=secret()):PortalSession|null{if(!cookie)return null;const raw=cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);if(!raw)return null;const[payload,sig]=raw.split('.');if(!payload||!sig)return null;const a=Buffer.from(sig),b=Buffer.from(sign(payload,key));if(a.length!==b.length||!timingSafeEqual(a,b))return null;try{const d=JSON.parse(Buffer.from(payload,'base64url').toString()) as PortalSession;if(!d.userId||!d.tenantId||!d.csrf||Date.now()/1000-d.issued>8*3600)return null;return d;}catch{return null;}}
export function setPortalSession(res:Response,value:string){res.setHeader('Set-Cookie',`${COOKIE}=${value}; Path=/portal; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`);}
export function clearPortalSession(res:Response){res.setHeader('Set-Cookie',`${COOKIE}=; Path=/portal; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);}
export async function requirePortal(req:Request,res:Response,next:NextFunction){try{const session=parsePortalSession(req.header('cookie'));if(!session){res.redirect('/portal/login');return;}const { membership }=await import('./store.js');if(!await membership(session.userId,session.tenantId)){res.redirect('/portal/login');return;}res.locals.portal=session;next();}catch(e){next(e);}}
export function requirePortalCsrf(req:Request,res:Response,next:NextFunction){if(req.body?._csrf!==res.locals.portal?.csrf){res.status(403).send('CSRF token không hợp lệ');return;}next();}
