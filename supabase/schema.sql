-- Silverhawk Scoring – Schema lengkap (jalankan di SQL Editor)
create extension if not exists "uuid-ossp";

-- Profil user
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  full_name text,
  avatar_url text,
  wa_number text,
  is_admin boolean default false,
  package_code text, -- 'p1' | 'p2' | null
  package_expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Voucher per akun
create table if not exists public.vouchers (
  id uuid default uuid_generate_v4() primary key,
  code text unique not null,
  package_code text not null check (package_code in ('p1','p2')),
  target_user_id uuid references auth.users,
  target_email text,
  days integer not null default 15,
  used_by uuid references auth.users,
  used_at timestamptz,
  created_by uuid references auth.users,
  created_at timestamptz default now(),
  notes text
);

create table if not exists public.results (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users,
  meta jsonb,
  scores jsonb,
  created_at timestamptz default now()
);

create table if not exists public.uploads (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users,
  bucket text,
  path text,
  file_name text,
  size_bytes bigint,
  created_at timestamptz default now()
);

create table if not exists public.testimonials (
  id uuid default uuid_generate_v4() primary key,
  name text,
  comment text,
  liked boolean default true,
  user_id uuid references auth.users,
  created_at timestamptz default now()
);

create index if not exists idx_uploads_created on public.uploads (created_at);
create index if not exists idx_results_created on public.results (created_at);
create index if not exists idx_vouchers_code on public.vouchers (code);
create index if not exists idx_profiles_email on public.profiles (email);

alter table public.profiles enable row level security;
alter table public.vouchers enable row level security;
alter table public.results enable row level security;
alter table public.uploads enable row level security;
alter table public.testimonials enable row level security;

-- Profiles
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Admin can view all profiles" on public.profiles;

create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id OR email = 'admin@silverhawk.web.id');
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);
create policy "Admin full profiles"
  on public.profiles for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_admin = true or p.email = 'admin@silverhawk.web.id'))
  );

-- Vouchers: user lihat voucher untuk dirinya; admin full
drop policy if exists "Users view own vouchers" on public.vouchers;
drop policy if exists "Admin vouchers" on public.vouchers;
create policy "Users view own vouchers"
  on public.vouchers for select using (
    target_user_id = auth.uid() OR used_by = auth.uid() OR
    exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_admin or p.email = 'admin@silverhawk.web.id'))
  );
create policy "Admin manage vouchers"
  on public.vouchers for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_admin or p.email = 'admin@silverhawk.web.id'))
  );

-- Results / uploads
drop policy if exists "Users can insert own results" on public.results;
drop policy if exists "Users can view own results" on public.results;
create policy "Users can insert own results"
  on public.results for insert with check (auth.uid() = user_id);
create policy "Users can view own results"
  on public.results for select using (auth.uid() = user_id);

-- Testimonials public read
drop policy if exists "Public read testimonials" on public.testimonials;
drop policy if exists "Anyone insert testimonials" on public.testimonials;
create policy "Public read testimonials" on public.testimonials for select using (true);
create policy "Anyone insert testimonials" on public.testimonials for insert with check (true);

-- Trigger: buat profile otomatis saat signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', ''),
    lower(new.email) = 'admin@silverhawk.web.id'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    is_admin = (lower(excluded.email) = 'admin@silverhawk.web.id'),
    updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
