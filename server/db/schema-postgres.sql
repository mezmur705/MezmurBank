-- Mezmurify Supabase (Postgres) schema.
-- Run with: node db/apply-schema.js

create extension if not exists pgcrypto;

create table if not exists public.singers (
    id serial primary key,
    name text not null,
    amharic_name text
);

create unique index if not exists ux_singers_name_lower on public.singers (lower(name));

create table if not exists public.songs (
    id text primary key,
    singer_id int not null references public.singers(id),
    title text not null,
    lyrics text not null,
    language text not null default 'Amharic',
    open_song_id int,
    youtube_video_id varchar(20),
    media_url text,
    open_song_format text,
    view_count int not null default 0,
    like_count int not null default 0,
    love_count int not null default 0,
    haha_count int not null default 0,
    wow_count int not null default 0,
    sad_count int not null default 0,
    angry_count int not null default 0
);

create index if not exists ix_songs_singer_id on public.songs(singer_id);

-- Mirrors dbo.OpenSongIDSequence: new songs get the next free OpenSong-style id.
create sequence if not exists public.open_song_id_seq;
alter table public.songs alter column open_song_id set default nextval('public.open_song_id_seq');

-- Attribution for songs imported from a CC-licensed external source (e.g. WikiMezmur) -
-- shown as a credit link in both apps to satisfy that source's attribution requirement.
alter table public.songs add column if not exists source_name text;
alter table public.songs add column if not exists source_url text;

-- Backs the "New" badge (shown in both apps for 30 days after a song is added). Backfill
-- existing rows to a date well outside that window so they don't all appear "new" the
-- moment this column is introduced; only rows inserted after this point default to now().
alter table public.songs add column if not exists created_at timestamptz;
update public.songs set created_at = '2020-01-01T00:00:00Z' where created_at is null;
alter table public.songs alter column created_at set not null;
alter table public.songs alter column created_at set default now();

-- Auto YouTube search caches its match here first; an admin must confirm it (copying it
-- into youtube_video_id) before it's treated as the song's real video and shown to everyone.
alter table public.songs add column if not exists youtube_suggested_id varchar(20);

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    role text not null default 'user' check (role in ('user', 'moderator', 'admin'))
);

create table if not exists public.song_comments (
    id serial primary key,
    song_id text not null references public.songs(id) on delete cascade,
    author text not null,
    comment text not null,
    created_at timestamptz not null default now(),
    user_id uuid references public.profiles(id)
);

create index if not exists ix_song_comments_song_id on public.song_comments(song_id);

create table if not exists public.favorites (
    user_id uuid not null references public.profiles(id) on delete cascade,
    song_id text not null references public.songs(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, song_id)
);

create table if not exists public.push_tokens (
    id serial primary key,
    user_id uuid references public.profiles(id) on delete cascade,
    device_token text not null unique,
    platform text not null check (platform in ('ios', 'android')),
    created_at timestamptz not null default now()
);

create table if not exists public.recently_viewed (
    user_id uuid not null references public.profiles(id) on delete cascade,
    song_id text not null references public.songs(id) on delete cascade,
    viewed_at timestamptz not null default now(),
    primary key (user_id, song_id)
);

create index if not exists ix_recently_viewed_user_viewed_at
    on public.recently_viewed(user_id, viewed_at desc);

-- The admin-curated set list for a given Sunday service. One shared list per date
-- (not per-user); position controls display/export order within that date and is
-- reassigned whenever a song is added, reordered, or removed from it. Admins can plan
-- up to a month of upcoming Sundays ahead; everyone else can only add to the nearest one.
create table if not exists public.sunday_songs (
    id serial primary key,
    song_id text not null references public.songs(id) on delete cascade,
    position int not null,
    added_at timestamptz not null default now()
);

alter table public.sunday_songs add column if not exists sunday_date date;

-- Backfill pre-existing rows (from before multi-week support) onto whatever the nearest
-- upcoming Sunday was at migration time, so the list already being built stays intact.
update public.sunday_songs
set sunday_date = current_date + ((7 - extract(dow from current_date)::int) % 7)
where sunday_date is null;
alter table public.sunday_songs alter column sunday_date set not null;

drop index if exists ux_sunday_songs_song_id;
create unique index if not exists ux_sunday_songs_song_date on public.sunday_songs(song_id, sunday_date);
create index if not exists ix_sunday_songs_date_position on public.sunday_songs(sunday_date, position);

-- Auto-creates a profiles row the moment a user first authenticates (via OAuth), since
-- profiles.id is a strict FK that favorites/comments/recently_viewed all depend on, and
-- there is no profiles_self_insert RLS policy for the client to upsert one itself.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Row Level Security

alter table public.singers enable row level security;
alter table public.songs enable row level security;
alter table public.song_comments enable row level security;
alter table public.profiles enable row level security;
alter table public.favorites enable row level security;
alter table public.push_tokens enable row level security;
alter table public.recently_viewed enable row level security;
alter table public.sunday_songs enable row level security;

drop policy if exists singers_public_read on public.singers;
create policy singers_public_read on public.singers for select using (true);

drop policy if exists singers_admin_write on public.singers;
create policy singers_admin_write on public.singers for all
    using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'moderator')))
    with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'moderator')));

drop policy if exists songs_public_read on public.songs;
create policy songs_public_read on public.songs for select using (true);

drop policy if exists songs_admin_write on public.songs;
create policy songs_admin_write on public.songs for all
    using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'moderator')))
    with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'moderator')));

drop policy if exists comments_public_read on public.song_comments;
create policy comments_public_read on public.song_comments for select using (true);

drop policy if exists comments_authed_insert on public.song_comments;
create policy comments_authed_insert on public.song_comments for insert
    with check (auth.uid() is not null);

drop policy if exists comments_admin_delete on public.song_comments;
create policy comments_admin_delete on public.song_comments for delete
    using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'moderator')));

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select using (auth.uid() = id);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update using (auth.uid() = id);

drop policy if exists favorites_owner_all on public.favorites;
create policy favorites_owner_all on public.favorites for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists push_tokens_owner_all on public.push_tokens;
create policy push_tokens_owner_all on public.push_tokens for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists recently_viewed_owner_all on public.recently_viewed;
create policy recently_viewed_owner_all on public.recently_viewed for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists sunday_songs_public_read on public.sunday_songs;
create policy sunday_songs_public_read on public.sunday_songs for select using (true);

drop policy if exists sunday_songs_admin_write on public.sunday_songs;
create policy sunday_songs_admin_write on public.sunday_songs for all
    using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'moderator')))
    with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'moderator')));
