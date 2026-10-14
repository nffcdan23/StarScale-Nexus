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

1. Start the local Supabase stack. It applies `supabase/migrations` and reads
   `supabase/config.toml`, which must keep:
   - `[auth] enable_signup = false`: no public sign-ups (checked by REAL-08).
   - `[auth.mfa.totp] enroll_enabled = true` and `verify_enabled = true`:
     authenticator codes work (checked by REAL-05).
   Changes to `config.toml` take effect only after the stack is stopped and
   started again.
2. Copy `.env.security.example` to `.env.security.local` and fill it in.
3. Run `npm run test:security:real`. The last line gives passed, failed and
   not executed counts out of the total (104 at Phase 3a).
4. Commit the updated `docs/security-report.md` and
   `tests/security/real/results.json`, so the results travel back with Git.

The real runner refuses to run against anything but the local computer.
Every expected check is recorded as passed, failed or not executed; if the
run stops early, the checks it never reached are recorded as not executed, so
an older result can never look current.

`pg` and `supabase` are in the development dependencies for the PC. Do not
install them on the work MacBook: the simulated checks do not need them.

## Where things are

- `lib/cases.mjs`: the single list of who may do what. A check may add its
  own records with `setup` (run as administrator after the shared records,
  and rolled back with them).
- `lib/fixtures.mjs`: the made-up people and records the checks use.
- `lib/mutations.mjs`: the protections removed during the self-test.
- `lib/static-checks.mjs`: rules every migration must follow.
- `mock/`: PGlite and the Supabase imitation.
- `real/`: the real-Supabase runner and its recorded results.

When a migration adds a table or function, add checks for it to
`lib/cases.mjs` in the same change.
