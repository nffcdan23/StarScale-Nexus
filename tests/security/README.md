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

## Real checks (Windows PC, later; never yet executed)

1. Install a container tool and the Supabase tool on the PC.
2. Start the local Supabase stack and apply `supabase/migrations` to it, with
   sign-ups switched off.
3. Add the `pg` package (a PostgreSQL client) as a development dependency.
4. Copy `.env.security.example` to `.env.security.local` and fill it in.
5. Run `npm run test:security:real`.
6. Commit the updated `docs/security-report.md` and
   `tests/security/real/results.json`, so the results travel back with Git.

The real runner refuses to run against anything but the local computer. It
was written without a Supabase stack to test it on, so expect to adjust it
on first use.

## Where things are

- `lib/cases.mjs`: the single list of who may do what.
- `lib/fixtures.mjs`: the made-up people and records the checks use.
- `lib/mutations.mjs`: the protections removed during the self-test.
- `lib/static-checks.mjs`: rules every migration must follow.
- `mock/`: PGlite and the Supabase imitation.
- `real/`: the real-Supabase runner and its recorded results.

When a migration adds a table or function, add checks for it to
`lib/cases.mjs` in the same change.
