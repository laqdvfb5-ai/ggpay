create extension if not exists "pgcrypto";
create table if not exists raw_events (
  id uuid primary key default gen_random_uuid(), source text not null,
  received_at timestamptz not null default now(), headers jsonb not null, body jsonb not null,
  remote_ip text, status text not null default 'stored', error text
);
create index if not exists raw_events_received_at_idx on raw_events(received_at desc);
create index if not exists raw_events_status_idx on raw_events(status);
