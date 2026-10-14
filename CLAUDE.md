# StarScale Nexus: project rules for Claude

Read this at the start of every session. It records the owner's standing rules
and the approved plan. The owner is not a professional developer: explain in
plain English, define technical terms, and go one step at a time.

## Hard rules (set by the owner)

- Work only inside this project folder. Do not move or rename it, do not create
  another project folder, and do not read or write files outside it without
  explicit permission.
- Never modify Derwent, Veyra or any unrelated project.
- Git stays local. Never add a remote, push, pull or otherwise interact with
  GitHub. The owner uploads checkpoints to their own private repository by hand.
- No cloud yet: do not configure Supabase, deployment, cloud storage or any
  hosted service until the owner approves that phase.
- Ask before installing any dependency or system-level tool, and before
  changing any system setting.
- No implementation without approval. For every major task: explain what and
  why, list dependencies and risks, wait for approval, implement, test, verify,
  make a local Git checkpoint, then recommend one next task. Never roll on into
  the next phase.
- No unrequested features, no placeholder functionality, and no control that
  looks interactive but does nothing.
- Never claim something works unless it was verified. Report failures plainly.
- Do not invent the visual design. The owner's screenshots in
  `design-references/` are the reference. Ask before making a design decision
  that materially affects implementation. Never alter those files.
- Completion reports use: Implemented / Testing / Visual Review / Git / Issues /
  Next Step. Keep them short.

## Two computers

- **MacBook Pro (work-issued, Apple silicon):** where Claude writes source
  code, migrations and tests, and runs the frontend and the simulated checks.
  Never install Docker, PostgreSQL, the Supabase tool or any other
  system-level software on it, and never change its system settings.
  Project-level npm packages need the owner's approval. No real secret and no
  real data ever lives on this machine.
- **Windows PC (the owner's own):** will run Docker and a local Supabase
  stack for database, sign-in and integration testing, and later shows
  Mission Control on the TV. It must never become the production backend.
- The owner moves the project between them through their private GitHub
  repository, by hand. Claude never touches GitHub. Commit before leaving a
  machine and pull before starting on the other; never leave uncommitted work
  on both.
- Keep everything portable: Node scripts run through npm (no shell scripts),
  no absolute paths, line endings fixed by `.gitattributes`, machine-specific
  values only in ignored `*.local` files with a committed example beside them.
- Installed packages, caches, build output and local settings are not carried
  by Git. Each machine rebuilds them with `npm ci`.

## Security tests

- `npm run test:security` runs on any machine: it applies the migrations to
  PGlite (PostgreSQL in memory, with an imitation of Supabase's roles and
  signed-in user), runs every access check, and proves the checks notice a
  removed protection. `tests/security/README.md` explains the layout.
- `npm run test:security:real` runs the same checks, plus real sign-in and
  Data API checks, against a local Supabase stack on the Windows PC. First
  run 14 October 2026: 48 of 50 passed; REAL-05 and REAL-08 failed because
  of local settings (fixed in `supabase/config.toml`, awaiting a re-run).
- `supabase/config.toml` must keep sign-ups off (`[auth] enable_signup =
  false`) and authenticator codes on (`[auth.mfa.totp]`). Settings changes
  need the stack stopped and started again.
- `pg` and `supabase` are development dependencies needed only on the PC, and
  are not installed on the MacBook. Ask the owner before reinstalling the
  Mac's packages, because `npm ci` would add both (the Supabase package would
  stay inert, since install scripts are blocked).
- Results go to `docs/security-report.md`, which is generated, not written by
  hand. Every check is reported as Passed, FAILED, Not executed, Not possible
  or Stale. **A simulated pass is never proof that real Supabase security
  works; only the Real Supabase column counts.** Say so in every report.
- Every migration that adds a table or function adds its checks to
  `tests/security/lib/cases.mjs` in the same change. Do not hand-imitate more
  of Supabase than the imitation already does; mark such checks as needing
  real Supabase.

