-- =====================================================================
--  AmpCloud — schema Supabase
--  Incolla TUTTO questo file in Supabase → SQL Editor → New query → Run.
--  Si può rieseguire senza danni (è idempotente).
--
--  DOPO averlo eseguito, imposta il codice invito (sceglilo lungo!):
--     update public.app_settings set value = 'il-vostro-codice-segreto'
--     where key = 'invite_code';
-- =====================================================================

-- ---------- impostazioni private (codice invito) ----------
create table if not exists public.app_settings (
  key   text primary key,
  value text not null
);
alter table public.app_settings enable row level security;
-- Nessuna policy: dal browser non si legge né si scrive. Solo le funzioni sotto.
revoke all on public.app_settings from anon, authenticated;
insert into public.app_settings (key, value)
values ('invite_code', substr(md5(random()::text || clock_timestamp()::text), 1, 18))
on conflict (key) do nothing;

-- ---------- profili ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));
alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "profiles: lettura per iscritti" on public.profiles;
create policy "profiles: lettura per iscritti" on public.profiles
  for select to authenticated using (true);

-- ---------- registrazione solo con invito ----------
-- Controllo "amichevole" chiamato dal sito prima di registrarsi, per dare
-- messaggi d'errore chiari. Il controllo vero è nel trigger qui sotto.
create or replace function public.check_signup(invite text, username text)
returns text language plpgsql stable security definer set search_path = public as $$
declare code text;
begin
  select value into code from public.app_settings where key = 'invite_code';
  if code is null or code = '' or coalesce(invite, '') <> code then return 'invalid_invite'; end if;
  if coalesce(username, '') !~ '^[[:alnum:]_.-]{2,24}$' then return 'bad_username'; end if;
  if exists (select 1 from public.profiles p where lower(p.username) = lower(check_signup.username)) then
    return 'username_taken';
  end if;
  return 'ok';
end $$;
grant execute on function public.check_signup(text, text) to anon, authenticated;

create or replace function public.before_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare res text;
begin
  res := public.check_signup(new.raw_user_meta_data ->> 'invite', trim(new.raw_user_meta_data ->> 'username'));
  if res <> 'ok' then
    raise exception 'AmpCloud: registrazione rifiutata (%)', res;
  end if;
  -- il codice invito non resta salvato nei metadati dell'utente
  new.raw_user_meta_data := new.raw_user_meta_data - 'invite';
  return new;
end $$;

revoke execute on function public.before_new_user() from public, anon, authenticated;

create or replace function public.after_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, is_admin)
  values (
    new.id,
    trim(new.raw_user_meta_data ->> 'username'),
    not exists (select 1 from public.profiles)  -- il primo iscritto è l'admin
  );
  return new;
end $$;

revoke execute on function public.after_new_user() from public, anon, authenticated;

drop trigger if exists ampcloud_before_new_user on auth.users;
create trigger ampcloud_before_new_user before insert on auth.users
  for each row execute function public.before_new_user();
drop trigger if exists ampcloud_after_new_user on auth.users;
create trigger ampcloud_after_new_user after insert on auth.users
  for each row execute function public.after_new_user();

-- l'admin legge / cambia il codice invito dal sito (menu Opzioni)
create or replace function public.get_invite_code()
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'solo admin'; end if;
  return (select value from public.app_settings where key = 'invite_code');
end $$;

create or replace function public.set_invite_code(code text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'solo admin'; end if;
  if length(coalesce(code, '')) < 6 then raise exception 'codice troppo corto (min 6)'; end if;
  update public.app_settings set value = code where key = 'invite_code';
  return code;
end $$;
revoke execute on function public.get_invite_code() from public, anon;
revoke execute on function public.set_invite_code(text) from public, anon;
grant execute on function public.get_invite_code() to authenticated;
grant execute on function public.set_invite_code(text) to authenticated;

-- ---------- brani ----------
create table if not exists public.tracks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title       text not null check (length(title) between 1 and 200),
  artist      text not null default '' check (length(artist) <= 200),
  album       text not null default '' check (length(album) <= 200),
  duration    real not null default 0,
  bitrate     integer not null default 0,
  sample_rate integer not null default 0,
  channels    smallint not null default 2,
  size        bigint not null default 0,
  format      text not null default '',
  path        text not null unique,
  plays       integer not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.tracks enable row level security;

drop policy if exists "tracks: lettura" on public.tracks;
create policy "tracks: lettura" on public.tracks
  for select to authenticated using (true);
drop policy if exists "tracks: inserimento" on public.tracks;
create policy "tracks: inserimento" on public.tracks
  for insert to authenticated
  with check (owner_id = auth.uid() and path like auth.uid()::text || '/%');
drop policy if exists "tracks: modifica" on public.tracks;
create policy "tracks: modifica" on public.tracks
  for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists "tracks: eliminazione" on public.tracks;
create policy "tracks: eliminazione" on public.tracks
  for delete to authenticated using (owner_id = auth.uid() or public.is_admin());

-- contatore ascolti (chiunque sia iscritto può incrementarlo, di 1)
create or replace function public.count_play(track uuid)
returns integer language sql security definer set search_path = public as $$
  update public.tracks set plays = plays + 1 where id = track and auth.uid() is not null
  returning plays;
$$;
revoke execute on function public.count_play(uuid) from public, anon;
grant execute on function public.count_play(uuid) to authenticated;

-- ---------- playlist condivise ----------
create table if not exists public.playlists (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name       text not null check (length(name) between 1 and 80),
  track_ids  uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.playlists enable row level security;

drop policy if exists "playlists: lettura" on public.playlists;
create policy "playlists: lettura" on public.playlists
  for select to authenticated using (true);
drop policy if exists "playlists: inserimento" on public.playlists;
create policy "playlists: inserimento" on public.playlists
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "playlists: modifica" on public.playlists;
create policy "playlists: modifica" on public.playlists
  for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists "playlists: eliminazione" on public.playlists;
create policy "playlists: eliminazione" on public.playlists
  for delete to authenticated using (owner_id = auth.uid() or public.is_admin());

-- ---------- registro diagnostico (scrivono i browser, legge solo l'admin) ----------
create table if not exists public.client_logs (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid default auth.uid(),
  event      text not null check (length(event) <= 60),
  detail     jsonb not null default '{}',
  user_agent text check (length(user_agent) <= 400)
);
alter table public.client_logs enable row level security;
drop policy if exists "client_logs: scrittura" on public.client_logs;
create policy "client_logs: scrittura" on public.client_logs
  for insert to authenticated with check (user_id = auth.uid() and pg_column_size(detail) < 4000);
drop policy if exists "client_logs: lettura admin" on public.client_logs;
create policy "client_logs: lettura admin" on public.client_logs
  for select to authenticated using (public.is_admin());

-- ---------- storage: bucket privato per i file audio ----------
insert into storage.buckets (id, name, public)
values ('tracks', 'tracks', false)
on conflict (id) do nothing;

drop policy if exists "ampcloud: ascolto" on storage.objects;
create policy "ampcloud: ascolto" on storage.objects
  for select to authenticated using (bucket_id = 'tracks');
drop policy if exists "ampcloud: caricamento" on storage.objects;
create policy "ampcloud: caricamento" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tracks' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "ampcloud: eliminazione" on storage.objects;
create policy "ampcloud: eliminazione" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tracks' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
