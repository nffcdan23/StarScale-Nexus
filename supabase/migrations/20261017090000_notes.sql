-- StarScale Nexus: notes.
--
-- A note has a title and a formatted document (structured JSON from the
-- editor, never HTML). Its searchable plain text is computed here, by the
-- database, from that document on every write: nobody can write it
-- directly, so it can never disagree with the note. The database also checks
-- the document's shape, its size and its links.
--
-- Access is exactly as for tasks: only the owner, only with an authenticator
-- code, only their own rows, no deletion (archive instead), and column-by-
-- column permissions so the owner, revision and timestamps cannot be chosen.
-- The TV gains nothing, and tv_summary() is not changed.
--
-- A context is optional: a note without one is shown as Uncategorised. When a
-- context is set it must belong to the same owner.

-- ---------------------------------------------------------------------------
-- Plain text from a document: the text of every text node, with line breaks
-- between blocks (paragraphs, headings, list items). Independent of the
-- editor's node names.
-- ---------------------------------------------------------------------------

create function private.note_text(node jsonb, depth integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_child jsonb;
  v_parts text[] := '{}';
  v_inline boolean := true;
begin
  if depth > 60 then
    raise exception 'note content is nested too deeply' using errcode = '23514';
  end if;
  if jsonb_typeof(node) <> 'object' then
    return '';
  end if;
  if node ->> 'type' = 'text' then
    return coalesce(node ->> 'text', '');
  end if;
  if node ->> 'type' = 'hardBreak' then
    return E'\n';
  end if;
  if jsonb_typeof(node -> 'content') = 'array' then
    for v_child in select value from jsonb_array_elements(node -> 'content') loop
      if coalesce(v_child ->> 'type', '') not in ('text', 'hardBreak') then
        v_inline := false;
      end if;
      v_parts := v_parts || private.note_text(v_child, depth + 1);
    end loop;
  end if;
  -- Text inside one paragraph joins directly; blocks go on separate lines.
  return array_to_string(v_parts, case when v_inline then '' else E'\n' end);
end;
$$;

revoke all on function private.note_text(jsonb, integer) from public, anon, authenticated;

-- Checks the document, derives the searchable text, and keeps the revision
-- and timestamps truthful whoever writes the row. Runs with the definer's
-- rights only so it can call private.note_text; it reads and changes nothing
-- but the row being written.
create function private.notes_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.content) is distinct from 'object' or new.content ->> 'type' is distinct from 'doc' then
    raise exception 'note content must be a document' using errcode = '23514';
  end if;

  -- Links may only point to web pages or email addresses.
  if jsonb_path_exists(
    new.content,
    '$.** ? (@.type == "link").attrs.href ? (@.type() != "string" || !(@ like_regex "^(https?://|mailto:)" flag "i"))'
  ) then
    raise exception 'note links must start with http://, https:// or mailto:' using errcode = '23514';
  end if;

  new.content_text := btrim(private.note_text(new.content, 0), E' \n');

  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := now();
    new.updated_at := now();
  else
    new.created_at := old.created_at;
    -- Only real edits count: pinning or archiving does not make a note
    -- "recently edited", and does not clash with an edit in progress.
    if new.title is distinct from old.title
      or new.content is distinct from old.content
      or new.context_id is distinct from old.context_id then
      new.revision := old.revision + 1;
      new.updated_at := now();
    else
      new.revision := old.revision;
      new.updated_at := old.updated_at;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.notes_before_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Notes.
-- ---------------------------------------------------------------------------

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  context_id uuid,
  title text not null default '' check (char_length(title) <= 200),
  content jsonb not null default '{"type": "doc", "content": []}'::jsonb
    check (octet_length(content::text) <= 1000000),
  -- Computed by notes_before_write from content; never written by a caller.
  content_text text not null default '' check (char_length(content_text) <= 200000),
  -- For note lists, so they need not load whole notes.
  preview text generated always as (left(content_text, 200)) stored,
  -- Full-text search: title words rank above body words.
  search tsvector generated always as (
    setweight(to_tsvector('english'::regconfig, title), 'A')
    || setweight(to_tsvector('english'::regconfig, content_text), 'B')
  ) stored,
  pinned boolean not null default false,
  -- Raised by every edit, so a save based on an older version can be detected.
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  -- Checked only when a context is set.
  constraint notes_context_same_owner
    foreign key (context_id, owner_id) references public.contexts (id, owner_id)
);

create index notes_search on public.notes using gin (search);

create index notes_owner_active on public.notes (owner_id, pinned desc, updated_at desc)
where archived_at is null;

create trigger notes_before_write
before insert or update on public.notes
for each row execute function private.notes_before_write();

alter table public.notes enable row level security;
revoke all on table public.notes from public, anon, authenticated;

-- No delete: notes are archived, never removed. Not grantable: owner_id,
-- content_text, revision, created_at, updated_at.
grant select on table public.notes to authenticated;
grant insert (id, context_id, title, content, pinned) on table public.notes to authenticated;
grant update (context_id, title, content, pinned, archived_at) on table public.notes to authenticated;

create policy notes_own_rows on public.notes
as permissive for all to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy notes_owner_with_second_factor on public.notes
as restrictive for all to authenticated
using ((select private.is_owner()) and (select auth.jwt() ->> 'aal') = 'aal2')
with check ((select private.is_owner()) and (select auth.jwt() ->> 'aal') = 'aal2');

-- ---------------------------------------------------------------------------
-- Search. Runs with the caller's own rights, so the access rules above still
-- decide what it can see: a TV or an owner without a code finds nothing.
-- Every word also matches as a prefix ("invest" finds "investor"). Snippets
-- mark matches with the private-use characters U+E000 and U+E001, never HTML.
-- The future assistant is meant to search through this same function.
-- ---------------------------------------------------------------------------

create function public.search_notes(
  search_text text,
  include_archived boolean default false,
  context_filter uuid default null
)
returns table (
  id uuid,
  title text,
  context_id uuid,
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
    select n.id, n.title, n.context_id, n.pinned, n.archived_at, n.updated_at, n.content_text,
      ts_rank(n.search, v_query) as rank
    from public.notes n
    where n.search @@ v_query
      and (include_archived or n.archived_at is null)
      and (context_filter is null or n.context_id = context_filter)
    order by ts_rank(n.search, v_query) desc, n.updated_at desc
    limit 50
  ) h
  order by h.rank desc, h.updated_at desc;
end;
$$;

revoke all on function public.search_notes(text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.search_notes(text, boolean, uuid) to authenticated;
