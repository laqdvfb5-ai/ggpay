import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';

const hasDb = Boolean(process.env.DATABASE_URL_TEST);
const app = hasDb ? createApp() : null;

describe.skipIf(!hasDb)('GET /report', () => {
  beforeAll(async () => runMigrations());
  beforeEach(async () => {
    await pool.query('truncate deliveries, transactions, raw_events cascade');
    const raw = await pool.query(
      `insert into raw_events(source,headers,body,status)
       values('sepay','{}','{"id": "report-1"}','normalized') returning id`,
    );
    await pool.query(
      `insert into transactions(source,source_event_id,channel,bank_code,account_number,
         direction,amount,occurred_at,received_at,latency_ms,raw_id)
       values('sepay','report-1','api','MBBank','123','in',2000,now(),now(),70000000000,$1)`,
      [raw.rows[0].id],
    );
  });
  afterAll(async () => pool.end());

  it('serialize được aggregate bigint thành JSON number', async () => {
    const response = await request(app!)
      .get('/report')
      .set('Authorization', `Bearer ${process.env.INSPECT_TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.latency[0].n).toBe(1);
    expect(response.body.latency[0].max_ms).toBe(70000000000);
    expect(response.body.fieldCoverage[0].n).toBe(1);
  });
});
