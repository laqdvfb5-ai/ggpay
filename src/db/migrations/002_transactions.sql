create table if not exists transactions (
  id uuid primary key default gen_random_uuid(), source text not null, source_event_id text not null,
  channel text not null, bank_code text not null, account_number text not null, sub_account text,
  direction text not null, amount bigint not null, balance_after bigint, content text, payment_code text,
  reference_code text, occurred_at timestamptz not null, received_at timestamptz not null,
  latency_ms integer not null, raw_id uuid not null references raw_events(id), unique(source, source_event_id)
);
create index if not exists transactions_occurred_at_idx on transactions(occurred_at desc);
create index if not exists transactions_channel_idx on transactions(channel);
