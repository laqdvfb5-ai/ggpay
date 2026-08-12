import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { inviteOwner } from '../../src/portal/store.js';
import { createTenant } from '../../src/tenant/store.js';
const hasDb=Boolean(process.env.DATABASE_URL_TEST),app=hasDb?createApp():null;
describe.skipIf(!hasDb)('customer portal',()=>{
 beforeAll(async()=>runMigrations());
 beforeEach(async()=>pool.query('truncate sepay_oauth_states,sepay_connections,tenant_login_tokens,tenant_memberships,tenant_users,usage_events,deliveries,transactions,raw_events,tenant_webhooks,bank_accounts,tenant_api_keys,tenants cascade'));
 afterAll(async()=>pool.end());
 it('magic link dùng một lần và tạo cookie bảo mật',async()=>{const tenant=await createTenant('Merchant','merchant'),invite=await inviteOwner(tenant.id,'Owner@Example.com');const login=await request(app!).get('/portal/auth').query({token:invite.token});expect(login.status).toBe(302);const cookie=login.headers['set-cookie'][0] as string;expect(cookie).toContain('HttpOnly');expect(cookie).toContain('Secure');expect(cookie).toContain('SameSite=Lax');expect((await request(app!).get('/portal').set('Cookie',cookie)).text).toContain('Kết nối SePay');expect((await request(app!).get('/portal/auth').query({token:invite.token})).status).toBe(401);});
 it('không cho session tenant này truy cập dữ liệu tenant khác',async()=>{const a=await createTenant('A','a'),b=await createTenant('B','b');await pool.query(`insert into bank_accounts(tenant_id,account_number,source,sync_status) values($1,'111','legacy_manual','legacy'),($2,'222','legacy_manual','legacy')`,[a.id,b.id]);const invite=await inviteOwner(a.id,'a@example.com'),login=await request(app!).get('/portal/auth').query({token:invite.token}),page=await request(app!).get('/portal').set('Cookie',login.headers['set-cookie'][0]);expect(page.text).toContain('111');expect(page.text).not.toContain('222');});
});
