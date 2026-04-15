create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  original_file_name text not null,
  header jsonb not null default '["Source","Target"]'::jsonb,
  glossary_entries jsonb not null default '[]'::jsonb,
  tm_entries jsonb not null default '[]'::jsonb,
  current_segment_id uuid,
  storage_path text,
  segment_count integer not null default 0,
  translated_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.project_segments (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  segment_number integer not null,
  source_text text not null,
  target_text text not null default '',
  status text not null default 'empty' check (status in ('pending', 'translated', 'autofilled', 'fuzzy', 'empty')),
  tm_match_percent integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (project_id, segment_number)
);

create index if not exists idx_projects_user_id on public.projects(user_id);
create index if not exists idx_projects_updated_at on public.projects(updated_at desc);
create index if not exists idx_project_segments_project_id on public.project_segments(project_id);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_segments enable row level security;

create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles
  for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "projects_select_own"
  on public.projects
  for select
  using (auth.uid() = user_id);

create policy "projects_insert_own"
  on public.projects
  for insert
  with check (auth.uid() = user_id);

create policy "projects_update_own"
  on public.projects
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "projects_delete_own"
  on public.projects
  for delete
  using (auth.uid() = user_id);

create policy "project_segments_select_own"
  on public.project_segments
  for select
  using (
    exists (
      select 1
      from public.projects p
      where p.id = project_segments.project_id
        and p.user_id = auth.uid()
    )
  );

create policy "project_segments_insert_own"
  on public.project_segments
  for insert
  with check (
    exists (
      select 1
      from public.projects p
      where p.id = project_segments.project_id
        and p.user_id = auth.uid()
    )
  );

create policy "project_segments_update_own"
  on public.project_segments
  for update
  using (
    exists (
      select 1
      from public.projects p
      where p.id = project_segments.project_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.projects p
      where p.id = project_segments.project_id
        and p.user_id = auth.uid()
    )
  );

create policy "project_segments_delete_own"
  on public.project_segments
  for delete
  using (
    exists (
      select 1
      from public.projects p
      where p.id = project_segments.project_id
        and p.user_id = auth.uid()
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-files',
  'project-files',
  false,
  52428800,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
)
on conflict (id) do nothing;

create policy "project_files_select_own"
  on storage.objects
  for select
  using (
    bucket_id = 'project-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "project_files_insert_own"
  on storage.objects
  for insert
  with check (
    bucket_id = 'project-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "project_files_update_own"
  on storage.objects
  for update
  using (
    bucket_id = 'project-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'project-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "project_files_delete_own"
  on storage.objects
  for delete
  using (
    bucket_id = 'project-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
