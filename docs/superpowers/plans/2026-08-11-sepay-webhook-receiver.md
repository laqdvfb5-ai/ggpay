# SePay Webhook Receiver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng dịch vụ nhận webhook biến động số dư từ SePay, chuẩn hoá về hợp đồng riêng, và bắn tiếp cho khách — để đo bằng dữ liệu thật xem có nên làm đại lý SePay hay tự xây.

**Architecture:** Một service Node/TypeScript. Pipeline năm chặng: `receiver` xác thực và ghi nguyên văn payload vào `raw_events` rồi mới ack; `normalizer` (hàm thuần, không I/O) đổi payload SePay thành giao dịch chuẩn; `store` ghi vào `transactions` với chống trùng; `dispatcher` bắn webhook ra kèm HMAC; `retry-worker` quét lại các lần giao thất bại. Ghi raw trước khi hiểu là nguyên tắc nền — payload thật chỉ đến một lần.

**Tech Stack:** Node 20+, TypeScript (ESM), Express 5, Postgres (`pg`), Vitest, deploy Render.

## Global Constraints

- Tiền luôn là `bigint` đồng (số nguyên). **Không dùng float ở bất kỳ đâu.** Cột Postgres là `bigint`.
- `normalizer` là hàm thuần: không truy cập DB, không đọc đồng hồ, không sinh UUID. Thời gian nhận và ID do tầng gọi cấp.
- `transactionDate` của SePay là **giờ Việt Nam (UTC+7) không kèm timezone**. Luôn quy về UTC khi lưu.
- Chỉ ack `{"success": true}` **sau khi** ghi `raw_events` thành công. Ghi lỗi → trả 5xx để SePay retry.
- Normalize lỗi → vẫn ack 200. Đó là lỗi phía mình, SePay retry lại cũng ra kết quả y hệt.
- `raw_events` **không** chống trùng — cần quan sát hành vi retry của SePay.
- Không sao chép code mẫu `receiver.php` trong docs SePay: nó nối chuỗi thẳng vào SQL.
- Mọi truy vấn SQL dùng tham số hoá (`$1`, `$2`), không nội suy chuỗi.
- ESM: import nội bộ phải có đuôi `.js` (ví dụ `import { config } from './config.js'`).

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `package.json`, `tsconfig.json`, `.gitignore`, `.env.example` | Scaffold |
| `src/config.ts` | Đọc và kiểm tra biến môi trường |
| `src/db/pool.ts` | Postgres connection pool |
| `src/db/migrate.ts` | Chạy migration theo thứ tự tên file |
| `src/db/migrations/*.sql` | Schema |
| `src/contract.ts` | Kiểu `CanonicalTransaction` |
| `src/receiver/auth.ts` | So sánh token constant-time |
| `src/receiver/routes.ts` | `POST /webhooks/sepay`, `GET /events` |
| `src/normalizer/sepay.ts` | Hàm thuần: payload SePay → giao dịch chuẩn |
| `src/store/rawEvents.ts` | Ghi/đọc `raw_events` |
| `src/store/transactions.ts` | Ghi/đọc `transactions` |
| `src/store/deliveries.ts` | Ghi/đọc `deliveries` |
| `src/dispatcher/hmac.ts` | Ký và verify HMAC |
| `src/dispatcher/dispatch.ts` | Gọi webhook ra ngoài |
| `src/dispatcher/retryWorker.ts` | Vòng lặp quét retry |
| `src/sink/routes.ts` | `POST /test-sink` đóng vai khách |
| `src/report/routes.ts` | `GET /report` — số đo của bài test |
| `src/app.ts`, `src/server.ts` | Ráp và khởi động |
| `tests/fixtures/sepayPayloads.ts` | Payload mẫu dùng chung |
| `render.yaml` | Cấu hình deploy |

Unit test nằm cạnh file nguồn (`*.test.ts`). Integration test nằm trong `tests/integration/` và tự bỏ qua khi chưa đặt `DATABASE_URL_TEST`.

---

# MỐC 1 — Nằm chờ sẵn (Task 1–5)

Mục tiêu: có URL HTTPS chạy 24/7, nhận và lưu được payload, **trước khi** ngân hàng kích hoạt.

---

### Task 1: Scaffold, config, DB pool, bảng `raw_events`

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`
- Create: `src/config.ts`, `src/db/pool.ts`, `src/db/migrate.ts`
- Create: `src/db/migrations/001_raw_events.sql`
- Test: `src/config.test.ts`

**Interfaces:**
- Consumes: không
- Produces: `config` object (`{ port: number, databaseUrl: string, sepayWebhookToken: string, inspectToken: string, outboundUrl: string, outboundSecret: string }`); `pool: pg.Pool`; `runMigrations(): Promise<void>`

- [ ] **Step 1: Tạo `package.json`**

```json
{
  "name": "ezpay-receiver",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "migrate": "tsx src/db/migrate.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^5.0.1",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.10.0",
    "@types/pg": "^8.11.10",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Tạo `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Tạo `.gitignore`**

```
node_modules/
dist/
.env
*.log
```

- [ ] **Step 4: Tạo `.env.example`**

```
PORT=3000
DATABASE_URL=postgres://user:pass@localhost:5432/ezpay
DATABASE_URL_TEST=postgres://user:pass@localhost:5432/ezpay_test
SEPAY_WEBHOOK_TOKEN=doi-thanh-chuoi-ngau-nhien-dai
INSPECT_TOKEN=doi-thanh-chuoi-ngau-nhien-khac
OUTBOUND_WEBHOOK_URL=http://localhost:3000/test-sink
OUTBOUND_WEBHOOK_SECRET=doi-thanh-secret-hmac
```

- [ ] **Step 5: Cài dependencies**

Run: `npm install`
Expected: thư mục `node_modules/` xuất hiện, không có lỗi `ERESOLVE`.

- [ ] **Step 6: Viết test thất bại cho `config`**

Tạo `src/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  const valid = {
    DATABASE_URL: 'postgres://localhost/x',
    SEPAY_WEBHOOK_TOKEN: 'token-a',
    INSPECT_TOKEN: 'token-b',
  };

  it('đọc được các biến bắt buộc', () => {
    const c = loadConfig(valid);
    expect(c.databaseUrl).toBe('postgres://localhost/x');
    expect(c.sepayWebhookToken).toBe('token-a');
    expect(c.inspectToken).toBe('token-b');
  });

  it('port mặc định là 3000', () => {
    expect(loadConfig(valid).port).toBe(3000);
  });

  it('ném lỗi nêu đích danh biến còn thiếu', () => {
    expect(() => loadConfig({ ...valid, SEPAY_WEBHOOK_TOKEN: undefined }))
      .toThrow(/SEPAY_WEBHOOK_TOKEN/);
  });
});
```

- [ ] **Step 7: Chạy test, xác nhận nó fail**

Run: `npm test -- src/config.test.ts`
Expected: FAIL — `Failed to resolve import "./config.js"`.

- [ ] **Step 8: Viết `src/config.ts`**

```ts
import 'dotenv/config';

export interface Config {
  port: number;
  databaseUrl: string;
  sepayWebhookToken: string;
  inspectToken: string;
  outboundUrl: string;
  outboundSecret: string;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  return value;
}

export function loadConfig(env: Env = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: required(env, 'DATABASE_URL'),
    sepayWebhookToken: required(env, 'SEPAY_WEBHOOK_TOKEN'),
    inspectToken: required(env, 'INSPECT_TOKEN'),
    outboundUrl: env.OUTBOUND_WEBHOOK_URL ?? '',
    outboundSecret: env.OUTBOUND_WEBHOOK_SECRET ?? '',
  };
}
```

`loadConfig` nhận `env` làm tham số thay vì đọc thẳng `process.env` để test được mà không phải chọc vào biến toàn cục.

- [ ] **Step 9: Chạy test, xác nhận pass**

Run: `npm test -- src/config.test.ts`
Expected: PASS, 3 test.

- [ ] **Step 10: Viết `src/db/pool.ts`**

```ts
import pg from 'pg';
import { loadConfig } from '../config.js';

// Postgres trả bigint (OID 20) về dạng string để không mất độ chính xác.
// Ép về BigInt để tầng trên luôn làm việc với số nguyên.
pg.types.setTypeParser(20, (value: string) => BigInt(value));

