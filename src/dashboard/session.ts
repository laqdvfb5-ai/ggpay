import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction,Request,Response } from 'express';
import { loadConfig } from '../config.js';

const COOKIE='ggpay_admin';
function sign(value:string,secret:string){return createHmac('sha256',secret).update(value).digest('base64url');}
export function createSession(secret=loadConfig().inspectToken){const issued=Math.floor(Date.now()/1000),csrf=randomBytes(24).toString('base64url'),payload=Buffer.from(JSON.stringify({issued,csrf})).toString('base64url');return `${payload}.${sign(payload,secret)}`;}
export function parseSession(cookie:string|undefined,secret=loadConfig().inspectToken){if(!cookie)return null;const raw=cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);if(!raw)return null;const [payload,sig]=raw.split('.');if(!payload||!sig)return null;const expected=Buffer.from(sign(payload,secret)),actual=Buffer.from(sig);if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;try{const data=JSON.parse(Buffer.from(payload,'base64url').toString());if(typeof data.issued!=='number'||typeof data.csrf!=='string'||Date.now()/1000-data.issued>8*3600)return null;return data as{issued:number;csrf:string};}catch{return null;}}
export function setSession(res:Response,value:string){res.setHeader('Set-Cookie',`${COOKIE}=${value}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);}
export function clearSession(res:Response){res.setHeader('Set-Cookie',`${COOKIE}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);}
export function requireAdmin(req:Request,res:Response,next:NextFunction){const session=parseSession(req.header('cookie'));if(!session){res.redirect('/admin/login');return;}res.locals.session=session;next();}
export function requireCsrf(req:Request,res:Response,next:NextFunction){if(req.body?._csrf!==res.locals.session?.csrf){res.status(403).send('CSRF token không hợp lệ');return;}next();}
