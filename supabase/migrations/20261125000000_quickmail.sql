create extension if not exists pg_cron;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.inboxes (
  id uuid primary key default gen_random_uuid(),
  email_address text not null unique,
  access_token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint inbox_expiration_window check (
    expires_at > created_at and expires_at <= created_at + interval '10 minutes 5 seconds'
  )
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  inbox_id uuid not null references public.inboxes(id) on delete cascade,
  sender text not null,
  subject text not null,
  text_body text not null,
  received_at timestamptz not null default now()
);

create index if not exists inboxes_expiration_idx on public.inboxes (expires_at);
create index if not exists messages_inbox_received_idx on public.messages (inbox_id, received_at desc);

alter table public.inboxes enable row level security;
alter table public.messages enable row level security;

revoke all on public.inboxes, public.messages from anon, authenticated;

drop policy if exists "No direct inbox access" on public.inboxes;
create policy "No direct inbox access"
  on public.inboxes for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "No direct message access" on public.messages;
create policy "No direct message access"
  on public.messages for all to anon, authenticated
  using (false) with check (false);

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'quickmail-delete-expired-inboxes') then
    perform cron.schedule(
      'quickmail-delete-expired-inboxes',
      '*/5 * * * *',
      $job$delete from public.inboxes where expires_at <= now()$job$
    );
  end if;
end
$$;
