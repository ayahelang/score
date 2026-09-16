-- Silverhawk Scoring – Supabase Schema (jalankan di SQL Editor)
-- Free tier compatible

-- Enable necessary extensions
create extension if not exists "uuid-ossp";

-- Users profile (optional, linked to auth.users)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  full_name text,
  avatar_url text,
  is_subscriber boolean default false,
  voucher_code text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Vouchers
create table if not exists public.vouchers (
  id uuid default uuid_generate_v4() primary key,
  code text unique not null,
  used_by uuid references auth.users,
  used_at timestamptz,
  created_at timestamptz default now(),
  notes text
);

-- Results (optional persistence)
create table if not exists public.results (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users,
  meta jsonb,
  scores jsonb,
  created_at timestamptz default now()
);

-- Uploads metadata (untuk auto-clean)
create table if not exists public.uploads (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users,
  bucket text,
  path text,
  file_name text,
  size_bytes bigint,
  created_at timestamptz default now()
);

-- Index for cleanup
create index if not exists idx_uploads_created on public.uploads (created_at);
create index if not exists idx_results_created on public.results (created_at);

-- RLS
alter table public.profiles enable row level security;
alter table public.vouchers enable row level security;
alter table public.results enable row level security;
alter table public.uploads enable row level security;

-- Policies (sederhana – sesuaikan sesuai kebutuhan)
create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "Users can insert own results"
  on public.results for insert with check (auth.uid() = user_id);

create policy "Users can view own results"
  on public.results for select using (auth.uid() = user_id);

-- Storage buckets (buat manual di Dashboard → Storage)
-- 1. answer-keys (public atau private)
-- 2. student-sheets
-- Policy contoh untuk bucket private:
-- allow authenticated upload, only owner read, auto expire via Edge Function

-- Auto-clean function (panggil via Edge Function + cron / pg_cron)
-- Hapus data uploads + results yang lebih dari 7 hari
-- KECUALI user yang is_subscriber = true

/*
Contoh Edge Function (Deno) – create di supabase/functions/cleanup

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Hapus results non-subscriber lama
  await supabase
    .from('results')
    .delete()
    .lt('created_at', sevenDaysAgo)
    .not('user_id', 'in', 
      supabase.from('profiles').select('id').eq('is_subscriber', true)
    )

  // Hapus file storage lama (perlu list dulu)
  // ... implementasi list + remove

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
})
*/

-- Testimonials (publik)
create table if not exists public.testimonials (
  id uuid default uuid_generate_v4() primary key,
  name text,
  comment text,
  liked boolean default true,
  created_at timestamptz default now()
);

alter table public.testimonials enable row level security;

-- Siapa pun bisa baca testimoni
create policy "Public read testimonials"
  on public.testimonials for select using (true);

-- Siapa pun bisa insert (tanpa login) — batasi abuse di production jika perlu
create policy "Public insert testimonials"
  on public.testimonials for insert with check (true);
