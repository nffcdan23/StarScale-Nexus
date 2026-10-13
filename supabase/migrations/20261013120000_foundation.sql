-- StarScale Nexus: database foundation.
--
-- Contexts, tasks, who may touch them, and the one read-only summary the TV
-- may call. Everything is denied unless this file grants it.
--
-- Written for Supabase (it relies on the auth schema and on the anon and
-- authenticated roles) and kept to plain PostgreSQL otherwise.

-- ---------------------------------------------------------------------------
-- Private schema: never exposed through the Data API.
-- ---------------------------------------------------------------------------

create schema private;
revoke all on schema private from public;

-- Which sign-ins are known to Nexus. A row is added by hand, by the project
-- administrator, when a sign-in is created; nothing in the app can write here.
--   owner: the person Nexus belongs to.
--   tv:    a read-only display, tied to the owner whose summary it shows.
create table private.identities (
  user_id uuid primary key references auth.users (id) on delete cascade,
  kind text not null check (kind in ('owner', 'tv')),
  owner_id uuid references auth.users (id) on delete cascade,
  label text check (label is null or char_length(label) <= 80),
  created_at timestamptz not null default now(),
  constraint identities_tv_has_owner check ((kind = 'tv') = (owner_id is not null))
);

alter table private.identities enable row level security;
revoke all on table private.identities from public, anon, authenticated;

-- True only for a registered owner. Used by the access rules below, so that a
-- TV sign-in can never act as an owner, even if it enrols its own
-- authenticator.
create function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.identities i
    where i.user_id = (select auth.uid())
      and i.kind = 'owner'
  );
$$;

revoke all on function private.is_owner() from public, anon, authenticated;
grant execute on function private.is_owner() to authenticated;

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public, anon, authenticated;

-- Keeps updated_at and completed_at truthful whoever writes the row.
create function private.tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status = 'done' then
    if tg_op = 'UPDATE' and old.completed_at is not null then
      new.completed_at := old.completed_at;
    else
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function private.tasks_before_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Contexts: the areas of life a record belongs to (personal, StarScale...).
-- ---------------------------------------------------------------------------

create table public.contexts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  slug text not null check (slug ~ '^[a-z][a-z0-9-]{0,39}$'),
  -- The TV is treated as public, so a context is hidden from it by default.
  show_on_tv boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint contexts_owner_slug_unique unique (owner_id, slug),
  -- Lets tasks require that their context belongs to the same owner.
  constraint contexts_id_owner_unique unique (id, owner_id)
);

create trigger contexts_touch_updated_at
before update on public.contexts
for each row execute function private.touch_updated_at();

alter table public.contexts enable row level security;
revoke all on table public.contexts from public, anon, authenticated;

-- Column by column, so a caller can never choose the owner or the timestamps.
grant select on table public.contexts to authenticated;
grant insert (id, name, slug, show_on_tv) on table public.contexts to authenticated;
grant update (name, slug, show_on_tv, archived_at) on table public.contexts to authenticated;

create policy contexts_own_rows on public.contexts
as permissive for all to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy contexts_owner_with_second_factor on public.contexts
as restrictive for all to authenticated
using ((select private.is_owner()) and (select auth.jwt() ->> 'aal') = 'aal2')
with check ((select private.is_owner()) and (select auth.jwt() ->> 'aal') = 'aal2');

-- ---------------------------------------------------------------------------
-- Tasks.
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  context_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 10000),
  status text not null default 'open' check (status in ('open', 'done')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_at timestamptz,
  hide_from_tv boolean not null default false,
  -- Who or what created the row. Callers cannot set it; later automations and
  -- integrations will, together with source and external_id, which stop the
  -- same outside item being imported twice.
  origin text not null default 'owner'
    check (origin in ('owner', 'automation', 'assistant', 'integration')),
  source text check (source is null or char_length(source) between 1 and 60),
  external_id text check (external_id is null or char_length(external_id) between 1 and 200),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint tasks_context_same_owner
    foreign key (context_id, owner_id) references public.contexts (id, owner_id),
  constraint tasks_done_has_completed_at check ((status = 'done') = (completed_at is not null)),
  constraint tasks_source_and_external_id_together check ((source is null) = (external_id is null))
);

create unique index tasks_external_item_unique
on public.tasks (owner_id, source, external_id)
where source is not null;

create index tasks_owner_open_due on public.tasks (owner_id, due_at)
where status = 'open' and archived_at is null;

create trigger tasks_before_write
before insert or update on public.tasks
for each row execute function private.tasks_before_write();

alter table public.tasks enable row level security;
revoke all on table public.tasks from public, anon, authenticated;

-- No delete: tasks are archived, never removed.
grant select on table public.tasks to authenticated;
grant insert (id, context_id, title, notes, status, priority, due_at, hide_from_tv)
  on table public.tasks to authenticated;
grant update (context_id, title, notes, status, priority, due_at, hide_from_tv, archived_at)
  on table public.tasks to authenticated;

create policy tasks_own_rows on public.tasks
as permissive for all to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy tasks_owner_with_second_factor on public.tasks
as restrictive for all to authenticated
using ((select private.is_owner()) and (select auth.jwt() ->> 'aal') = 'aal2')
with check ((select private.is_owner()) and (select auth.jwt() ->> 'aal') = 'aal2');

-- ---------------------------------------------------------------------------
-- TV summary: the only thing a TV sign-in can do.
--
-- This is the one function a browser can call that reads past the access
-- rules, so it is kept narrow on purpose: no input, a fixed list of fields,
-- read-only, and callable only by a registered TV (for its owner's data) or
-- by the owner with a second factor. It returns titles and dates, never
-- notes, and leaves out anything hidden from the TV.
-- ---------------------------------------------------------------------------

create function public.tv_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_caller is null then
    raise exception 'tv_summary: not signed in' using errcode = '42501';
  end if;

  select i.owner_id into v_owner
  from private.identities i
  where i.user_id = v_caller
    and i.kind = 'tv';

  if v_owner is null then
    if (select private.is_owner()) and (select auth.jwt() ->> 'aal') = 'aal2' then
      v_owner := v_caller;
    else
      raise exception 'tv_summary: caller is not allowed' using errcode = '42501';
    end if;
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'tasks', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'title', s.title,
            'due_at', s.due_at,
            'priority', s.priority,
            'context', s.context
          )
          order by s.due_at nulls last, s.created_at
        )
        from (
          select t.title, t.due_at, t.priority, c.name as context, t.created_at
          from public.tasks t
          join public.contexts c on c.id = t.context_id
          where t.owner_id = v_owner
            and t.status = 'open'
            and t.archived_at is null
            and not t.hide_from_tv
            and c.show_on_tv
            and c.archived_at is null
          order by t.due_at nulls last, t.created_at
          limit 50
        ) s
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.tv_summary() from public, anon, authenticated;
grant execute on function public.tv_summary() to authenticated;
