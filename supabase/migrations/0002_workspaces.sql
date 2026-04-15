create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  glossary_entries jsonb not null default '[]'::jsonb,
  tm_entries jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_workspaces_user_id on public.workspaces(user_id);
create index if not exists idx_workspaces_updated_at on public.workspaces(updated_at desc);

alter table public.projects add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

create temporary table project_workspace_backfill as
select id as project_id, gen_random_uuid() as workspace_id
from public.projects
where workspace_id is null;

insert into public.workspaces (id, user_id, name, glossary_entries, tm_entries, created_at, updated_at)
select
  backfill.workspace_id,
  projects.user_id,
  projects.name,
  projects.glossary_entries,
  projects.tm_entries,
  projects.created_at,
  projects.updated_at
from public.projects
join project_workspace_backfill as backfill
  on backfill.project_id = projects.id;

update public.projects
set workspace_id = backfill.workspace_id
from project_workspace_backfill as backfill
where public.projects.id = backfill.project_id;

drop table if exists project_workspace_backfill;

alter table public.workspaces enable row level security;

create policy "workspaces_select_own"
  on public.workspaces
  for select
  using (auth.uid() = user_id);

create policy "workspaces_insert_own"
  on public.workspaces
  for insert
  with check (auth.uid() = user_id);

create policy "workspaces_update_own"
  on public.workspaces
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "workspaces_delete_own"
  on public.workspaces
  for delete
  using (auth.uid() = user_id);
