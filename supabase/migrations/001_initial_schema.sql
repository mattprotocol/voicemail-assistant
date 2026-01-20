-- VoiceMail Assistant Initial Schema
-- Applied: 2026-01-20

-- Gmail OAuth tokens (encrypted storage)
create table gmail_tokens (
  id uuid primary key default gen_random_uuid(),
  account_email text unique not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- Enable RLS (no policies yet - service role only for MVP)
alter table gmail_tokens enable row level security;

-- Triage sessions
create table sessions (
  id uuid primary key default gen_random_uuid(),
  account_email text not null,
  status text not null check (status in ('active', 'paused', 'completed')),
  queue_snapshot jsonb not null default '[]'::jsonb,
  current_index int default 0,
  started_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table sessions enable row level security;

-- Undo stack (15-second window)
create table undo_actions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  action_type text not null check (action_type in ('archive', 'delete', 'star', 'mark_unread')),
  gmail_thread_id text not null,
  reverse_action jsonb not null,
  created_at timestamptz default now(),
  expires_at timestamptz not null
);

alter table undo_actions enable row level security;

-- Indexes for performance
create index sessions_account_status_idx on sessions(account_email, status);
create index undo_actions_session_expires_idx on undo_actions(session_id, expires_at);
