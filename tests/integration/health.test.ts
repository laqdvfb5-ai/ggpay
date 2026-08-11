import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';

const hasDb = Boolean(process.env.DATABASE_URL_TEST);
const app = hasDb ? createApp() : null;

describe.skipIf(!hasDb)('GET /health', () => {
  beforeAll(async () => runMigrations());
  afterAll(async () => pool.end());

  it('chỉ báo ok khi truy vấn được PostgreSQL', async () => {
    const response = await request(app!).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, database: 'ok' });
  });
});
