create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(), transaction_id uuid not null references transactions(id),
  url text not null, attempt integer not null default 0, status_code integer, error text,
  next_retry_at timestamptz, delivered_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists deliveries_pending_idx on deliveries(next_retry_at) where delivered_at is null;
