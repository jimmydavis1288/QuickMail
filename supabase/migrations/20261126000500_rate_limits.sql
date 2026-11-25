create table if not exists public.quickmail_rate_limits (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);

alter table public.quickmail_rate_limits enable row level security;
revoke all on public.quickmail_rate_limits from anon, authenticated;

drop policy if exists "No direct rate-limit access" on public.quickmail_rate_limits;
create policy "No direct rate-limit access"
  on public.quickmail_rate_limits for all to anon, authenticated
  using (false) with check (false);

create or replace function public.consume_quickmail_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_count_now integer;
  window_start_now timestamptz := clock_timestamp();
begin
  if p_key_hash !~ '^[0-9a-f]{64}$'
    or p_limit < 1
    or p_limit > 1000
    or p_window_seconds < 1
    or p_window_seconds > 86400 then
    raise exception 'Invalid rate-limit parameters';
  end if;

  insert into public.quickmail_rate_limits as current_limit (key_hash, window_started_at, request_count)
  values (p_key_hash, window_start_now, 1)
  on conflict (key_hash) do update
  set
    window_started_at = case
      when current_limit.window_started_at <=
        window_start_now - make_interval(secs => p_window_seconds)
      then window_start_now
      else current_limit.window_started_at
    end,
    request_count = case
      when current_limit.window_started_at <=
        window_start_now - make_interval(secs => p_window_seconds)
      then 1
      else current_limit.request_count + 1
    end
  returning request_count into request_count_now;

  return request_count_now <= p_limit;
end;
$$;

revoke all on function public.consume_quickmail_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_quickmail_rate_limit(text, integer, integer) to service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'quickmail-delete-rate-limits') then
    perform cron.schedule(
      'quickmail-delete-rate-limits',
      '17 * * * *',
      $job$delete from public.quickmail_rate_limits where window_started_at < now() - interval '1 day'$job$
    );
  end if;
end
$$;
