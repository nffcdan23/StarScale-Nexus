-- StarScale Nexus: date-only deadlines.
--
-- A task's deadline is either a calendar date (due_on, no time of day) or an
-- exact moment (due_at, already present), never both. Date-only deadlines
-- have no time zone to get wrong: "due on Friday" stays Friday everywhere.
--
-- Existing rows are unchanged: due_on starts empty for every task. Only the
-- owner, who already holds the second-factor rules on this table, gains the
-- right to set it. The TV gains nothing, and tv_summary() is not changed here.

alter table public.tasks add column due_on date;

alter table public.tasks
  add constraint tasks_one_kind_of_deadline check (due_on is null or due_at is null);

grant insert (due_on) on table public.tasks to authenticated;
grant update (due_on) on table public.tasks to authenticated;
