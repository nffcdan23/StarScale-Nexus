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
  Data API checks, against a local Supabase stack on the Windows PC. It was
  written without a stack to test it on and has never been executed.
- Results go to `docs/security-report.md`, which is generated, not written by
  hand. Every check is reported as Passed, FAILED, Not executed, Not possible
  or Stale. **A simulated pass is never proof that real Supabase security
  works; only the Real Supabase column counts.** Say so in every report.
- Every migration that adds a table or function adds its checks to
  `tests/security/lib/cases.mjs` in the same change. Do not hand-imitate more
  of Supabase than the imitation already does; mark such checks as needing
  real Supabase.

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
- TV: the `/tv` route of the same app. No interactive controls, tinted panels
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
- The TV has no arrows or checkboxes and avoids small text.

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
- 2b On the Windows PC: local Supabase stack, then run the real checks. After
  that, sign-in, task entry and TV summary in the app.
  2c Go live at £0 (needs a free Supabase project slot).
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
- No Supabase settings file (`supabase/config.toml`) exists yet. Let the
  Supabase tool create it on the Windows PC rather than writing it by hand.
- Windows details for the TV check: edition, display arrangement and scale,
  everyday browser, virtual desktops.