export const pool = new pg.Pool({
  connectionString: loadConfig().databaseUrl,
  max: 5,
});
```

- [ ] **Step 11: Viết `src/db/migrations/001_raw_events.sql`**

```sql
create extension if not exists "pgcrypto";

create table if not exists raw_events (
  id          uuid primary key default gen_random_uuid(),
  source      text        not null,
  received_at timestamptz not null default now(),
  headers     jsonb       not null,
  body        jsonb       not null,
  remote_ip   text,
  status      text        not null default 'stored',
  error       text
);

create index if not exists raw_events_received_at_idx on raw_events (received_at desc);
create index if not exists raw_events_status_idx       on raw_events (status);
```

`remote_ip` để `text` chứ không phải `inet`: Render đặt service sau proxy nên `req.ip` có thể là chuỗi IPv6-mapped mà `inet` từ chối, và ta không muốn ghi log thất bại chỉ vì định dạng IP.

- [ ] **Step 12: Viết `src/db/migrate.ts`**

```ts
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function runMigrations(): Promise<void> {
  await pool.query(`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const { rowCount } = await pool.query(
      'select 1 from schema_migrations where name = $1',
      [file],
    );
    if (rowCount) continue;

    const sql = await readFile(join(migrationsDir, file), 'utf8');
    await pool.query('begin');
    try {
      await pool.query(sql);
      await pool.query('insert into schema_migrations (name) values ($1)', [file]);
      await pool.query('commit');
      console.log(`đã chạy migration: ${file}`);
    } catch (err) {
      await pool.query('rollback');
      throw new Error(`migration ${file} thất bại: ${String(err)}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 13: Chạy migration trên DB cục bộ**

Chuẩn bị `.env` từ `.env.example` với `DATABASE_URL` trỏ vào một Postgres bạn truy cập được (cục bộ hoặc một instance free).

Run: `npm run migrate`
Expected: in ra `đã chạy migration: 001_raw_events.sql`. Chạy lại lần hai thì không in gì (idempotent).

- [ ] **Step 14: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example src/
git commit -m "feat: scaffold service, config, db pool và bảng raw_events"
```

---

### Task 2: Xác thực token

**Files:**
- Create: `src/receiver/auth.ts`
- Test: `src/receiver/auth.test.ts`

**Interfaces:**
- Consumes: không
- Produces: `extractBearer(header: string | undefined): string | null`, `tokensMatch(provided: string | null, expected: string): boolean`

- [ ] **Step 1: Viết test thất bại**

Tạo `src/receiver/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractBearer, tokensMatch } from './auth.js';

describe('extractBearer', () => {
  it('lấy được token từ header đúng định dạng', () => {
    expect(extractBearer('Bearer abc123')).toBe('abc123');
  });

  it('không phân biệt hoa thường ở chữ Bearer', () => {
    expect(extractBearer('bearer abc123')).toBe('abc123');
  });

  it('trả null khi thiếu header', () => {
    expect(extractBearer(undefined)).toBeNull();
  });

  it('trả null khi sai định dạng', () => {
    expect(extractBearer('abc123')).toBeNull();
    expect(extractBearer('Basic abc123')).toBeNull();
  });
});

describe('tokensMatch', () => {
  it('khớp khi hai token giống nhau', () => {
    expect(tokensMatch('secret', 'secret')).toBe(true);
  });

  it('không khớp khi khác nhau', () => {
    expect(tokensMatch('secret', 'other')).toBe(false);
  });

  it('không khớp khi token là null', () => {
    expect(tokensMatch(null, 'secret')).toBe(false);
  });

  it('không khớp khi độ dài khác nhau', () => {
    expect(tokensMatch('short', 'a-much-longer-token')).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- src/receiver/auth.test.ts`
Expected: FAIL — không resolve được `./auth.js`.

- [ ] **Step 3: Viết `src/receiver/auth.ts`**

```ts
import { createHash, timingSafeEqual } from 'node:crypto';

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export function tokensMatch(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  // Băm trước rồi mới so sánh: hai digest luôn dài 32 byte nên timingSafeEqual
  // không ném lỗi, và độ dài token thật không bị lộ qua thời gian phản hồi.
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npm test -- src/receiver/auth.test.ts`
Expected: PASS, 8 test.

- [ ] **Step 5: Commit**

```bash
git add src/receiver/auth.ts src/receiver/auth.test.ts
git commit -m "feat: xác thực bearer token constant-time"
```

---

### Task 3: Ghi `raw_events` và endpoint nhận webhook

**Files:**
- Create: `src/store/rawEvents.ts`, `src/receiver/routes.ts`, `src/app.ts`, `src/server.ts`
- Create: `tests/fixtures/sepayPayloads.ts`
- Test: `tests/integration/receiver.test.ts`

**Interfaces:**
- Consumes: `config`, `pool`, `extractBearer`, `tokensMatch`
- Produces: `insertRawEvent(input: RawEventInput): Promise<string>` trả về `id`; `listRawEvents(limit: number): Promise<RawEventRow[]>`; `createApp(): express.Express`

- [ ] **Step 1: Tạo fixture dùng chung**

Tạo `tests/fixtures/sepayPayloads.ts`:

```ts
export const sepayApiPayload = {
  id: 123456,
  gateway: 'MBBank',
  transactionDate: '2024-05-25 21:11:02',
  accountNumber: '0359123456',
  subAccount: null,
  code: null,
  content: 'Thanh toan QR SE123456',
  description: 'Thanh toan QR SE123456',
  transferType: 'in',
  transferAmount: 1700000,
  referenceCode: 'FT123456789',
  accumulated: 0,
};

export const sepaySmsPayload = {
  ...sepayApiPayload,
  id: 123457,
  gateway: 'Agribank',
  referenceCode: null,
  accumulated: 5000000,
};
```

- [ ] **Step 2: Viết integration test thất bại**

Tạo `tests/integration/receiver.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { sepayApiPayload } from '../fixtures/sepayPayloads.js';

const hasDb = Boolean(process.env.DATABASE_URL_TEST);
const app = hasDb ? createApp() : null;

describe.skipIf(!hasDb)('POST /webhooks/sepay', () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await pool.query('truncate raw_events cascade');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('token đúng → 200 và ghi được raw_events', async () => {
    const res = await request(app!)
      .post('/webhooks/sepay')
      .set('Authorization', `Bearer ${process.env.SEPAY_WEBHOOK_TOKEN}`)
      .send(sepayApiPayload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const { rows } = await pool.query('select * from raw_events');
    expect(rows).toHaveLength(1);
    expect(rows[0].body.id).toBe(123456);
    expect(rows[0].status).toBe('stored');
    expect(rows[0].headers).toHaveProperty('authorization');
  });

  it('token sai → 401 và không ghi gì', async () => {
    const res = await request(app!)
      .post('/webhooks/sepay')
      .set('Authorization', 'Bearer sai-token')
      .send(sepayApiPayload);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    const { rows } = await pool.query('select * from raw_events');
    expect(rows).toHaveLength(0);
  });

  it('thiếu header auth → 401', async () => {
    const res = await request(app!).post('/webhooks/sepay').send(sepayApiPayload);
    expect(res.status).toBe(401);
  });

  it('gửi cùng payload hai lần → hai dòng raw_events', async () => {
    const send = () =>
      request(app!)
        .post('/webhooks/sepay')
        .set('Authorization', `Bearer ${process.env.SEPAY_WEBHOOK_TOKEN}`)
        .send(sepayApiPayload);

    await send();
    await send();

    const { rows } = await pool.query('select * from raw_events');
    expect(rows).toHaveLength(2);
  });
});
```

Cài thêm dev dependency: `npm install -D supertest @types/supertest`

Test dùng `DATABASE_URL_TEST`, nên thêm vào `src/db/pool.ts` — sửa dòng `connectionString`:

```ts
connectionString: process.env.DATABASE_URL_TEST ?? loadConfig().databaseUrl,
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `npm test -- tests/integration/receiver.test.ts`
Expected: FAIL — không resolve được `../../src/app.js`.

- [ ] **Step 4: Viết `src/store/rawEvents.ts`**

```ts
import { pool } from '../db/pool.js';

export interface RawEventInput {
  source: string;
  headers: unknown;
  body: unknown;
  remoteIp: string | null;
}

export interface RawEventRow {
  id: string;
  source: string;
  received_at: Date;
  headers: Record<string, unknown>;
  body: Record<string, unknown>;
  remote_ip: string | null;
  status: string;
  error: string | null;
}

export async function insertRawEvent(input: RawEventInput): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into raw_events (source, headers, body, remote_ip)
     values ($1, $2, $3, $4)
     returning id`,
    [input.source, JSON.stringify(input.headers), JSON.stringify(input.body), input.remoteIp],
  );
  return rows[0].id;
}

export async function markRawEvent(
  id: string,
  status: 'normalized' | 'normalize_failed',
  error: string | null,
): Promise<void> {
  await pool.query('update raw_events set status = $2, error = $3 where id = $1', [
    id,
    status,
    error,
  ]);
}

export async function listRawEvents(limit: number): Promise<RawEventRow[]> {
  const { rows } = await pool.query<RawEventRow>(
    'select * from raw_events order by received_at desc limit $1',
    [limit],
  );
  return rows;
}
```

- [ ] **Step 5: Viết `src/receiver/routes.ts`**

```ts
import { Router } from 'express';
import { loadConfig } from '../config.js';
import { insertRawEvent } from '../store/rawEvents.js';
import { extractBearer, tokensMatch } from './auth.js';

// Dải IP SePay công bố. Giai đoạn này CHỈ cảnh báo, không chặn —
// danh sách có thể đổi mà họ không báo, chặn nhầm là mất giao dịch thật.
const SEPAY_IPS = new Set([
  '172.236.138.20',
  '172.233.83.68',
  '171.244.35.2',
  '151.158.108.68',
  '151.158.109.79',
  '103.255.238.139',
  '2400:8905::2000:8cff:fe98:45cd',
  '2600:3c15::2000:8aff:fedd:874b',
]);

export function receiverRoutes(): Router {
  const router = Router();
  const config = loadConfig();

  router.post('/webhooks/sepay', async (req, res) => {
    const token = extractBearer(req.header('authorization'));
    if (!tokensMatch(token, config.sepayWebhookToken)) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const remoteIp = req.ip ?? null;
    if (remoteIp && !SEPAY_IPS.has(remoteIp.replace(/^::ffff:/, ''))) {
      console.warn(`webhook đến từ IP lạ: ${remoteIp}`);
    }

    let rawId: string;
    try {
      rawId = await insertRawEvent({
        source: 'sepay',
        headers: req.headers,
        body: req.body,
        remoteIp,
      });
    } catch (err) {
      // Chưa ack nên SePay sẽ retry — không mất giao dịch.
      console.error('ghi raw_events thất bại:', err);
      res.status(500).json({ success: false, message: 'storage failed' });
      return;
    }

    console.log(`đã nhận webhook, raw_id=${rawId}`);
    res.json({ success: true });
  });

  return router;
}
```

- [ ] **Step 6: Viết `src/app.ts`**

```ts
import express from 'express';
import { receiverRoutes } from './receiver/routes.js';

export function createApp(): express.Express {
  const app = express();
  // Render đặt service sau proxy; không bật thì req.ip luôn là IP của proxy.
  app.set('trust proxy', true);
  app.use(express.json({ limit: '256kb' }));
  app.use(receiverRoutes());
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}
```

- [ ] **Step 7: Viết `src/server.ts`**

```ts
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { runMigrations } from './db/migrate.js';

const config = loadConfig();

async function main(): Promise<void> {
  await runMigrations();
  createApp().listen(config.port, () => {
    console.log(`đang nghe cổng ${config.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 8: Chạy test, xác nhận pass**

Đặt `DATABASE_URL_TEST` và `SEPAY_WEBHOOK_TOKEN` trong `.env` trước.

Run: `npm test -- tests/integration/receiver.test.ts`
Expected: PASS, 4 test.

- [ ] **Step 9: Commit**

```bash
git add src/ tests/ package.json package-lock.json
git commit -m "feat: endpoint nhận webhook SePay, ghi raw trước khi ack"
```

---

### Task 4: Endpoint soi dữ liệu

**Files:**
- Modify: `src/receiver/routes.ts`
- Test: `tests/integration/events.test.ts`

**Interfaces:**
- Consumes: `listRawEvents`, `config.inspectToken`
- Produces: `GET /events?limit=N` trả `{ count: number, events: RawEventRow[] }`

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/integration/events.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { insertRawEvent } from '../../src/store/rawEvents.js';
import { sepayApiPayload } from '../fixtures/sepayPayloads.js';

const hasDb = Boolean(process.env.DATABASE_URL_TEST);
const app = hasDb ? createApp() : null;

describe.skipIf(!hasDb)('GET /events', () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await pool.query('truncate raw_events cascade');
    await insertRawEvent({
      source: 'sepay',
      headers: {},
      body: sepayApiPayload,
      remoteIp: '1.2.3.4',
    });
  });
  afterAll(async () => {
    await pool.end();
  });

  it('token đúng → trả về danh sách', async () => {
    const res = await request(app!)
      .get('/events')
      .set('Authorization', `Bearer ${process.env.INSPECT_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.events[0].body.id).toBe(123456);
  });

  it('token sai → 401', async () => {
    const res = await request(app!)
      .get('/events')
      .set('Authorization', 'Bearer sai');
    expect(res.status).toBe(401);
  });

  it('không có token → 401', async () => {
    const res = await request(app!).get('/events');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- tests/integration/events.test.ts`
Expected: FAIL — nhận 404 thay vì 200.

- [ ] **Step 3: Thêm route vào `src/receiver/routes.ts`**

Thêm import `listRawEvents`:

```ts
import { insertRawEvent, listRawEvents } from '../store/rawEvents.js';
```

Thêm route ngay trước `return router;`:

```ts
  router.get('/events', async (req, res) => {
    const token = extractBearer(req.header('authorization'));
    if (!tokensMatch(token, config.inspectToken)) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const limit = Math.min(Number(req.query.limit ?? 50), 500);
    const events = await listRawEvents(limit);
    res.json({ count: events.length, events });
  });
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npm test -- tests/integration/events.test.ts`
Expected: PASS, 3 test.

- [ ] **Step 5: Chạy toàn bộ test**

Run: `npm test`
Expected: PASS toàn bộ.

- [ ] **Step 6: Commit**

```bash
git add src/receiver/routes.ts tests/integration/events.test.ts
git commit -m "feat: endpoint GET /events để soi dữ liệu thô"
```

---

### Task 5: Deploy lên Render — hoàn tất Mốc 1

**Files:**
- Create: `render.yaml`, `docs/deploy.md`

**Interfaces:**
- Consumes: toàn bộ Task 1–4
- Produces: URL HTTPS công khai dạng `https://<tên-service>.onrender.com`

- [ ] **Step 1: Tạo `render.yaml`**

```yaml
services:
  - type: web
    name: ezpay-receiver
    runtime: node
    plan: free
    buildCommand: npm ci && npm run build
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: ezpay-db
          property: connectionString
      - key: SEPAY_WEBHOOK_TOKEN
        generateValue: true
      - key: INSPECT_TOKEN
        generateValue: true
      - key: OUTBOUND_WEBHOOK_SECRET
        generateValue: true

databases:
  - name: ezpay-db
    plan: free
```

- [ ] **Step 2: Kiểm tra build cục bộ trước khi deploy**

Run: `npm run build`
Expected: thư mục `dist/` xuất hiện, không có lỗi TypeScript.

- [ ] **Step 3: Đẩy code lên GitHub**

```bash
git add render.yaml
git commit -m "chore: cấu hình deploy Render"
```

Tạo repo private trên GitHub rồi:

```bash
git remote add origin <url-repo-cua-ban>
git push -u origin main
```

- [ ] **Step 4: Tạo service trên Render**

Trên dashboard Render: **New → Blueprint**, trỏ vào repo vừa đẩy. Render đọc `render.yaml`, tạo cả web service lẫn Postgres.

Sau khi deploy xong, vào tab **Environment** copy giá trị `SEPAY_WEBHOOK_TOKEN` và `INSPECT_TOKEN` mà Render sinh ra — cần cho bước sau.

- [ ] **Step 5: Kiểm tra service sống**

Run: `curl https://<tên-service>.onrender.com/health`
Expected: `{"ok":true}`

- [ ] **Step 6: Kiểm tra endpoint webhook từ ngoài**

```bash
curl -i -X POST https://<tên-service>.onrender.com/webhooks/sepay \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SEPAY_WEBHOOK_TOKEN>" \
  -d '{"id":1,"gateway":"MBBank","transactionDate":"2026-08-11 10:00:00","accountNumber":"0359123456","subAccount":null,"code":null,"content":"test","description":"test","transferType":"in","transferAmount":2000,"referenceCode":"FT1","accumulated":100000}'
```

Expected: `HTTP/1.1 200` và body `{"success":true}`.

- [ ] **Step 7: Kiểm tra dữ liệu đã vào DB**

Run: `curl -H "Authorization: Bearer <INSPECT_TOKEN>" https://<tên-service>.onrender.com/events`
Expected: JSON có `count: 1`.

- [ ] **Step 8: Viết `docs/deploy.md`**

Ghi lại: URL service, tên DB trên Render, cách lấy lại token từ tab Environment, và lệnh curl kiểm tra ở Step 6–7. Tài liệu này để bạn tự thao tác lại sau vài tuần mà không phải nhớ.

- [ ] **Step 9: Commit**

```bash
git add docs/deploy.md
git commit -m "docs: hướng dẫn deploy và kiểm tra service"
git push
```

> **MỐC 1 HOÀN TẤT.** Từ đây bạn cấu hình webhook trong dashboard SePay (URL đã deploy, kiểu chứng thực `API Key`, dán `SEPAY_WEBHOOK_TOKEN`) và service sẽ nằm chờ, không bỏ lỡ giao dịch thật đầu tiên. Task 6 trở đi làm trong lúc chờ ngân hàng.

---

# MỐC 2 — Chuẩn hoá và bắn tiếp (Task 6–11)

---

### Task 6: Hợp đồng chuẩn và normalizer

**Files:**
- Create: `src/contract.ts`, `src/normalizer/sepay.ts`
- Test: `src/normalizer/sepay.test.ts`

**Interfaces:**
- Consumes: không (hàm thuần)
- Produces: `CanonicalTransaction` interface; `normalizeSepay(body: Record<string, unknown>): CanonicalTransaction`; `NormalizeError` (có thuộc tính `field: string`); `parseAmountToDong(raw: unknown): bigint`; `parseVnDateTime(raw: unknown): Date`

- [ ] **Step 1: Viết `src/contract.ts`**

```ts
export type Channel = 'api' | 'sms' | 'unknown';
export type Direction = 'in' | 'out';

/**
 * Giao dịch đã chuẩn hoá — hợp đồng nội bộ, độc lập với nhà cung cấp.
 * Không chứa id, received_at hay latency: đó là việc của tầng store,
 * để normalizer giữ được tính thuần khiết.
 */
export interface CanonicalTransaction {
  source: 'sepay';
  sourceEventId: string;
  channel: Channel;
  bankCode: string;
  accountNumber: string;
  subAccount: string | null;
  direction: Direction;
  amount: bigint;
  balanceAfter: bigint | null;
  content: string | null;
  paymentCode: string | null;
  referenceCode: string | null;
  occurredAt: Date;
}
```

- [ ] **Step 2: Viết test thất bại**

Tạo `src/normalizer/sepay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeSepay, parseAmountToDong, parseVnDateTime, NormalizeError } from './sepay.js';
import { sepayApiPayload, sepaySmsPayload } from '../../tests/fixtures/sepayPayloads.js';

describe('parseAmountToDong', () => {
  it('nhận số nguyên', () => {
    expect(parseAmountToDong(1700000)).toBe(1700000n);
  });

  it('nhận chuỗi có phần thập phân bằng không', () => {
    expect(parseAmountToDong('1700000.00')).toBe(1700000n);
  });

  it('nhận chuỗi số nguyên', () => {
    expect(parseAmountToDong('1700000')).toBe(1700000n);
  });

  it('ném lỗi khi phần thập phân khác không — VND không có đơn vị lẻ', () => {
    expect(() => parseAmountToDong('1700000.50')).toThrow(NormalizeError);
  });

  it('ném lỗi khi không phải số', () => {
    expect(() => parseAmountToDong('abc')).toThrow(NormalizeError);
  });
});

describe('parseVnDateTime', () => {
  it('hiểu chuỗi của SePay là giờ Việt Nam và quy về UTC', () => {
    // 21:11:02 giờ VN = 14:11:02 UTC cùng ngày
    expect(parseVnDateTime('2024-05-25 21:11:02').toISOString())
      .toBe('2024-05-25T14:11:02.000Z');
  });

  it('xử lý đúng khi trừ 7 giờ bị lùi sang ngày hôm trước', () => {
    expect(parseVnDateTime('2024-05-25 03:00:00').toISOString())
      .toBe('2024-05-24T20:00:00.000Z');
  });

  it('ném lỗi khi sai định dạng', () => {
    expect(() => parseVnDateTime('25/05/2024')).toThrow(NormalizeError);
  });
});

describe('normalizeSepay', () => {
  it('chuẩn hoá payload kênh API', () => {
    const t = normalizeSepay(sepayApiPayload);
    expect(t.source).toBe('sepay');
    expect(t.sourceEventId).toBe('123456');
    expect(t.channel).toBe('api');
    expect(t.bankCode).toBe('MBBank');
    expect(t.accountNumber).toBe('0359123456');
    expect(t.direction).toBe('in');
    expect(t.amount).toBe(1700000n);
    expect(t.referenceCode).toBe('FT123456789');
    expect(t.content).toBe('Thanh toan QR SE123456');
  });

  it('referenceCode null → suy ra kênh SMS', () => {
    expect(normalizeSepay(sepaySmsPayload).channel).toBe('sms');
  });

  it('accumulated = 0 cho ra 0n chứ không phải null', () => {
    expect(normalizeSepay(sepayApiPayload).balanceAfter).toBe(0n);
  });

  it('accumulated vắng mặt cho ra null', () => {
    const { accumulated, ...rest } = sepayApiPayload;
    expect(normalizeSepay(rest).balanceAfter).toBeNull();
  });

  it('transferType out → direction out', () => {
    expect(normalizeSepay({ ...sepayApiPayload, transferType: 'out' }).direction).toBe('out');
  });

  it('các trường tuỳ chọn null thì không nổ', () => {
    const t = normalizeSepay({
      ...sepayApiPayload,
      content: null,
      subAccount: null,
      code: null,
    });
    expect(t.content).toBeNull();
    expect(t.subAccount).toBeNull();
    expect(t.paymentCode).toBeNull();
  });

  it('chuỗi rỗng coi như null', () => {
    expect(normalizeSepay({ ...sepayApiPayload, content: '   ' }).content).toBeNull();
  });

  it('thiếu trường bắt buộc → NormalizeError nêu đích danh trường', () => {
    const { transferAmount, ...rest } = sepayApiPayload;
    expect(() => normalizeSepay(rest)).toThrow(/transferAmount/);
  });

  it('transferType lạ → NormalizeError', () => {
    expect(() => normalizeSepay({ ...sepayApiPayload, transferType: 'xxx' }))
      .toThrow(/transferType/);
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `npm test -- src/normalizer/sepay.test.ts`
Expected: FAIL — không resolve được `./sepay.js`.

- [ ] **Step 4: Viết `src/normalizer/sepay.ts`**

```ts
import type { CanonicalTransaction, Channel, Direction } from '../contract.js';

export class NormalizeError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'NormalizeError';
  }
}

function requireField(body: Record<string, unknown>, name: string): unknown {
  const value = body[name];
  if (value === undefined || value === null) {
    throw new NormalizeError(name, `Thiếu trường bắt buộc: ${name}`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

export function parseAmountToDong(raw: unknown): bigint {
  if (typeof raw === 'bigint') return raw;
  const s = String(raw).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new NormalizeError('amount', `Số tiền không đọc được: ${s}`);
  }
  const [intPart, fracPart] = s.split('.');
  if (fracPart && /[1-9]/.test(fracPart)) {
    throw new NormalizeError('amount', `Số tiền có phần lẻ khác 0: ${s}`);
  }
  return BigInt(intPart);
}

const VN_OFFSET_HOURS = 7;

export function parseVnDateTime(raw: unknown): Date {
  const s = String(raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) {
    throw new NormalizeError('transactionDate', `Thời gian không đọc được: ${s}`);
  }
  const [, y, mo, d, h, mi, sec] = m;
  // SePay gửi giờ Việt Nam không kèm timezone. Dùng Date.UTC rồi trừ offset
  // để kết quả không phụ thuộc múi giờ của máy chủ.
  return new Date(Date.UTC(+y, +mo - 1, +d, +h - VN_OFFSET_HOURS, +mi, +sec));
}

export function normalizeSepay(body: Record<string, unknown>): CanonicalTransaction {
  const transferType = requireField(body, 'transferType');
  if (transferType !== 'in' && transferType !== 'out') {
    throw new NormalizeError('transferType', `Giá trị transferType lạ: ${String(transferType)}`);
  }

  const referenceCode = optionalString(body.referenceCode);
  // Giả thuyết cần kiểm chứng bằng dữ liệu thật: giao dịch qua API ngân hàng
  // có mã tham chiếu, giao dịch qua SMS thì không.
  const channel: Channel = referenceCode ? 'api' : 'sms';

  const accumulated = body.accumulated;

  return {
    source: 'sepay',
    sourceEventId: String(requireField(body, 'id')),
    channel,
    bankCode: String(requireField(body, 'gateway')),
    accountNumber: String(requireField(body, 'accountNumber')),
    subAccount: optionalString(body.subAccount),
    direction: transferType as Direction,
    amount: parseAmountToDong(requireField(body, 'transferAmount')),
    balanceAfter:
      accumulated === undefined || accumulated === null ? null : parseAmountToDong(accumulated),
    content: optionalString(body.content),
    paymentCode: optionalString(body.code),
    referenceCode,
    occurredAt: parseVnDateTime(requireField(body, 'transactionDate')),
  };
}
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `npm test -- src/normalizer/sepay.test.ts`
Expected: PASS, 18 test.

- [ ] **Step 6: Commit**

```bash
git add src/contract.ts src/normalizer/
git commit -m "feat: hợp đồng chuẩn và normalizer SePay"
```

---

### Task 7: Bảng `transactions` và nối normalizer vào receiver

**Files:**
- Create: `src/db/migrations/002_transactions.sql`, `src/store/transactions.ts`
- Modify: `src/receiver/routes.ts`
- Test: `tests/integration/normalize.test.ts`

**Interfaces:**
- Consumes: `normalizeSepay`, `CanonicalTransaction`, `markRawEvent`
- Produces: `insertTransaction(tx: CanonicalTransaction, rawId: string, receivedAt: Date): Promise<string | null>` — trả `null` khi trùng

- [ ] **Step 1: Viết `src/db/migrations/002_transactions.sql`**

```sql
create table if not exists transactions (
  id              uuid primary key default gen_random_uuid(),
  source          text        not null,
  source_event_id text        not null,
  channel         text        not null,
  bank_code       text        not null,
  account_number  text        not null,
  sub_account     text,
  direction       text        not null,
  amount          bigint      not null,
  balance_after   bigint,
  content         text,
  payment_code    text,
  reference_code  text,
  occurred_at     timestamptz not null,
  received_at     timestamptz not null,
  latency_ms      integer     not null,
  raw_id          uuid        not null references raw_events(id),
  unique (source, source_event_id)
);

create index if not exists transactions_occurred_at_idx on transactions (occurred_at desc);
create index if not exists transactions_channel_idx     on transactions (channel);
```

- [ ] **Step 2: Viết test thất bại**

Tạo `tests/integration/normalize.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { sepayApiPayload } from '../fixtures/sepayPayloads.js';

const hasDb = Boolean(process.env.DATABASE_URL_TEST);
const app = hasDb ? createApp() : null;
const auth = () => `Bearer ${process.env.SEPAY_WEBHOOK_TOKEN}`;

describe.skipIf(!hasDb)('chuẩn hoá khi nhận webhook', () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await pool.query('truncate transactions, raw_events cascade');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('payload hợp lệ → ghi transactions và đánh dấu raw là normalized', async () => {
    await request(app!).post('/webhooks/sepay').set('Authorization', auth()).send(sepayApiPayload);

    const { rows } = await pool.query('select * from transactions');
    expect(rows).toHaveLength(1);
    expect(rows[0].source_event_id).toBe('123456');
    expect(rows[0].amount).toBe(1700000n);
    expect(rows[0].channel).toBe('api');
    expect(rows[0].latency_ms).toBeGreaterThan(0);

    const raws = await pool.query('select status from raw_events');
    expect(raws.rows[0].status).toBe('normalized');
  });

  it('gửi hai lần → 1 transaction, 2 raw_events', async () => {
    const send = () =>
      request(app!).post('/webhooks/sepay').set('Authorization', auth()).send(sepayApiPayload);
    await send();
    await send();

    expect((await pool.query('select * from transactions')).rows).toHaveLength(1);
    expect((await pool.query('select * from raw_events')).rows).toHaveLength(2);
  });

  it('payload hỏng → vẫn ack 200, raw đánh dấu normalize_failed', async () => {
    const res = await request(app!)
      .post('/webhooks/sepay')
      .set('Authorization', auth())
      .send({ id: 1, gateway: 'MBBank' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const raws = await pool.query('select status, error from raw_events');
    expect(raws.rows[0].status).toBe('normalize_failed');
    expect(raws.rows[0].error).toMatch(/transferType/);
    expect((await pool.query('select * from transactions')).rows).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `npm test -- tests/integration/normalize.test.ts`
Expected: FAIL — bảng `transactions` chưa có, hoặc không có dòng nào được ghi.

- [ ] **Step 4: Viết `src/store/transactions.ts`**

```ts
import { pool } from '../db/pool.js';
import type { CanonicalTransaction } from '../contract.js';

export async function insertTransaction(
  tx: CanonicalTransaction,
  rawId: string,
  receivedAt: Date,
): Promise<string | null> {
  const latencyMs = receivedAt.getTime() - tx.occurredAt.getTime();

  const { rows } = await pool.query<{ id: string }>(
    `insert into transactions (
       source, source_event_id, channel, bank_code, account_number, sub_account,
       direction, amount, balance_after, content, payment_code, reference_code,
       occurred_at, received_at, latency_ms, raw_id
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (source, source_event_id) do nothing
     returning id`,
    [
      tx.source,
      tx.sourceEventId,
      tx.channel,
      tx.bankCode,
      tx.accountNumber,
      tx.subAccount,
      tx.direction,
      tx.amount.toString(),
      tx.balanceAfter === null ? null : tx.balanceAfter.toString(),
      tx.content,
      tx.paymentCode,
      tx.referenceCode,
      tx.occurredAt,
      receivedAt,
      latencyMs,
      rawId,
    ],
  );

  // Không có dòng trả về nghĩa là đã tồn tại — SePay gửi lại.
  return rows[0]?.id ?? null;
}
```

- [ ] **Step 5: Nối vào `src/receiver/routes.ts`**

Thêm import:

```ts
import { insertRawEvent, listRawEvents, markRawEvent } from '../store/rawEvents.js';
import { insertTransaction } from '../store/transactions.js';
import { normalizeSepay } from '../normalizer/sepay.js';
```

Thay đoạn từ `console.log(\`đã nhận webhook...\`)` tới hết handler bằng:

```ts
    // Đã ghi raw an toàn. Từ đây lỗi là lỗi phía mình, SePay retry cũng
    // cho kết quả y hệt — nên luôn ack 200 và tự đi sửa.
    res.json({ success: true });

    try {
      const tx = normalizeSepay(req.body);
      const txId = await insertTransaction(tx, rawId, new Date());
      await markRawEvent(rawId, 'normalized', null);
      console.log(`raw_id=${rawId} → transaction_id=${txId ?? 'trùng, bỏ qua'}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markRawEvent(rawId, 'normalize_failed', message);
      console.error(`chuẩn hoá thất bại raw_id=${rawId}: ${message}`);
    }
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `npm test -- tests/integration/normalize.test.ts`
Expected: PASS, 3 test.

- [ ] **Step 7: Chạy toàn bộ test**

Run: `npm test`
Expected: PASS toàn bộ.

- [ ] **Step 8: Commit**

```bash
git add src/ tests/
git commit -m "feat: chuẩn hoá payload vào bảng transactions, chống trùng theo source_event_id"
```

---

### Task 8: Ký HMAC

**Files:**
- Create: `src/dispatcher/hmac.ts`
- Test: `src/dispatcher/hmac.test.ts`

**Interfaces:**
- Consumes: không
- Produces: `signPayload(body: string, timestamp: string, secret: string): string`; `verifySignature(body: string, timestamp: string, secret: string, signature: string): boolean`

- [ ] **Step 1: Viết test thất bại**

Tạo `src/dispatcher/hmac.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { signPayload, verifySignature } from './hmac.js';

const body = '{"a":1}';
const ts = '1754899200';
const secret = 'my-secret';

describe('signPayload', () => {
  it('cho ra hex 64 ký tự', () => {
    expect(signPayload(body, ts, secret)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cùng đầu vào cho cùng chữ ký', () => {
    expect(signPayload(body, ts, secret)).toBe(signPayload(body, ts, secret));
  });

  it('đổi timestamp thì chữ ký đổi — chống replay', () => {
    expect(signPayload(body, ts, secret)).not.toBe(signPayload(body, '1754899201', secret));
  });

  it('đổi body thì chữ ký đổi', () => {
    expect(signPayload(body, ts, secret)).not.toBe(signPayload('{"a":2}', ts, secret));
  });
});

describe('verifySignature', () => {
  it('chấp nhận chữ ký đúng', () => {
    expect(verifySignature(body, ts, secret, signPayload(body, ts, secret))).toBe(true);
  });

  it('từ chối chữ ký sai', () => {
    expect(verifySignature(body, ts, secret, 'f'.repeat(64))).toBe(false);
  });

  it('từ chối chữ ký sai độ dài mà không ném lỗi', () => {
    expect(verifySignature(body, ts, secret, 'abc')).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- src/dispatcher/hmac.test.ts`
Expected: FAIL — không resolve được `./hmac.js`.

- [ ] **Step 3: Viết `src/dispatcher/hmac.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Ký trên `timestamp.body` chứ không chỉ body: nếu chỉ ký body thì kẻ tấn công
 * bắt được một request hợp lệ có thể phát lại vô hạn.
 */
export function signPayload(body: string, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function verifySignature(
  body: string,
  timestamp: string,
  secret: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signPayload(body, timestamp, secret), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npm test -- src/dispatcher/hmac.test.ts`
Expected: PASS, 7 test.

- [ ] **Step 5: Commit**

```bash
git add src/dispatcher/hmac.ts src/dispatcher/hmac.test.ts
git commit -m "feat: ký HMAC cho webhook đi ra"
```

---

### Task 9: Dispatcher và test-sink

**Files:**
- Create: `src/db/migrations/003_deliveries.sql`, `src/store/deliveries.ts`
- Create: `src/dispatcher/dispatch.ts`, `src/sink/routes.ts`
- Modify: `src/receiver/routes.ts`, `src/app.ts`
- Test: `tests/integration/dispatch.test.ts`

**Interfaces:**
- Consumes: `signPayload`, `verifySignature`, `config.outboundUrl`, `config.outboundSecret`
- Produces: `deliver(transactionId: string): Promise<void>`; `POST /test-sink`

- [ ] **Step 1: Viết `src/db/migrations/003_deliveries.sql`**

```sql
create table if not exists deliveries (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid        not null references transactions(id),
  url            text        not null,
  attempt        integer     not null default 0,
  status_code    integer,
  error          text,
  next_retry_at  timestamptz,
  delivered_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists deliveries_pending_idx
  on deliveries (next_retry_at)
  where delivered_at is null;
```

- [ ] **Step 2: Viết test thất bại**

Tạo `tests/integration/dispatch.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { signPayload, verifySignature } from '../../src/dispatcher/hmac.js';
import { sepayApiPayload } from '../fixtures/sepayPayloads.js';

const hasDb = Boolean(process.env.DATABASE_URL_TEST);
const app = hasDb ? createApp() : null;

describe.skipIf(!hasDb)('POST /test-sink', () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await pool.query('truncate deliveries, transactions, raw_events cascade');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('chấp nhận request có chữ ký đúng', async () => {
    const body = JSON.stringify({ hello: 'world' });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signPayload(body, ts, process.env.OUTBOUND_WEBHOOK_SECRET!);

    const res = await request(app!)
      .post('/test-sink')
      .set('Content-Type', 'application/json')
      .set('X-Signature', sig)
      .set('X-Timestamp', ts)
      .send(body);

    expect(res.status).toBe(200);
  });

  it('từ chối chữ ký sai', async () => {
    const res = await request(app!)
      .post('/test-sink')
      .set('Content-Type', 'application/json')
      .set('X-Signature', 'f'.repeat(64))
      .set('X-Timestamp', String(Math.floor(Date.now() / 1000)))
      .send(JSON.stringify({ hello: 'world' }));

    expect(res.status).toBe(401);
  });
});

describe.skipIf(!hasDb)('giao webhook ra ngoài', () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await pool.query('truncate deliveries, transactions, raw_events cascade');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('nhận webhook → tạo bản ghi deliveries đã giao thành công', async () => {
    await request(app!)
      .post('/webhooks/sepay')
      .set('Authorization', `Bearer ${process.env.SEPAY_WEBHOOK_TOKEN}`)
      .send(sepayApiPayload);

    // Giao diễn ra sau khi ack, chờ một nhịp.
    await new Promise((r) => setTimeout(r, 500));

    const { rows } = await pool.query('select * from deliveries');
    expect(rows).toHaveLength(1);
    expect(rows[0].status_code).toBe(200);
    expect(rows[0].delivered_at).not.toBeNull();
  });

  it('sink trả lỗi → ghi next_retry_at để thử lại', async () => {
    const { rows: raw } = await pool.query(
      `insert into raw_events (source, headers, body) values ('sepay','{}','{}') returning id`,
    );
    const { rows: tx } = await pool.query(
      `insert into transactions (source, source_event_id, channel, bank_code, account_number,
         direction, amount, occurred_at, received_at, latency_ms, raw_id)
       values ('sepay','999','api','MBBank','0359123456','in',2000,now(),now(),100,$1)
       returning id`,
      [raw[0].id],
    );

    const { deliver } = await import('../../src/dispatcher/dispatch.js');
    await deliver(tx[0].id, 'http://127.0.0.1:1/khong-ton-tai');

    const { rows } = await pool.query('select * from deliveries');
    expect(rows).toHaveLength(1);
    expect(rows[0].delivered_at).toBeNull();
    expect(rows[0].next_retry_at).not.toBeNull();
    expect(rows[0].attempt).toBe(1);
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `npm test -- tests/integration/dispatch.test.ts`
Expected: FAIL — route `/test-sink` trả 404.

- [ ] **Step 4: Viết `src/store/deliveries.ts`**

```ts
import { pool } from '../db/pool.js';

// Lịch thử lại, tính bằng giây. Hết dãy thì bỏ vào dead letter.
export const RETRY_SCHEDULE_SECONDS = [10, 60, 300, 1800, 7200, 21600];

export interface DeliveryRow {
  id: string;
  transaction_id: string;
  url: string;
  attempt: number;
  status_code: number | null;
  error: string | null;
  next_retry_at: Date | null;
  delivered_at: Date | null;
}

export async function recordSuccess(
  transactionId: string,
  url: string,
  attempt: number,
  statusCode: number,
): Promise<void> {
  await pool.query(
    `insert into deliveries (transaction_id, url, attempt, status_code, delivered_at)
     values ($1, $2, $3, $4, now())`,
    [transactionId, url, attempt, statusCode],
  );
}

export async function recordFailure(
  transactionId: string,
  url: string,
  attempt: number,
  statusCode: number | null,
  error: string,
): Promise<void> {
  const delay = RETRY_SCHEDULE_SECONDS[attempt - 1];
  const nextRetryAt = delay === undefined ? null : new Date(Date.now() + delay * 1000);

  await pool.query(
    `insert into deliveries (transaction_id, url, attempt, status_code, error, next_retry_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [transactionId, url, attempt, statusCode, error, nextRetryAt],
  );
}

export async function findDue(limit: number): Promise<DeliveryRow[]> {
  const { rows } = await pool.query<DeliveryRow>(
    `select distinct on (transaction_id) *
     from deliveries
     where delivered_at is null and next_retry_at is not null and next_retry_at <= now()
     order by transaction_id, attempt desc
     limit $1`,
    [limit],
  );
  return rows;
}
```

- [ ] **Step 5: Viết `src/dispatcher/dispatch.ts`**

```ts
import { pool } from '../db/pool.js';
import { loadConfig } from '../config.js';
import { signPayload } from './hmac.js';
import { recordFailure, recordSuccess } from '../store/deliveries.js';

async function buildPayload(transactionId: string): Promise<string> {
  const { rows } = await pool.query(
    'select * from transactions where id = $1',
    [transactionId],
  );
  if (rows.length === 0) throw new Error(`không tìm thấy transaction ${transactionId}`);
  const t = rows[0];

  return JSON.stringify({
    event_id: t.id,
    source: t.source,
    channel: t.channel,
    bank_code: t.bank_code,
    account_number: t.account_number,
    sub_account: t.sub_account,
    direction: t.direction,
    // bigint không serialize được sang JSON — trả về dạng chuỗi để khách
    // tự parse mà không mất độ chính xác.
    amount: t.amount.toString(),
    balance_after: t.balance_after === null ? null : t.balance_after.toString(),
    content: t.content,
    payment_code: t.payment_code,
    reference_code: t.reference_code,
    occurred_at: t.occurred_at.toISOString(),
    received_at: t.received_at.toISOString(),
    latency_ms: t.latency_ms,
  });
}

export async function deliver(
  transactionId: string,
  urlOverride?: string,
  attempt = 1,
): Promise<void> {
  const config = loadConfig();
  const url = urlOverride ?? config.outboundUrl;
  if (!url) {
    console.warn('chưa cấu hình OUTBOUND_WEBHOOK_URL, bỏ qua việc giao');
    return;
  }

  const body = await buildPayload(transactionId);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signPayload(body, timestamp, config.outboundSecret);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
        'X-Timestamp': timestamp,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      await recordSuccess(transactionId, url, attempt, res.status);
    } else {
      await recordFailure(transactionId, url, attempt, res.status, `HTTP ${res.status}`);
    }
  } catch (err) {
    await recordFailure(transactionId, url, attempt, null, String(err));
  }
}
```

- [ ] **Step 6: Viết `src/sink/routes.ts`**

```ts
import { Router, raw } from 'express';
import { loadConfig } from '../config.js';
import { verifySignature } from '../dispatcher/hmac.js';

export function sinkRoutes(): Router {
  const router = Router();
  const config = loadConfig();

  // Cần body thô để verify chữ ký — express.json() đã parse mất bản gốc,
  // nên route này tự nhận raw buffer.
  router.post('/test-sink', raw({ type: '*/*' }), (req, res) => {
    const body = (req.body as Buffer).toString('utf8');
    const signature = req.header('x-signature') ?? '';
    const timestamp = req.header('x-timestamp') ?? '';

    if (!verifySignature(body, timestamp, config.outboundSecret, signature)) {
      res.status(401).json({ ok: false, message: 'chữ ký không hợp lệ' });
      return;
    }

    console.log('test-sink nhận được:', body);
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 7: Nối sink vào `src/app.ts`**

```ts
import express from 'express';
import { receiverRoutes } from './receiver/routes.js';
import { sinkRoutes } from './sink/routes.js';

export function createApp(): express.Express {
  const app = express();
  app.set('trust proxy', true);
  // sink phải đăng ký TRƯỚC express.json() để giữ được body thô.
  app.use(sinkRoutes());
  app.use(express.json({ limit: '256kb' }));
  app.use(receiverRoutes());
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}
```

- [ ] **Step 8: Gọi `deliver` sau khi ghi transaction**

Trong `src/receiver/routes.ts`, thêm import:

```ts
import { deliver } from '../dispatcher/dispatch.js';
```

Sửa khối `try` trong handler — sau `markRawEvent(rawId, 'normalized', null)`:

```ts
      const txId = await insertTransaction(tx, rawId, new Date());
      await markRawEvent(rawId, 'normalized', null);
      console.log(`raw_id=${rawId} → transaction_id=${txId ?? 'trùng, bỏ qua'}`);
      // Chỉ giao khi là giao dịch mới. Trùng thì SePay đã gửi lại, không giao lần hai.
      if (txId) await deliver(txId);
```

- [ ] **Step 9: Chạy test, xác nhận pass**

Đặt `OUTBOUND_WEBHOOK_URL=http://127.0.0.1:3000/test-sink` — nhưng vì test dùng supertest chứ không mở cổng thật, đổi thành URL trỏ vào chính app đang chạy. Cách đơn giản nhất: chạy `npm run dev` ở một terminal khác trước khi chạy test này.

Run: `npm test -- tests/integration/dispatch.test.ts`
Expected: PASS, 4 test.

- [ ] **Step 10: Commit**

```bash
git add src/ tests/
git commit -m "feat: dispatcher bắn webhook có HMAC, kèm test-sink và bảng deliveries"
```

---

### Task 10: Retry worker

**Files:**
- Create: `src/dispatcher/retryWorker.ts`
- Modify: `src/server.ts`
- Test: `tests/integration/retry.test.ts`

**Interfaces:**
- Consumes: `findDue`, `deliver`, `RETRY_SCHEDULE_SECONDS`
- Produces: `runRetryPass(): Promise<number>` trả số lần đã thử; `startRetryWorker(intervalMs: number): NodeJS.Timeout`

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/integration/retry.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { runRetryPass } from '../../src/dispatcher/retryWorker.js';

const hasDb = Boolean(process.env.DATABASE_URL_TEST);

describe.skipIf(!hasDb)('runRetryPass', () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await pool.query('truncate deliveries, transactions, raw_events cascade');
  });
  afterAll(async () => {
    await pool.end();
  });

  async function seedFailedDelivery(nextRetryAt: string): Promise<void> {
    const { rows: raw } = await pool.query(
      `insert into raw_events (source, headers, body) values ('sepay','{}','{}') returning id`,
    );
    const { rows: tx } = await pool.query(
      `insert into transactions (source, source_event_id, channel, bank_code, account_number,
         direction, amount, occurred_at, received_at, latency_ms, raw_id)
       values ('sepay','999','api','MBBank','0359123456','in',2000,now(),now(),100,$1)
       returning id`,
      [raw[0].id],
    );
    await pool.query(
      `insert into deliveries (transaction_id, url, attempt, error, next_retry_at)
       values ($1, 'http://127.0.0.1:1/khong-ton-tai', 1, 'lỗi giả lập', $2)`,
      [tx[0].id, nextRetryAt],
    );
  }

  it('thử lại bản ghi đã tới hạn và tăng attempt', async () => {
    await seedFailedDelivery(new Date(Date.now() - 60_000).toISOString());

    const count = await runRetryPass();
    expect(count).toBe(1);

    const { rows } = await pool.query('select * from deliveries order by attempt');
    expect(rows).toHaveLength(2);
    expect(rows[1].attempt).toBe(2);
  });

  it('bỏ qua bản ghi chưa tới hạn', async () => {
    await seedFailedDelivery(new Date(Date.now() + 3_600_000).toISOString());
    expect(await runRetryPass()).toBe(0);
  });

  it('bỏ qua bản ghi đã hết lịch retry', async () => {
    const { rows: raw } = await pool.query(
      `insert into raw_events (source, headers, body) values ('sepay','{}','{}') returning id`,
    );
    const { rows: tx } = await pool.query(
      `insert into transactions (source, source_event_id, channel, bank_code, account_number,
         direction, amount, occurred_at, received_at, latency_ms, raw_id)
       values ('sepay','998','api','MBBank','0359123456','in',2000,now(),now(),100,$1)
       returning id`,
      [raw[0].id],
    );
    await pool.query(
      `insert into deliveries (transaction_id, url, attempt, error, next_retry_at)
       values ($1, 'http://127.0.0.1:1/x', 6, 'lần cuối', null)`,
      [tx[0].id],
    );

    expect(await runRetryPass()).toBe(0);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- tests/integration/retry.test.ts`
Expected: FAIL — không resolve được `retryWorker.js`.

- [ ] **Step 3: Viết `src/dispatcher/retryWorker.ts`**

```ts
import { findDue } from '../store/deliveries.js';
import { deliver } from './dispatch.js';

const BATCH_SIZE = 20;

/**
 * Quét các lần giao thất bại đã tới hạn và thử lại.
 * Trả về số bản ghi đã thử — dùng cho test và cho log.
 */
export async function runRetryPass(): Promise<number> {
  const due = await findDue(BATCH_SIZE);

  for (const row of due) {
    await deliver(row.transaction_id, row.url, row.attempt + 1);
  }

  return due.length;
}

export function startRetryWorker(intervalMs = 30_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    runRetryPass()
      .then((n) => {
        if (n > 0) console.log(`retry worker đã thử lại ${n} bản ghi`);
      })
      .catch((err) => console.error('retry worker lỗi:', err));
  }, intervalMs);

  // Không giữ tiến trình sống chỉ vì cái timer này.
  timer.unref();
  return timer;
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npm test -- tests/integration/retry.test.ts`
Expected: PASS, 3 test.

- [ ] **Step 5: Khởi động worker trong `src/server.ts`**

```ts
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { runMigrations } from './db/migrate.js';
import { startRetryWorker } from './dispatcher/retryWorker.js';

const config = loadConfig();

async function main(): Promise<void> {
  await runMigrations();
  startRetryWorker();
  createApp().listen(config.port, () => {
    console.log(`đang nghe cổng ${config.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Commit**

```bash
git add src/dispatcher/retryWorker.ts src/server.ts tests/integration/retry.test.ts
git commit -m "feat: retry worker quét lại các lần giao thất bại"
```

---

### Task 11: Endpoint báo cáo số đo — hoàn tất Mốc 2

**Files:**
- Create: `src/report/routes.ts`
- Modify: `src/app.ts`
- Test: `tests/integration/report.test.ts`

**Interfaces:**
- Consumes: `config.inspectToken`, `pool`
- Produces: `GET /report` trả `{ latency, fieldCoverage, sepayRetries, normalizeFailures }`

Endpoint này trả lời trực tiếp bốn tiêu chí thành công trong spec.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/integration/report.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';

const hasDb = Boolean(process.env.DATABASE_URL_TEST);
const app = hasDb ? createApp() : null;

describe.skipIf(!hasDb)('GET /report', () => {
  beforeAll(async () => {
    await runMigrations();
    await pool.query('truncate deliveries, transactions, raw_events cascade');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('token sai → 401', async () => {
    const res = await request(app!).get('/report').set('Authorization', 'Bearer sai');
    expect(res.status).toBe(401);
  });

  it('token đúng → trả về đủ bốn nhóm số đo', async () => {
    const res = await request(app!)
      .get('/report')
      .set('Authorization', `Bearer ${process.env.INSPECT_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('latency');
    expect(res.body).toHaveProperty('fieldCoverage');
    expect(res.body).toHaveProperty('sepayRetries');
    expect(res.body).toHaveProperty('normalizeFailures');
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- tests/integration/report.test.ts`
Expected: FAIL — nhận 404.

- [ ] **Step 3: Viết `src/report/routes.ts`**

```ts
import { Router } from 'express';
import { loadConfig } from '../config.js';
import { pool } from '../db/pool.js';
import { extractBearer, tokensMatch } from '../receiver/auth.js';

export function reportRoutes(): Router {
  const router = Router();
  const config = loadConfig();

  router.get('/report', async (req, res) => {
    const token = extractBearer(req.header('authorization'));
    if (!tokensMatch(token, config.inspectToken)) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    // Độ trễ theo kênh — tiêu chí thành công số 1.
    const latency = await pool.query(`
      select channel,
             count(*)                                                        as n,
             round(percentile_cont(0.5)  within group (order by latency_ms))  as p50_ms,
             round(percentile_cont(0.95) within group (order by latency_ms))  as p95_ms,
             max(latency_ms)                                                 as max_ms
      from transactions
      group by channel
    `);

    // Trường nào mất khi đi kênh SMS — tiêu chí thành công số 3.
    const fieldCoverage = await pool.query(`
      select channel,
             count(*)                as n,
             count(reference_code)   as has_reference_code,
             count(balance_after)    as has_balance_after,
             count(content)          as has_content,
             count(payment_code)     as has_payment_code,
             count(sub_account)      as has_sub_account
      from transactions
      group by channel
    `);

    // SePay gửi lại mấy lần, cách nhau bao lâu — tiêu chí thành công số 2.
    const sepayRetries = await pool.query(`
      select body->>'id'                                              as sepay_id,
             count(*)                                                 as deliveries,
             min(received_at)                                         as first_seen,
             max(received_at)                                         as last_seen,
             extract(epoch from (max(received_at) - min(received_at))) as spread_seconds
      from raw_events
      group by body->>'id'
      having count(*) > 1
      order by count(*) desc
      limit 50
    `);

    const normalizeFailures = await pool.query(`
      select id, received_at, error
      from raw_events
      where status = 'normalize_failed'
      order by received_at desc
      limit 50
    `);

    res.json({
      latency: latency.rows,
      fieldCoverage: fieldCoverage.rows,
      sepayRetries: sepayRetries.rows,
      normalizeFailures: normalizeFailures.rows,
    });
  });

  return router;
}
```

- [ ] **Step 4: Nối vào `src/app.ts`**

Thêm import và đăng ký sau `receiverRoutes()`:

```ts
import { reportRoutes } from './report/routes.js';
```

```ts
  app.use(receiverRoutes());
  app.use(reportRoutes());
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `npm test -- tests/integration/report.test.ts`
Expected: PASS, 2 test.

- [ ] **Step 6: Chạy toàn bộ test**

Run: `npm test`
Expected: PASS toàn bộ.

- [ ] **Step 7: Deploy và kiểm tra**

```bash
git add src/ tests/
git commit -m "feat: endpoint /report tổng hợp số đo của bài test"
git push
```

Sau khi Render deploy xong:

Run: `curl -H "Authorization: Bearer <INSPECT_TOKEN>" https://<tên-service>.onrender.com/report`
Expected: JSON có bốn khoá `latency`, `fieldCoverage`, `sepayRetries`, `normalizeFailures`.

- [ ] **Step 8: Cập nhật `docs/deploy.md`**

Thêm mục cách đọc `/report` và ý nghĩa từng nhóm số đo, đối chiếu với mục 10 của spec.

```bash
git add docs/deploy.md
git commit -m "docs: hướng dẫn đọc báo cáo số đo"
git push
```

> **MỐC 2 HOÀN TẤT.**

---

## Sau khi code xong: ma trận chuyển tiền test

Code không trả lời được các câu hỏi trong spec — chuyển tiền thật mới trả lời được.
Chạy đủ bảng này cho **mỗi** tài khoản ngân hàng đã kết nối, rồi đọc `/report`.

| # | Kịch bản | Trả lời câu hỏi nào |
|---|---|---|
| 1 | Chuyển 2.000đ, nội dung `TEST1` | Có ngưỡng số tiền tối thiểu không |
| 2 | Chuyển 50.000đ, nội dung `TEST2` | Đối chiếu với #1 |
| 3 | Nội dung dài đúng 50 ký tự, đánh số từng ký tự | **Nội dung có bị cắt không, còn bao nhiêu ký tự** |
| 4 | Nội dung có dấu tiếng Việt | Bị bỏ dấu hay giữ nguyên |
| 5 | Nội dung bắt đầu bằng `SE123456` | `code` SePay trích có đúng không |
| 6 | Hai giao dịch cùng số tiền cách nhau 10 giây | Có phân biệt được không |
| 7 | Chuyển tiền **đi** | `transferType: "out"` có về không |
| 8 | Nhận từ ngân hàng khác qua NAPAS | Format có khác nội bộ không |
| 9 | Nhận lúc 2h sáng | Độ trễ ban đêm |
| 10 | Tắt service 10 phút rồi bật lại, chuyển tiền lúc đang tắt | **SePay retry mấy lần, cách nhau bao lâu** |

Kịch bản 3 và 10 quan trọng nhất. #3 quyết định mã đơn hàng dài bao nhiêu thì an
toàn. #10 quyết định bạn có cần hàng đợi riêng hay dựa được vào retry của SePay.

Ghi kết quả vào `docs/ket-qua-test.md` và đối chiếu với mục 10 của spec.
