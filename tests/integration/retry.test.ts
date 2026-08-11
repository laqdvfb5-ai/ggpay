import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { findDue } from '../../src/store/deliveries.js';

const hasDb = Boolean(process.env.DATABASE_URL_TEST);

describe.skipIf(!hasDb)('delivery retry selection', () => {
  beforeAll(async () => runMigrations());
  beforeEach(async () => {
    await pool.query('truncate deliveries, transactions, raw_events cascade');
  });
  afterAll(async () => pool.end());

  async function seedTransaction(): Promise<string> {
    const raw = await pool.query(
      `insert into raw_events(source, headers, body) values('sepay', '{}', '{}') returning id`,
    );
    const tx = await pool.query(
      `insert into transactions(
         source, source_event_id, channel, bank_code, account_number, direction,
         amount, occurred_at, received_at, latency_ms, raw_id
       ) values('sepay', 'retry-1', 'api', 'MBBank', '123', 'in', 2000,
         now(), now(), 0, $1) returning id`,
      [raw.rows[0].id],
    );
    return tx.rows[0].id;
  }

  it('chỉ trả lần attempt mới nhất nếu nó đã tới hạn', async () => {
    const transactionId = await seedTransaction();
    await pool.query(
      `insert into deliveries(transaction_id, url, attempt, error, next_retry_at)
       values
       ($1, 'http://example.test', 1, 'lỗi 1', now() - interval '2 minutes'),
       ($1, 'http://example.test', 2, 'lỗi 2', now() - interval '1 minute')`,
      [transactionId],
    );

    const due = await findDue(20);
    expect(due).toHaveLength(1);
    expect(due[0].attempt).toBe(2);
  });

  it('không retry bản cũ khi attempt mới nhất chưa tới hạn', async () => {
    const transactionId = await seedTransaction();
    await pool.query(
      `insert into deliveries(transaction_id, url, attempt, error, next_retry_at)
       values
       ($1, 'http://example.test', 1, 'lỗi 1', now() - interval '2 minutes'),
       ($1, 'http://example.test', 2, 'lỗi 2', now() + interval '10 minutes')`,
      [transactionId],
    );

    expect(await findDue(20)).toHaveLength(0);
  });
});
