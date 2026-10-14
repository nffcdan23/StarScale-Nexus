-- StarScale Nexus: the TV summary learns about date-only deadlines.
--
-- Replaces public.tv_summary(). Who may call it is unchanged, word for word:
-- a registered TV sign-in, or the owner with an authenticator code. What it
-- leaves out is unchanged too: completed and archived tasks, tasks hidden
-- from the TV, and tasks in contexts that are archived or not shown on the TV.
--
-- Two changes only:
--   1. Each task also carries due_on (a date with no time). The fields are
--      exactly: title, context, priority, due_on, due_at. Never notes, ids,
--      status or settings.
--   2. Order: by deadline day (London time, so a 00:30 deadline belongs to
--      that day), then priority, then time, then age. Tasks with no deadline
--      come last. At most 50 tasks.
--
-- create or replace keeps the function's owner and its existing permissions;
-- they are stated again below so this file shows them in full.

create or replace function public.tv_summary()
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
            'context', s.context,
            'priority', s.priority,
            'due_on', s.due_on,
            'due_at', s.due_at
          )
          order by s.place
        )
        from (
          select
            t.title,
            c.name as context,
            t.priority,
            t.due_on,
            t.due_at,
            row_number() over (
              order by
                coalesce(t.due_on, (t.due_at at time zone 'Europe/London')::date) nulls last,
                case t.priority when 'high' then 0 when 'medium' then 1 else 2 end,
                t.due_at nulls first,
                t.created_at
            ) as place
          from public.tasks t
          join public.contexts c on c.id = t.context_id
          where t.owner_id = v_owner
            and t.status = 'open'
            and t.archived_at is null
            and not t.hide_from_tv
            and c.show_on_tv
            and c.archived_at is null
          order by place
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
