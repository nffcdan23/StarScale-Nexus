-- A small imitation of the parts of Supabase that the Nexus migrations rely
-- on, so they can run inside PGlite on a machine without Supabase.
--
-- It is NOT Supabase. It imitates only:
--   * the anon, authenticated and service_role database roles,
--   * auth.users (ids only), auth.uid() and auth.jwt(),
--   * the way the Data API passes the signed-in user to the database
--     (the request.jwt.claims setting).
-- It does not imitate sign-in, authenticator codes, tokens or the Data API
-- itself. Tests that need those are marked "requires real Supabase".

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;

create table auth.users (
  id uuid primary key
);

create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Deliberately the most permissive starting point Supabase has ever had:
-- every new table and function in the public schema is open to every role.
-- A migration only passes here if it closes those doors itself, so the
-- result does not depend on which defaults a given Supabase version ships.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
