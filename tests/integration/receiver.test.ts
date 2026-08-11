import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { sepayApiPayload } from '../fixtures/sepayPayloads.js';

const hasDb = Boolean(process.env.DATABASE_URL_TEST);
const app = hasDb ? createApp() : null;
const webhookToken = process.env.SEPAY_WEBHOOK_TOKEN ?? '';

describe.skipIf(!hasDb)('SePay receiver', () => {
  beforeAll(async () => runMigrations());
  beforeEach(async () => {
    await pool.query('truncate deliveries, transactions, raw_events cascade');
  });
  afterAll(async () => pool.end());

  it('ghi raw trước khi ack và chuẩn hoá giao dịch', async () => {
    const response = await request(app!)
      .post('/webhooks/sepay')
      .set('Authorization', `Bearer ${webhookToken}`)
      .send(sepayApiPayload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });

    const raw = await pool.query('select * from raw_events');
    expect(raw.rows).toHaveLength(1);
    expect(raw.rows[0].body.id).toBe(123456);
    expect(raw.rows[0].headers.authorization).toBe('[REDACTED]');
    expect(raw.rows[0].status).toBe('normalized');

    const transactions = await pool.query('select * from transactions');
    expect(transactions.rows).toHaveLength(1);
    expect(transactions.rows[0].source_event_id).toBe('123456');
    expect(transactions.rows[0].amount).toBe(1700000n);
  });

  it('gửi cùng payload hai lần → hai raw event, một transaction', async () => {
    const send = () => request(app!)
      .post('/webhooks/sepay')
      .set('Authorization', `Bearer ${webhookToken}`)
      .send(sepayApiPayload);

    await send();
    await send();

    expect((await pool.query('select * from raw_events')).rows).toHaveLength(2);
    expect((await pool.query('select * from transactions')).rows).toHaveLength(1);
  });

  it('payload hỏng vẫn ack và lưu normalize_failed', async () => {
    const response = await request(app!)
      .post('/webhooks/sepay')
      .set('Authorization', `Bearer ${webhookToken}`)
      .send({ id: 1, gateway: 'MBBank' });

    expect(response.status).toBe(200);
    const raw = await pool.query('select status, error from raw_events');
    expect(raw.rows[0].status).toBe('normalize_failed');
    expect(raw.rows[0].error).toMatch(/transferType/);
  });

  it('token sai bị từ chối trước khi lưu', async () => {
    const response = await request(app!)
      .post('/webhooks/sepay')
      .set('Authorization', 'Bearer sai-token')
      .send(sepayApiPayload);

    expect(response.status).toBe(401);
    expect((await pool.query('select * from raw_events')).rows).toHaveLength(0);
  });
});
