create table if not exists tenant_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table if not exists tenant_memberships (
  user_id uuid not null references tenant_users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create table if not exists tenant_login_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references tenant_users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tenant_login_tokens_expiry_idx on tenant_login_tokens(expires_at) where consumed_at is null;

create table if not exists sepay_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references tenants(id) on delete cascade,
  sepay_subject text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scopes text not null default '',
  status text not null default 'pending' check (status in ('pending','active','error','disconnected')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sepay_oauth_states (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references tenant_users(id) on delete cascade,
  state_hash bytea not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table bank_accounts add column if not exists source text not null default 'legacy_manual';
alter table bank_accounts add column if not exists sepay_account_id text;
alter table bank_accounts add column if not exists sepay_connection_id uuid references sepay_connections(id) on delete set null;
alter table bank_accounts add column if not exists sepay_webhook_id text;
alter table bank_accounts add column if not exists verified_at timestamptz;
alter table bank_accounts add column if not exists sync_status text not null default 'legacy';
create unique index if not exists bank_accounts_sepay_source_idx
  on bank_accounts(sepay_connection_id,sepay_account_id) where sepay_account_id is not null;
