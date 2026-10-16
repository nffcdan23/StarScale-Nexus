# Security tests

These check who can read, change and run what in the Nexus database. The
results are written to `docs/security-report.md`.

## Two levels, never mixed

| Level | Where it runs | What a pass means |
|---|---|---|
| Simulated (PGlite) | Any computer, nothing to install | The access rules behave correctly in a real PostgreSQL engine with an imitation of Supabase's roles and signed-in user |
| Real Supabase | The Windows PC, against a local Supabase stack | The rules work with Supabase's real sign-in, permissions and Data API |

Only a pass at the real level counts as a security pass. Every check in the
report shows one of: Passed, FAILED, Not executed, Not possible (cannot be
imitated), or Stale (the migrations changed after the real run).

## Simulated checks (works on the MacBook)

```
npm run test:security
```

This applies the migrations to an in-memory database, runs every access
check as each identity, then removes protections one at a time from a copy
of the migrations to prove the checks notice. Nothing is written outside the
project, and nothing leaves the computer.

## Real checks (Windows PC only)

1. Install the Windows-only tools once (`npm run setup:windows`), then start
   the local Supabase stack (`npm run supabase -- start`). It applies `supabase/migrations` and reads
   `supabase/config.toml`, which must keep:
   - `[auth] enable_signup = false`: no public sign-ups (checked by REAL-08).
   - `[auth.mfa.totp] enroll_enabled = true` and `verify_enabled = true`:
     authenticator codes work (checked by REAL-05).
   Changes to `config.toml` take effect only after the stack is stopped and
   started again.
2. Copy `.env.security.example` to `.env.security.local` and fill it in.
3. Run `npm run test:security:real`. The last line gives passed, failed and
   not executed counts out of the total (105 at Phase 3b-1).
4. Commit the updated `docs/security-report.md` and
   `tests/security/real/results.json`, so the results travel back with Git.

The real runner refuses to run against anything but the local computer.
Every expected check is recorded as passed, failed or not executed; if the
run stops early, the checks it never reached are recorded as not executed, so
an older result can never look current.

## Cloud project checks (Windows PC only)

```
npm run test:security:cloud
```

The same access checks and real sign-in checks, plus six checks for the
cloud project only (CLOUD-01 to CLOUD-06: the project's identity, its
sign-in settings, its migration history, a structure comparison with the
verified local database, a restore drill with fictional data, and a final
check that the project is empty again). It runs only on a fully migrated,
empty cloud project, after the owner types the project id, and records its
results separately in `cloud/results.json` and the report's "Cloud" column.
A verified local stack says nothing about the cloud project, and the reverse.
Setup and steps: `docs/cloud-setup.md`.

`pg` and `supabase` are in `tools/windows/package.json`, installed only on
the PC with `npm run setup:windows`. They are never installed on the work
MacBook: the simulated checks do not need them, and the Windows tools refuse
to run on any other system.

## Where things are

- `lib/cases.mjs`: the single list of who may do what. A check may add its
  own records with `setup` (run as administrator after the shared records,
  and rolled back with them).
- `lib/fixtures.mjs`: the made-up people and records the checks use.
- `lib/mutations.mjs`: the protections removed during the self-test.
- `lib/static-checks.mjs`: rules every migration must follow.
- `mock/`: PGlite and the Supabase imitation.
- `real/`: the real-Supabase runner (local stack) and its recorded results.
- `cloud/`: the cloud runner and its recorded results.
- `lib/real-checks.mjs`: the checks and result recording both real runners share.

When a migration adds a table or function, add checks for it to
`lib/cases.mjs` in the same change.