## Sign-in (Phase 2c-1)

- The browser knows only `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY` (in `.env.local`, PC only; see
  `.env.example`). `src/data/config.ts` refuses secret keys, and the build
  runs `scripts/check-bundle.mjs`, which fails on any secret, any other
  `VITE_` setting, or administrator script code in the app files.
- Screens use `useAuth()` (`src/app/auth/`); only `src/data/` talks to
  Supabase. Route guards (`RequireOwner`, `RequireTv`) only choose screens:
  the database's aal2 rules and `private.identities` are the security.
- Which screen a sign-in gets comes from `app_metadata.nexus_role` ("owner" or
  "tv"), set only by the administrator. The owner must enter an authenticator
  code; the TV signs in with a password only and stays signed in.
- Accounts are created only with `npm run account -- owner|tv|list` on the
  Windows PC (`scripts/setup-account.mjs`, refuses any other computer or a
  non-local stack). It prints a random password once.
- Mac tests use the fake service in `src/test/fakeAuth.ts`; they prove the
  screens, not Supabase. Real sign-in is checked on the PC.

## Tasks and contexts (Phases 2c-2a and 2c-2b)

- `src/data/types.ts` (shapes and service interfaces), `src/data/supabaseData.ts`
  (the only code reading or writing contexts and tasks), `src/data/slug.ts`.
  Screens get the data layer through `useData()` (`src/app/data/`).
- Feature code lives in `src/features/`: `contexts/` (useContexts,
  ContextsManager) is deliberately independent of tasks, so notes and calendar
  can reuse it; `tasks/` holds quick add, the Open / Completed / Archived
  list and the task editor. Pages only compose.
- Contexts are always created by the owner; none are created automatically.
  "Show on TV" starts off.
- Mac tests use `src/test/fakeData.ts`. `npm run test:integration` runs the
  real data layer against the local stack on the PC (never on the Mac).
- Deadlines: `due_on` (a calendar date, no time) or `due_at` (an exact
  moment), never both; the constraint `tasks_one_kind_of_deadline` enforces it
  (migration `20261015090000_task_due_on.sql`). The data layer always sends
  both columns together. Helpers in `src/lib/deadlines.ts`; tests run in
  London time (`vite.config.ts`).
