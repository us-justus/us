-- us onboarding schema
-- tables: verification_records, profiles, profile_photos, storage bucket
create extension if not exists "pgcrypto";

create table if not exists public.verification_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  usn text unique,
  phone_verified boolean not null default false,
  email text,
  email_verified boolean not null default false,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 24),
  age int not null check (age between 18 and 40),
  year text not null check (year in ('1st','2nd','3rd','4th')),
  branch text not null,
  bio text check (char_length(bio) <= 300),
  interests text[] default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  display_order int not null default 0 check (display_order between 0 and 5),
  created_at timestamptz not null default now(),
  unique(profile_id, display_order)
);

create index if not exists idx_profiles_user_id on public.profiles(user_id);
create index if not exists idx_profile_photos_profile_id on public.profile_photos(profile_id);
create index if not exists idx_verification_user_id on public.verification_records(user_id);

create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_verification_updated on public.verification_records;
create trigger trg_verification_updated before update on public.verification_records
for each row execute function public.handle_updated_at();

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
for each row execute function public.handle_updated_at();

alter table public.verification_records enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_photos enable row level security;

drop policy if exists "own verification select" on public.verification_records;
create policy "own verification select" on public.verification_records
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own verification insert" on public.verification_records;
create policy "own verification insert" on public.verification_records
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "own verification update" on public.verification_records;
create policy "own verification update" on public.verification_records
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own profile select" on public.profiles;
create policy "own profile select" on public.profiles
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "discover profiles select" on public.profiles;
create policy "discover profiles select" on public.profiles
  for select to authenticated using (true);

drop policy if exists "own photos select" on public.profile_photos;
create policy "own photos select" on public.profile_photos
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid())
    or true
  );

drop policy if exists "own photos insert" on public.profile_photos;
create policy "own photos insert" on public.profile_photos
  for insert to authenticated with check (
    exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid())
  );

drop policy if exists "own photos update" on public.profile_photos;
create policy "own photos update" on public.profile_photos
  for update to authenticated using (
    exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid())
  );

drop policy if exists "own photos delete" on public.profile_photos;
create policy "own photos delete" on public.profile_photos
  for delete to authenticated using (
    exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid())
  );

insert into storage.buckets (id, name, public) values ('profile-photos','profile-photos', true)
on conflict (id) do nothing;

drop policy if exists "public read photos" on storage.objects;
create policy "public read photos" on storage.objects for select to anon, authenticated
using (bucket_id = 'profile-photos');

drop policy if exists "own upload photos" on storage.objects;
create policy "own upload photos" on storage.objects for insert to authenticated
with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own update photos" on storage.objects;
create policy "own update photos" on storage.objects for update to authenticated
using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own delete photos" on storage.objects;
create policy "own delete photos" on storage.objects for delete to authenticated
using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
