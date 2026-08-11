create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tenant_api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key_prefix text not null unique,
  secret_hash bytea not null,
  name text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tenant_api_keys_tenant_idx on tenant_api_keys(tenant_id);

create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_number text not null unique,
  bank_code text,
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bank_accounts_tenant_idx on bank_accounts(tenant_id);

create table if not exists tenant_webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references tenants(id) on delete cascade,
  url text not null,
  secret_encrypted text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table transactions add column if not exists tenant_id uuid references tenants(id);
alter table transactions add column if not exists bank_account_id uuid references bank_accounts(id);
alter table transactions add column if not exists routing_status text not null default 'unrouted';

alter table transactions drop constraint if exists transactions_routing_status_check;
alter table transactions add constraint transactions_routing_status_check
  check (routing_status in ('routed', 'unrouted'));

create index if not exists transactions_tenant_occurred_idx
  on transactions(tenant_id, occurred_at desc);
create index if not exists transactions_unrouted_idx
  on transactions(occurred_at desc) where routing_status = 'unrouted';

alter table deliveries add column if not exists tenant_id uuid references tenants(id);
alter table deliveries add column if not exists webhook_id uuid references tenant_webhooks(id);
alter table deliveries add column if not exists event_id uuid default gen_random_uuid();
update deliveries set event_id = gen_random_uuid() where event_id is null;
alter table deliveries alter column event_id set not null;

create index if not exists deliveries_tenant_created_idx
  on deliveries(tenant_id, created_at desc);
create index if not exists deliveries_transaction_webhook_idx
  on deliveries(transaction_id, webhook_id, attempt desc);

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  transaction_id uuid not null unique references transactions(id) on delete cascade,
  metric text not null default 'incoming_transaction',
  occurred_at timestamptz not null default now()
);

create index if not exists usage_events_tenant_month_idx
  on usage_events(tenant_id, occurred_at);