- Applying a new migration to the PC's existing local database: `npx supabase
  migration up --local`. Never `supabase db reset` unless the owner wants the data gone.

## Live dashboards (Phase 2c-3)

- Plan approved 14 October 2026, built in three checkpoints: 2c-3a TV summary
  migration, checks and `summary.get()`; 2c-3b live Mission Control; 2c-3c
  live TV. Each stops for PC verification.
- `tv_summary()` (latest definition in
  `20261016090000_tv_summary_due_on.sql`) returns per task exactly: title,
  context, priority, due_on, due_at. Ordered by deadline day in London time,
  then priority, then time, then age; at most 50. All TV filtering happens in
  PostgreSQL; the app never filters or trims what the TV may see. The fake in
  `src/test/fakeData.ts` only imitates it for screen tests.
- Approved decisions: Mission Control's Today card has working completion
  checkboxes; a per-context progress card stands in for Projects until
  Projects is built; progress figures must be exact counts with a stated
  definition, never estimates; greetings stay generic (no stored name).
- TV exception, approved: one discreet, keyboard-accessible settings menu with
  Refresh now and Sign out (confirmed before signing out). Otherwise the TV
  stays control-free, minimal and readable across a room, and shows clearly
  when its information is stale or offline.
- Mission Control (2c-3b): `src/lib/dashboard.ts` holds every calculation,
  always on London calendar days (Intl with Europe/London, never the
  computer's zone): overdue = date-only before today or timed moment passed;
  today = rest of today; Next Up = the seven London days after today; week =
  from Monday 00:00 London. "Done this week" counts tasks still completed and
  not archived (`tasks.completedSince`). Progress bar = done this week ÷
  (done this week + open), stated on the card. Cards in `src/features/dashboard/`.
- Live refresh: `src/lib/useLiveData.ts` loads every 30 seconds while visible,
  on becoming visible, and when the network returns; a failed refresh keeps
  the last data and the page says it may be out of date. A refused request
  calls `actions.recheck()`, which shows "session ended" if the sign-in has gone.
- The Tasks page keeps its list in the address: `/tasks?view=done` or
  `?view=archived`.
- TV (2c-3c): `src/pages/tv/` uses only `summary.get()` (a test fails if it
  touches `tasks` or `contexts`). Panels: Today (overdue then due today),
  Next Up (seven London days), Open by context (counted from the summary; a
  note appears when the 50-task limit is reached). Four rows per panel, "and
  N more" in the heading line; sized to fit 1920 x 1080. Same refresh, stale
  warning and session recheck as Mission Control. `TvSettingsMenu` is faint
  until the mouse moves or a key is pressed; Escape closes it; sign-out asks
  first with Cancel focused.

## Before each commit

- Check `git status` for unrelated or sensitive files. `.env` files, keys,
  `node_modules`, build output and caches must stay ignored.
- Commit locally only and report the commit identifier.

## Working in this project

- Run every npm command from the project root. `.npmrc` keeps npm's download
  cache in `.npm-cache/` inside the project and stops packages running install
  scripts.
- Checks: `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run test:security`, `npm run build`, or `npm run check` for all five.
- Run locally: `npm run dev`, then open http://localhost:5180. The TV dashboard
  is http://localhost:5180/tv.
- Dependencies are pinned to exact versions. Several are newer than older
  examples assume (React Router 8, Vitest 5, ESLint 10, TypeScript 6). Check
  the installed package and current vendor documentation before using or
  upgrading anything; do not rely on memory for platform details.

## Structure

- `src/app/`: routes, the navigation list, brand settings, layouts.
- `src/pages/`: one folder per page.
- `src/components/`: shared building blocks (GlassPanel, Sidebar, Backdrop...).
- `src/styles/tokens.css`: design tokens (colour, type, spacing, radii, glass,
  motion). Change values there, not inside components.
- `src/lib/`: small helpers.
- `design-references/`: the owner's original screenshots.
- `supabase/migrations/`: numbered database changes. Never edit one that has
  been applied anywhere; add a new one. Every table gets row-level security,
  a `revoke all`, and explicit column-by-column grants in the same file.
- `tests/security/`: the security checks. `docs/security-report.md`: their
  generated results.
- Database model so far: `contexts` and `tasks` in `public`; `private.identities`
  registers which sign-ins are the owner or a TV; `public.tv_summary()` is the
  only function that reads past the access rules. Nothing can be deleted
  through the Data API, only archived.
- To add a section: one entry in `src/app/navigation.ts` and one route in
  `src/app/routes.tsx`. Only sections that work appear in the sidebar.
- To replace the temporary backdrop or logo: put the file in `public/` and
  change its path in `src/app/brand.ts`.

## Approved architecture

- React + TypeScript single-page app built with Vite. Plain CSS with design
  tokens, no styling framework. Web-first, online-only; install icon later, no
  service worker.
- Backend, later: Supabase Free, in its own project and its own free
  organisation, separate from Derwent and Veyra. Server code only as Supabase
  functions. Scheduling with pg_cron and a plain jobs table. Screens refresh by
  polling every 30 seconds, not Realtime.
- Hosting, later: Cloudflare free static hosting. Recurring cost target is
  £0 a month; paid services only on triggers the owner has agreed.
- Sign-in, later: sign-ups off. The owner signs in with a password plus an
  authenticator code, and the access rules require that code for reading as
  well as writing. A separate read-only TV login can only call one redacted
  summary function. An automated access report runs on every change.
- TV: the `/tv` route of the same app. No interactive controls (except the
  approved settings menu, see Live dashboards), tinted panels
  instead of live blur, and (once data exists) a data-age indicator plus
  offline and signed-out states. The TV is treated as public: titles only.
- AI: none in the MVP. A built-in assistant is the first feature after the
  MVP (OpenAI first, prepaid API credit with automatic top-up off, a daily
  limit inside Nexus). Connectors for outside AI apps come later and do not
  replace it. Never rely on consumer subscriptions or Claude Max credits.
- Security: everything locked by default, no secret ever reaches the browser,
  nothing from employer systems, and no Veyra health data.

## Design decisions agreed from the screenshots

- The sidebar shows only working sections. Planned ones (Notes, Calendar,
  Inbox, Business, Personal, Nexus AI, Systems, Settings) join when built.
- British dates, 12-hour clock, one tagline per screen.
- The briefing banner and the Ask Nexus command bar come later. Mission
  Control's top panel is where the banner goes, and `--dock-space` reserves
  room for the bar.
- The TV has no arrows or checkboxes and avoids small text. Its one control
  is the approved settings menu.

## Future design improvements

Recorded from the owner's review of Phase 1 on 13 October 2026. Do not
implement any of these until the owner asks.

- Backdrop: the illustrated mountain scene is not realistic enough. The owner
  wants a photorealistic, cinematic landscape like the reference screenshots:
  realistic mountains, atmospheric lighting, sunset colours. The image is
  swapped through `src/app/brand.ts`.
- Glass effects: to be revisited once the dashboard holds more components and
  information.
- Layout, navigation and typography: accepted as the foundation.

## Roadmap

- 1a TV placement check on the Windows PC (no code): not yet done.
- 1b Foundation shell: done 13 October 2026.
- 2a Database foundation and simulated security checks: done 13 October 2026.
  Real Supabase checks are written but not yet executed.
- 2b Local Supabase stack on the Windows PC, real checks: done 14 October
  2026, 50 of 50 passed.
- 2c-1 Sign-in: verified on the PC 14 October 2026 (owner with authenticator,
  TV without, TV kept to /tv, 50 of 50 real checks). Not yet verified:
  long-running session refresh, session revocation, production readiness.
- 2c-2a Tasks and contexts (quick add, list, complete, reopen, contexts
  manager): verified on the PC 14 October 2026 (58 of 58 real checks).
- 2c-2b Task editor (title, notes, priority, date-only and timed deadlines,
  context, hide from TV, archive and restore, Open / Completed / Archived),
  plus the `due_on` migration: verified on the PC (65 of 65 real checks).
- 2c-3a TV summary with date-only deadlines, its checks and `summary.get()`:
  verified on the PC (68 of 68 real checks).
- 2c-3b Live Mission Control: checked by hand on the PC 14 October 2026.
  Its integration test results were not recorded in the repository.
- 2c-3c Live TV: built on the Mac 14 October 2026; awaiting PC verification
  (no database change; 68 real checks still expected). Next step needs the
  owner's go-ahead.
- Go live at £0 (needs a free Supabase project slot).
- 3 Hands-off TV after Windows sign-in. Optional: 3b scheduled power-on,
  3c restricted display account. Never automatic sign-in on the main account.
- 4 Daily-use version: pages built from the designs, manual backup and restore.
- 5 Reminders, outside monitor, automatic backup (the MVP). Then seven days of
  daily use before anything further.
- 6 and 7 Built-in assistant. Then calendar, Derwent and Veyra health, daily
  briefing, notes, connectors, approvals and Gmail suggestions.

## Open questions

- How many active free-plan Supabase projects the owner's account has (the
  limit is two; this decides whether go-live can be free).
- Windows details for the TV check: edition, display arrangement and scale,
  everyday browser, virtual desktops.
