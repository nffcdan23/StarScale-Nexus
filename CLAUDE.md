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

## Before each commit

- Check `git status` for unrelated or sensitive files. `.env` files, keys,
  `node_modules`, build output and caches must stay ignored.
- Commit locally only and report the commit identifier.

## Working in this project

- Run every npm command from the project root. `.npmrc` keeps npm's download
  cache in `.npm-cache/` inside the project and stops packages running install
  scripts.
- Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, or
  `npm run check` for all four.
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

## Roadmap

- 1a TV placement check on the Windows PC (no code): not yet done.
- 1b Foundation shell: done 13 October 2026.
- 2a Access rules on a local practice database (needs a container tool:
  approval required). 2b Sign-in, task entry and TV summary, all local.
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
- Windows details for the TV check: edition, display arrangement and scale,
  everyday browser, virtual desktops.
