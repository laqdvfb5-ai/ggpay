create table if not exists webhook_tests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  webhook_id uuid not null references tenant_webhooks(id) on delete cascade,
  status_code integer,
  error text,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists webhook_tests_tenant_created_idx on webhook_tests(tenant_id,created_at desc);
