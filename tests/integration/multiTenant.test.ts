import { randomBytes } from 'node:crypto';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { addBankAccount,createTenant,issueApiKey } from '../../src/tenant/store.js';
import { sepayApiPayload } from '../fixtures/sepayPayloads.js';

const hasDb=Boolean(process.env.DATABASE_URL_TEST),app=hasDb?createApp():null;
describe.skipIf(!hasDb)('multi-tenant routing',()=>{
 beforeAll(async()=>runMigrations());
 beforeEach(async()=>{await pool.query('truncate usage_events,deliveries,transactions,raw_events,tenant_webhooks,bank_accounts,tenant_api_keys,tenants cascade');});
 afterAll(async()=>pool.end());
 it('route đúng account, meter một lần, cô lập customer API',async()=>{
  const a=await createTenant('Tenant A','tenant-a'),b=await createTenant('Tenant B','tenant-b');
  const ka=await issueApiKey(a.id,'test'),kb=await issueApiKey(b.id,'test');
  await addBankAccount(a.id,{account_number:sepayApiPayload.accountNumber,bank_code:'MBBank'});
  const send=()=>request(app!).post('/webhooks/sepay').set('Authorization',`Apikey ${process.env.SEPAY_WEBHOOK_TOKEN}`).send(sepayApiPayload);
  expect((await send()).status).toBe(200);expect((await send()).status).toBe(200);
  const tx=(await pool.query('select * from transactions')).rows;expect(tx).toHaveLength(1);expect(tx[0].tenant_id).toBe(a.id);expect(tx[0].routing_status).toBe('routed');
  expect((await pool.query('select * from usage_events')).rows).toHaveLength(1);
  const ra=await request(app!).get('/v1/transactions').set('Authorization',`Bearer ${ka.key}`);expect(ra.body.data).toHaveLength(1);
  const rb=await request(app!).get('/v1/transactions').set('Authorization',`Bearer ${kb.key}`);expect(rb.body.data).toHaveLength(0);
  expect((await request(app!).get(`/v1/transactions/${tx[0].id}`).set('Authorization',`Bearer ${kb.key}`)).status).toBe(404);
 });
 it('account chưa map vẫn lưu canonical unrouted',async()=>{
  const payload={...sepayApiPayload,id:987654,accountNumber:'UNMAPPED'};
  expect((await request(app!).post('/webhooks/sepay').set('Authorization',`Apikey ${process.env.SEPAY_WEBHOOK_TOKEN}`).send(payload)).status).toBe(200);
  const tx=(await pool.query('select * from transactions')).rows[0];expect(tx.routing_status).toBe('unrouted');expect(tx.tenant_id).toBeNull();expect((await pool.query('select * from usage_events')).rows).toHaveLength(0);
 });
 it('revoke key có hiệu lực ngay',async()=>{
  const tenant=await createTenant('Tenant','tenant'),key=await issueApiKey(tenant.id,'test');
  expect((await request(app!).get('/v1/transactions').set('Authorization',`Bearer ${key.key}`)).status).toBe(200);
  await pool.query('update tenant_api_keys set revoked_at=now() where id=$1',[key.id]);
  expect((await request(app!).get('/v1/transactions').set('Authorization',`Bearer ${key.key}`)).status).toBe(401);
 });
});
