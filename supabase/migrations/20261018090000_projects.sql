-- StarScale Nexus: projects (Phase 4b).
--
-- Projects are the single structure that organises notes, tasks and, later,
-- connected files. A project belongs to its owner, may belong to one of the
-- owner's contexts (life areas), and is archived rather than deleted. Notes
-- and tasks may each belong to one project; a note without a project is in
-- the Inbox.
--
-- Only adds: a new table, two optional columns and a wider search. Existing
-- rows are not changed: every note and task starts without a project.
--
-- Access is exactly as for notes: only the owner, only with an authenticator
-- code, only their own rows, no deletion, column-by-column permissions. A
-- note or task can only point at a project of the same owner. The TV gains
-- nothing, and tv_summary() is not changed, so project names never reach it.
--
-- Moving a note to another project is not an edit: notes_before_write raises
-- the revision only for changes to title, content or context, so a move never
-- clashes with an edit in progress.

-- ---------------------------------------------------------------------------
-- Projects.
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- Optional; when set it must be the same owner's context.
  context_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint projects_context_same_owner
    foreign key (context_id, owner_id) references public.contexts (id, owner_id),
  -- Lets notes and tasks require that their project belongs to the same owner.
  constraint projects_id_owner_unique unique (id, owner_id)
);

-- One active project per name for each owner, ignoring case and outer spaces.
-- An archived project's name can be used again.
create unique index projects_active_name_unique
on public.projects (owner_id, lower(btrim(name)))
where archived_at is null;

create trigger projects_touch_updated_at
before update on public.projects
for each row execute function private.touch_updated_at();

alter table public.projects enable row level security;
revoke all on table public.projects from public, anon, authenticated;

-- No delete: projects are archived, never removed. Not grantable: owner_id,
-- created_at, updated_at.
grant select on table public.projects to authenticated;
grant insert (id, name, context_id) on table public.projects to authenticated;
grant update (name, context_id, archived_at) on table public.projects to authenticated;

create policy projects_own_rows on public.projects
as permissive for all to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy projects_owner_with_second_factor on public.projects
as restrictive for all to authenticated
using ((select private.is_owner()) and (select auth.jwt() ->> 'aal') = 'aal2')
with check ((select private.is_owner()) and (select auth.jwt() ->> 'aal') = 'aal2');

-- ---------------------------------------------------------------------------
-- Notes and tasks may belong to one project of the same owner.
-- ---------------------------------------------------------------------------

alter table public.notes add column project_id uuid;

alter table public.notes
  add constraint notes_project_same_owner
  foreign key (project_id, owner_id) references public.projects (id, owner_id);

create index notes_owner_project on public.notes (owner_id, project_id)
where archived_at is null;

grant insert (project_id) on table public.notes to authenticated;
grant update (project_id) on table public.notes to authenticated;

alter table public.tasks add column project_id uuid;

alter table public.tasks
  add constraint tasks_project_same_owner
  foreign key (project_id, owner_id) references public.projects (id, owner_id);

create index tasks_owner_project on public.tasks (owner_id, project_id)
where archived_at is null;

grant insert (project_id) on table public.tasks to authenticated;
grant update (project_id) on table public.tasks to authenticated;

-- ---------------------------------------------------------------------------
-- Search, with project, Inbox and pinned filters. The earlier version is
-- replaced: every new input has a default, so a call made the earlier way
-- (search text, archived, context) still works, and each result now also
-- says which project the note is in. Still runs with the caller's own
-- rights, so the access rules above decide what it can see.
-- ---------------------------------------------------------------------------

drop function public.search_notes(text, boolean, uuid);

create function public.search_notes(
  search_text text,
  include_archived boolean default false,
  context_filter uuid default null,
  project_filter uuid default null,
  inbox_only boolean default false,
  pinned_only boolean default false
)
returns table (
  id uuid,
  title text,
  context_id uuid,
  project_id uuid,
  pinned boolean,
  archived_at timestamptz,
  updated_at timestamptz,
  snippet text,
  rank real
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_prefixes text;
  v_query tsquery;
begin
  if search_text is null or char_length(search_text) > 200 then
    raise exception 'search_notes: a search is at most 200 characters' using errcode = '22023';
  end if;

  select string_agg(w.word || ':*', ' & ')
  into v_prefixes
  from (
    select m[1] as word
    from regexp_matches(lower(search_text), '([[:alnum:]]+)', 'g') as m
    limit 12
  ) w;
  if v_prefixes is null then
    return;
  end if;

  v_query := websearch_to_tsquery('english'::regconfig, search_text)
    || to_tsquery('english'::regconfig, v_prefixes);

  return query
  select
    h.id,
    h.title,
    h.context_id,
    h.project_id,
    h.pinned,
    h.archived_at,
    h.updated_at,
    ts_headline(
      'english'::regconfig,
      h.content_text,
      v_query,
      'MaxFragments=1, MinWords=6, MaxWords=24, StartSel=' || chr(57344) || ', StopSel=' || chr(57345)
    ),
    h.rank
  from (
    select n.id, n.title, n.context_id, n.project_id, n.pinned, n.archived_at, n.updated_at, n.content_text,
      ts_rank(n.search, v_query) as rank
    from public.notes n
    where n.search @@ v_query
      and (include_archived or n.archived_at is null)
      and (context_filter is null or n.context_id = context_filter)
      and (project_filter is null or n.project_id = project_filter)
      and (not inbox_only or n.project_id is null)
      and (not pinned_only or n.pinned)
    order by ts_rank(n.search, v_query) desc, n.updated_at desc
    limit 50
  ) h
  order by h.rank desc, h.updated_at desc;
end;
$$;

revoke all on function public.search_notes(text, boolean, uuid, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.search_notes(text, boolean, uuid, uuid, boolean, boolean) to authenticated;
