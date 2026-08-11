import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
const hasDb=Boolean(process.env.DATABASE_URL_TEST),app=hasDb?createApp():null;
describe.skipIf(!hasDb)('admin dashboard',()=>{
 beforeAll(async()=>runMigrations());beforeEach(async()=>pool.query('truncate usage_events,deliveries,transactions,raw_events,tenant_webhooks,bank_accounts,tenant_api_keys,tenants cascade'));afterAll(async()=>pool.end());
 async function login(){const r=await request(app!).post('/admin/login').type('form').send({token:process.env.INSPECT_TOKEN});return r.headers['set-cookie'][0] as string;}
 function csrf(cookie:string){return request(app!).get('/admin').set('Cookie',cookie).then(r=>/name="_csrf" value="([^"]+)"/.exec(r.text)![1]);}
 it('bắt đăng nhập và set cookie bảo mật',async()=>{expect((await request(app!).get('/admin')).status).toBe(302);const cookie=await login();expect(cookie).toContain('HttpOnly');expect(cookie).toContain('Secure');expect(cookie).toContain('SameSite=Strict');});
 it('từ chối form không có CSRF',async()=>{const cookie=await login();expect((await request(app!).post('/admin/tenants').set('Cookie',cookie).type('form').send({name:'A',slug:'a'})).status).toBe(403);});
 it('onboard tenant và chỉ hiển thị API key một lần',async()=>{const cookie=await login(),token=await csrf(cookie);const created=await request(app!).post('/admin/tenants').set('Cookie',cookie).type('form').send({_csrf:token,name:'Pilot',slug:'pilot'});const path=created.headers.location;const tenantId=path.split('/').pop();const key=await request(app!).post(`/admin/tenants/${tenantId}/api-keys`).set('Cookie',cookie).type('form').send({_csrf:token,name:'primary'});const first=await request(app!).get(key.headers.location).set('Cookie',cookie);expect(first.text).toContain('gg_live_');const second=await request(app!).get(key.headers.location).set('Cookie',cookie);expect(second.text).not.toContain('gg_live_');});
});
