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
- Cloud: the owner has created a Supabase Cloud project for Nexus (Phase
  3c-4b). Only the Windows PC connects to it, only within an approved
  checkpoint; the MacBook never does. No other hosted service (deployment,
  cloud storage) until the owner approves that phase.
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
- Windows-only tools live in their own manifest, `tools/windows/package.json`
  (`pg` and the `supabase` command-line tool, with their own lockfile), so
  the main `npm ci` never brings them to the Mac. On the PC only: `npm run
  setup:windows` installs them; `npm run supabase -- <command>` runs the
  Supabase tool (never `npx supabase`, which would look elsewhere); it is for
  the local stack only and refuses cloud and platform commands, `db reset`
  and `stop --no-backup` (`tools/windows/supabase-cli.mjs`). Code that
  needs `pg` loads it with `tools/windows/load-pg.mjs`. All of these refuse
  to run anywhere but Windows. Never install anything into `tools/windows` on
  the Mac; update its lockfile only with `--package-lock-only`.
- The Tauri command-line tool is also Windows-only (`tools/windows`): `npm run
  tauri -- <command>` and `npm run desktop:build:cloud|local` (see Desktop app).

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
- `pg` and `supabase` are Windows-only (`tools/windows`, see Two computers)
  and are not installed on the MacBook. Moved there in Phase 3b-1 because npm
  cannot install part of a manifest: the Supabase tool arrives as a
  platform-specific optional package, which blocking install scripts does not
  stop, and skipping optional packages would also remove Vite's native build
  parts. Still ask the owner before installing any new package on the Mac.
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
  non-local stack). It prints a random password once. Cloud sign-ins:
  `npm run cloud:account -- owner|tv --email ADDRESS | list` (see Cloud
  migration and backups).
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
- Applying a new migration to the PC's existing local database: `npm run
  supabase -- migration up --local`. Never `supabase db reset` unless the
  owner wants the data gone.

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

## Notes (Phase 3)

- Plan approved 14 October 2026: 3a database and data layer; 3b workspace
  (sidebar, notes list, editor) with TipTap; 3c autosave, local copies of
  unsaved changes, offline retry and revision conflicts; 3d search and
  filters; 3e backup and tested restore. Each needs its own go-ahead.
- `public.notes` (migration `20261017090000_notes.sql`): `content` is the
  editor's JSON document, never HTML. `content_text` (and `preview`,
  `search`) are derived by the database from it on every write; no caller
  can write them. The trigger also checks the document's shape and size and
  allows only http(s) and mailto links. Context is optional (null shows as
  Uncategorised) but must be the owner's own when set. `revision` and
  `updated_at` change only for edits to title, text or context, not for
  pinning or archiving. Owner-only with an authenticator code, no delete, the
  TV gets nothing and `tv_summary()` never mentions notes.
- `search_notes(search_text, include_archived, context_filter)`: full-text
  search, every word also a prefix, snippets marked with U+E000 and U+E001
  (turned into plain parts by `toSnippet`, never HTML). The future assistant
  searches through this same function.
- Data layer: `notes` in `src/data/types.ts` and `supabaseData.ts`;
  `save` takes the revision it was based on and throws a "conflict"
  DataError if the note changed elsewhere. The fake imitates the same rules.
- Editor: TipTap 3.31.4, six packages (`@tiptap/react`, `core`, `pm`,
  `starter-kit`, `extension-list`, `extensions`), 51 packages in all, every
  one MIT, none with install scripts or native code, none from the paid Pro
  registry. Installed in 3b-1. It should feel closer to Apple Notes or Notion
  than Markdown. Formatting lives in `src/features/notes/editor/extensions.ts`:
  headings 1-3, bold, italic, bullet, numbered and check lists, links, quotes,
  dividers, inline code and code blocks; strikethrough and underline off.
  Links: `isSafeLink` (http, https, mailto) mirrors the database rule.
  `tests/security/lib/rich-note.json` is real editor output for every format;
  the editor tests and security check NOTE-23 both use it.
- Workspace (3b-2): `/notes` (list), `/notes/new` (a note not yet in the
  database; the first Save creates it and moves to its address) and
  `/notes/<id>`. `src/pages/notes/NotesPage.tsx` (loaded lazily through
  `LazyNotesPage`), `src/features/notes/` (`NotesList`, `NoteEditorPane`,
  `editor/FormatToolbar`, `useUnsavedChangesGuard`). Save is explicit (button
  or Ctrl/Cmd+S); title, text and context are edits and go through Save with
  the note's revision; pin, archive and restore act at once (they do not
  change the revision). Archive waits until changes are saved or discarded.
  Archived notes open read-only with Restore. Leaving with unsaved changes
  asks first (in the app) and the browser warns on closing. A conflict shows
  a message and Reload note; nothing is overwritten. Under 1100 px the list
  and the open note show one at a time. Notes is listed after Tasks.
- Autosave (3c-1, `src/features/notes/useAutosave.ts`): 2 s after the last
  edit, at least every 15 s while editing, at once on Ctrl/Cmd+S, Save now,
  hiding the tab or leaving the note. One save at a time. Failed saves retry
  after 5, 15, 30 s then every minute, and at once when the network returns
  or the tab is shown. A conflict stops saving that note until the owner
  reloads it (full conflict screen is 3c-3); a rejected value is not retried.
  The editor keeps its latest edits and last-saved revision in a ref that
  every save reads, so a save never sends stale data or an old revision.
- A new note gets a fixed id on the device; its first save creates it with
  that id (`notes.create(changes, { id })`), so a retry can never make a
  second note. The editor session survives the address change from
  `/notes/new` to `/notes/<id>` (`editorSession` in the navigation state).
- While nothing is unsaved, an open note checks `notes.peek` (revision,
  pinned, archived; never content) every 30 s and when the tab is shown, and
  loads a newer version quietly.
- Local drafts (3c-2, `src/features/notes/drafts.ts`): unsaved changes are
  copied to localStorage 0.3 s after each edit and at once when the tab is
  hidden, the page closes or the editor closes. Key: account id (from the
  sign-in snapshot's `userId`) plus the note's stable id. A copy counts only
  once read back unchanged; only then may the status say "kept on this
  computer". A copy is removed only after the database confirms the save,
  or by the owner's choice. On opening a note: a copy made on the version
  the database still has is restored (with a Discard option) and autosaved;
  a copy made on an older version, or for an archived note, becomes a held
  version to resolve (3c-3) and is never applied automatically. New notes that never
  reached the database are listed under "Not saved yet" and recover with the
  same id. Damaged or other-account entries are ignored. Leaving or closing
  goes ahead quietly once the copy is safe; the 3b warnings remain when it
  cannot be made (private window, storage full), with a note in the editor.
- Conflicts (3c-3, `ConflictResolver`, `conflicts.ts`): a save refused for
  an older revision, or a held version found on opening, puts your version
  aside as a held record with its own `heldId` (several per note allowed,
  resolved oldest first), stops saving and editing that note, loads the
  latest database version and shows both side by side (stacked under
  1100 px), read-only through the editor. Keep both (default) creates your
  version as a new note titled "<title> (my version, 15 Oct, 2:41 PM)" whose id
  IS the heldId, so retries and restarts never make two; Use latest
  version asks first; Use my version asks first, peeks the revision and
  saves with that revision, stopping with the newer version shown if it
  changed again. Use my version is not offered for archived notes (never
  changed or restored automatically). A held record is removed only after
  the database confirms (or after Use latest is confirmed). Identical
  versions settle silently. Nexus keeps no older versions, so Use my version
  says so. Each editing session tags its drafts with a `writer` id and only
  removes its own; two tabs share one copy per note, so only the most
  recent tab's unsaved changes are on disk at a time (the database still
  never loses either version: the second save shows the conflict screen).
- Signing out (`DesktopShell`) saves open notes first, then, if copies remain,
  asks: keep them on this computer and sign out (default), delete them and
  sign out (nothing writes them back while closing), or cancel. An ended
  session keeps them. Copies are plain text in that browser profile:
  readable by anyone using that Windows account and browser, like the
  signed-in session; not encrypted, since the key would sit beside them.
- The editor shows the stored document through ProseMirror; no stored text
  is ever inserted as HTML. Typing shortcuts (# heading, - list, 1. list,
  [ ] checklist, > quote, three backticks then a space for code, --- divider, **bold**) come with TipTap.
- Lazy loading: only the Notes route may import the editor. The build check
  fails if ProseMirror code reaches the startup download. Measured in 3b-1:
  the editor download is 393 KB (124 KB compressed); the startup download is
  unchanged at 597 KB (174 KB compressed).
- Backups: built in Phase 3c-4b-1 (see Cloud migration and backups). A
  readable note export for the owner's own use is still a separate, later
  feature.
- The written rules (`static-checks.mjs`) now cover functions with inputs
  and `create or replace`; before Phase 3a they silently skipped them.

## Desktop app (Phase 3c-4)

- Plan approved 16 October 2026: Tauri 2. 3c-4a desktop shell; 3c-4c
  install and update routine. Each needs its own go-ahead. Build and install
  steps: `docs/desktop-app.md`. The planned automatic Docker start-up was
  dropped: 3c-4b is now the cloud backend migration (next section).
- `src-tauri/`: Rust written on the Mac, compiled and tested only on the PC.
  Keep it small. Exact pins: tauri 2.12.1, tauri-build 2.7.1, opener 2.7.0,
  single-instance 2.5.2, window-state 2.5.0; JS `@tauri-apps/api` 2.12.1 and
  `@tauri-apps/plugin-opener` 2.7.0 (main manifest, plain JS); CLI 2.12.1 in
  `tools/windows`. `Cargo.lock` comes from the first PC build and is committed.
- Two apps from one code base (3c-4b-3, `tools/windows/desktop-variants.mjs`),
  built only with `npm run desktop:build:cloud` or `npm run desktop:build:local`
  (`npm run tauri -- build` is refused):
  - cloud: "StarScale Nexus Cloud", identifier `uk.co.starscale.nexus.cloud`,
    window title "StarScale Nexus", connect-src only its
    `https://<project id>.supabase.co`, built from `.env.cloud.local`;
  - local: "StarScale Nexus", identifier `uk.co.starscale.nexus` (the app
    installed in 3c-4a, so its sign-in and drafts carry on), window title
    "StarScale Nexus (Local)", connect-src only the local stack, built from
    `.env.local`.
  The wrapper merges these over `tauri.conf.json` (`--config`), which stays
  the local/development configuration. They install side by side, run at
  the same time and keep separate storage.
- Permanent per app: product name, identifier, and window `useHttpsScheme:
  false`. The origin is http://tauri.localhost; localStorage (sign-in
  session, note drafts) lives under %LOCALAPPDATA%\<identifier>. Changing any
  of them orphans that app's sign-in and drafts. App storage is separate from
  Chrome's, and `tauri dev` (origin http://localhost:5180) is separate again.
- Security: one capability (`capabilities/main-window.json`) allowing only
  `opener:allow-open-url` for http, https and mailto. A Rust navigation guard
  keeps the window on the app's own pages; `src/app/desktop/externalLinks.ts`
  sends other links to the default browser (desktop only, loaded lazily).
  CSP in `tauri.conf.json`: everything 'self', no unsafe-inline or
  unsafe-eval, connect-src limited to IPC and the local Supabase stack;
  `freezePrototype` on. Tauri adds nonces/hashes to the CSP, so inline styles
  cannot be allowed: TipTap's style tag is off (`editorOptions`) and its rules
  live in `editor/editorBase.css`. `desktopConfig.test.ts` and
  `tests/desktop/` guard all of this. The build gives the app only
  VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (every other VITE_
  setting removed) and `scripts/check-bundle.mjs` fails unless the built app
  contains exactly the expected Supabase address (`NEXUS_EXPECTED_SUPABASE_URL`)
  and no other; any build fails if it contains two. Icons are made from
  `src-tauri/app-icon.svg` on the first build.
- Installer: per-user NSIS (Start menu entry in the "StarScale Nexus" folder;
  desktop shortcut via the finish-page box). Not code-signed: Windows may
  warn (SmartScreen, unknown publisher). Updates: rebuild and reinstall; it
  keeps the app's data unless "Delete the application data" is ticked.
- The TV stays in a browser kiosk profile, not the desktop app.

## Cloud migration and backups (Phase 3c-4b)

- Plan approved 16 October 2026: the installed desktop app moves to the
  owner's Supabase Cloud project; local Supabase stays for development,
  migrations and security tests. Four checkpoints, each with its own
  go-ahead: 4b-1 local backup and proven restore (no cloud); 4b-2 cloud
  connection tooling, migrations, real security checks and a restore drill
  on the still-empty project; 4b-3 separate local and cloud environments,
  cloud desktop build, new owner and TV accounts with a fresh authenticator;
  4b-4 transfer of chosen data (later dropped: the local data is disposable).
- Agreed approach: connect with `--db-url` through the session pooler, never
  `supabase login` or `supabase link`; the database password and secret key
  are typed when needed and never saved, printed or pasted into a chat; a
  temporary secret key is deleted after use. No personal data goes to the
  cloud until backup and restore are proved there. Never reset, delete or
  overwrite the local database.
- Cloud backups (4a): `npm run backup:cloud` (Windows PC only, the project
  in `.env.cloud.local`, database password typed hidden, no secret key,
  read-only connection and transaction, exactly one owner) writes
  `backups/nexus-cloud-<date>-<time>.json` (source records the shortened
  project id) and proves it in PGlite like the local backup.
- In-use cloud checks (4a): `npm run test:security:cloud-live`
  (`tests/security/cloud/run-cloud-live.mjs`, shared parts in `shared.mjs`):
  migrations must all be applied; typed project id; no accounts created;
  every access check and REAL-01 in rolled-back transactions; LIVE-01 to
  LIVE-06 (identity, sign-in settings, history, structure against local, a
  restore drill beside existing records with `emptyScope: 'owner'`, and a
  before/after fingerprint of every account id, sign-in, context, task and
  note, computed in the database by `readDataFingerprint`). Results in
  `tests/security/cloud/live-results.json`. The owner closes Nexus during
  the run.
- Reports are separate: `docs/security-report.md` (simulated and local) and
  `docs/cloud-security-report.md` (full run and in-use check). The cloud
  project counts as verified for the current migrations by a passing full
  run, or by a passing in-use check on top of an earlier passing full run
  (`cloudVerification` in `tests/security/lib/report.mjs`); `cloud:account`
  uses the same rule.
- Real restores (`restoreBackup`) still require contexts, tasks and notes to
  be completely empty; only the drill uses the owner-scoped check.
- Backups (4b-1): `npm run backup:local` (Windows PC only, local database
  only, read-only connection and transaction) writes
  `backups/nexus-<environment>-<date>-<time>.json` and proves it at once;
  `npm run backup:verify [-- "<file>"]` checks any backup. `backups/` is
  ignored by Git. Guide: `docs/backup-and-restore.md`.
- A backup holds the owner's contexts, tasks and notes with ids, dates,
  revisions and formatting; never owner_id, email, passwords, sessions,
  tokens or authenticator secrets. SHA-256 data fingerprint and file
  integrity code: any change is refused (detects damage, not deliberate
  forgery).
- Restore (`scripts/backup/database.mjs`): only into an empty database and a
  registered owner, one transaction. Rows go in with every rule active, then
  the rule-set columns (tasks completed_at, updated_at; notes revision,
  created_at, updated_at) are put back with `session_replication_role =
  replica` for that step only, then everything is read back and must equal
  the backup, or nothing is kept.
- Proof so far is PGlite plus the Supabase imitation (`scripts/backup/verify.mjs`),
  not real Supabase. Restoring into real Supabase (including whether the
  cloud project allows `session_replication_role`) is proved in 4b-2.
- `scripts/backup/format.mjs` lists every backed-up column. A migration that
  changes contexts, tasks or notes updates that list and the restore in the
  same commit; the tools refuse a database whose columns differ.
- `npm run test:backup` (fictional data only, part of `npm run check`
  through `npm run test:tools`). Real backups exist only on the Windows PC,
  never on the Mac.
- Cloud tooling (4b-2), Windows PC only, guide `docs/cloud-setup.md`:
  `npm run cloud:status` (read-only), `npm run cloud:migrate` (applies
  missing migrations in order after the owner types the project id; refuses
  an unknown or out-of-order history and any migration that drops, empties,
  deletes or updates data; never seed, never reset), `npm run
  test:security:cloud` (only on a migrated, empty project, after the typed
  project id). Code in `scripts/cloud/`, `tests/security/cloud/`.
- Cloud settings: `.env.cloud.local` (ignored; example `.env.cloud.example`)
  holds only the project id, publishable key and session pooler host; API
  address and database user (`postgres.<project id>`) are derived from the
  id. `supabase-ca.crt` (ignored) verifies TLS before the password is sent.
  The database password and a temporary secret key are typed into a hidden
  prompt each run, never stored, and removed from every message. `db push`
  gets the password through its environment, never the command line.
- Cloud checks (`tests/security/cloud/run-cloud.mjs`): CLOUD-01 to CLOUD-06
  plus every access and REAL check, recorded in
  `tests/security/cloud/results.json` and the report's separate "Cloud"
  column. CLOUD-04 compares the catalogue (tables, columns, constraints,
  indexes, policies, functions, triggers, anon/authenticated/PUBLIC
  permissions) with the local stack, read-only. CLOUD-05 restores the
  fictional backup (`tests/backup/fictional-data.mjs`) in a transaction that
  is always rolled back (`scripts/cloud/drill.mjs`). CLOUD-06 only reports
  leftovers; nothing is deleted except the run's own test sign-ins.
- Not yet verified on the PC: whether the pooler's certificate verifies with
  the downloaded CA, whether `db push --db-url` honours PGPASSWORD and
  PGSSLMODE, whether the cloud accepts `@example.test` test emails and
  `session_replication_role` for postgres. The first PC run decides.
- `npm run test:tools` (backup, cloud and desktop-build tools, fictional data
  and fakes only) is part of `npm run check`.
- Environments in the app (4b-3, `src/data/environment.ts`): the Supabase
  address decides local (`http://127.0.0.1:54321` or `localhost:54321`) or
  cloud (`https://<20 characters>.supabase.co`); `config.ts` refuses any
  other address, and a cloud project must use an `sb_publishable_` key. The
  sign-in session key is stated explicitly (`sb-127-auth-token` local,
  `sb-<project id>-auth-token` cloud, as supabase-js would choose). Note
  drafts keep the prefix `nexus.noteDraft.v1:` for local and use
  `nexus.noteDraft.v1@<project id>:` for a cloud project, so neither build
  lists, restores or removes the other's drafts.
- Cloud sign-ins (4b-3): `npm run cloud:account -- owner|tv --email ADDRESS
  | list` (`scripts/cloud/account.mjs`, rules in `accounts.mjs`). Refuses
  unless `tests/security/cloud/results.json` shows every check passed for
  this project and these migrations, all migrations are applied and there
  are no stray accounts. Exactly one owner; a TV belongs to it. Database
  password and a temporary secret key typed hidden, project id typed to
  confirm, random password shown once. New ids; nothing copied from local;
  the owner enrols a new authenticator on first sign-in. Never during builds.
  `npm run cloud:account -- password --email ADDRESS` replaces an existing
  sign-in's password through the Auth admin API (PUT admin/users/<id>,
  body only the password): typed twice in the hidden prompt, 12 characters
  to 72 bytes, never printed or on the command line; id, role and
  authenticator kept; no recovery email; not held up by the verification
  gate.
- Fictional records made while testing 4b-3 stay in the cloud project
  (context "Fictional test"); the restore only goes into an empty project,
  so a restore would need them cleared first, with the owner's approval.
  (No transfer of local data is planned: 3c-4b-4 was dropped.)

## Settings (owner request, 17 October 2026)

- `/settings` (owner only, behind RequireOwner like every desktop page: the
  TV goes to /tv, an owner without a code to sign-in). Sidebar entry in the
  footer, directly above Sign out. Sections in the address
  (`?section=security|preferences|privacy|about`, default My Account):
  `src/pages/settings/`, `src/features/settings/`.
- Shows only what is real: email, fixed role, whether this session used the
  authenticator code, authenticator status and date, database (cloud project
  id shortened) and app kind, unsaved-draft count, version from
  package.json (only `version` is built in). Never account ids, factor ids
  or tokens. Preferences has no controls until something can genuinely be
  applied. No delete or reset actions.
- Password change uses the account's own session only (never an admin key):
  `AuthService.changePassword` first checks the current password on a
  separate in-memory Supabase connection (`createPasswordCheck`, ends its
  session at once), then `auth.updateUser({ password, current_password })`.
  Rules: 12 characters to 72 bytes, no edge spaces, differs from current,
  confirmed. Supabase refusals map to reasons (wrong, same, weak with
  reasons, reauthentication needed: sign out and in again, session ended:
  recheck shows "session ended", rate limited). Passwords live only in the
  form and are cleared after every attempt that reaches Supabase.
- Authenticator: status only. Replacing or removing it in the app is not
  built yet (stated on screen).
- The client-side current-password check is a UI safeguard; Supabase
  enforces it only if the project requires the current password or recent
  sign-in for password changes (dashboard setting, owner's choice).

## Phase 4: Projects and Notes organisation (approved 17 October 2026)

- Projects are the single source of truth for organising information: one
  `projects` table (owner, name unique among active projects, optional
  context, archived_at). Notes and tasks reference it (`project_id`,
  optional); a note without a project is in the Inbox. No separate folders
  table. Contexts stay as they are (life areas, task areas, TV visibility,
  Mission Control). The Notes context picker stays.
- One note editor at `/notes/<id>`: opening a note from a project goes there,
  with the project's list shown; no copies, no synchronisation. New notes
  made inside a project get its id from the first save; Inbox notes stay
  unassigned. Moving a note between projects is not an edit (no revision
  change). Projects can be created from Notes or Projects; renaming,
  archiving and restoring only in the Projects workspace. Archived projects
  keep their notes and tasks linked and findable.
- Checkpoints: 4a cloud backup and in-use checks; 4b migration (projects,
  project_id on notes and tasks, search filters for project, Inbox and
  pinned, security checks, backup format 2 restoring format 1); 4c Notes
  organisation (and hide the Projects placeholder); 4d notes search box;
  4e Projects workspace. Built from the current interface design.
- Before every migration: `backup:local` and `backup:cloud`, both proven;
  apply locally and run the full real suite; then `cloud:migrate` and
  `test:security:cloud-live`. Additive changes only; app rollback by
  reinstalling the previous build; database fixed forward.
- Future (roadmap only, not in Phase 4): project files, activity, project
  assistants, AI Inbox classification, sub-folders inside a project; all as
  tables referencing `projects.id`, never a second hierarchy.

## Future: Files (roadmap only, recorded 17 October 2026)

A dedicated Files section: Microsoft OneDrive and Google Drive (several
connected accounts where supported), browsing, searching and previewing
authorised files, linking external folders to existing projects, the same
files reachable from Files or from their project, and later GitHub
repositories and local directories. Files stay with their provider; Nexus
does not copy them into Supabase. File links are provider-independent
references: provider, account, external item id, Nexus project id. Each
project keeps one stable identity. No OAuth, integrations or file tables
until the owner approves that phase.

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
- Database model so far: `contexts`, `tasks` and `notes` in `public`;
  `private.identities` registers which sign-ins are the owner or a TV;
  `public.tv_summary()` is the only function that reads past the access rules
  (`public.search_notes()` runs with the caller's rights). Nothing can be
  deleted through the Data API, only archived.
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
- 2c-3c Live TV: verified on the PC 14 October 2026 (owner's manual tests).
- 3a Notes database, search, security checks and data layer: verified on the
  PC (104 of 104 real checks, integration tests passed).
- 3b-1 Windows tools separated into `tools/windows`, TipTap installed and
  configured: verified on the PC 15 October 2026 (105 of 105 real checks, 17
  integration tests).
- 3b-2 Notes workspace and editor: verified on the PC.
- 3c-1 Autosave, retries, seamless first save, quiet refresh: verified on the PC.
- 3c-2 Local drafts, recovery, kept-aside copies, sign-out choices: verified
  on the PC.
- 3c-3 Conflict resolution (Keep both, Use latest version, Use my version):
  built on the Mac 15 October 2026; awaiting PC verification (no database
  change).
- 3c-4a Desktop shell (Tauri 2 window, single instance, remembered window,
  links to the default browser, strict CSP, NSIS installer): written on the
  Mac 16 October 2026. The owner reports it compiled, installed and working
  on the PC (sign-in, Mission Control, Notes); `Cargo.lock` committed from
  the PC.
- 3c-4b-1 Local backup and proven restore (PGlite): verified on the PC
  (17 tests, a real local backup made and verified).
- 3c-4b-2 Cloud connection tooling, migrations, cloud security checks and
  restore drill: verified on the PC 16 October 2026 (4 migrations applied,
  111 of 111 cloud checks, project empty afterwards, PostgreSQL 17.11).
- 3c-4b-3 Cloud desktop app, local/cloud environments, cloud sign-in tool:
  built on the Mac 16 October 2026; awaiting the owner's build, install and
  checks on the PC (`docs/cloud-desktop.md`). Reported working by the owner
  (cloud app installed, owner account created, password changed).
- Go live at £0: the owner has created the Supabase Cloud project (16 October
  2026). Owner decision 17 October 2026: Nexus Cloud is the primary
  application; the local database holds only disposable test data and is
  NOT migrated (3c-4b-4 dropped). Local Supabase stays for development and
  security testing.
- Settings (account, password change, authenticator status, data and
  privacy): built on the Mac 17 October 2026; awaiting PC checks.
- Phase 4 (core workspace) plan approved 17 October 2026, see below. 4a
  cloud backup and in-use cloud checks: built on the Mac 17 October 2026;
  awaiting PC verification. Next: 4b, only with the owner's approval.
- 3 Hands-off TV after Windows sign-in. Optional: 3b scheduled power-on,
  3c restricted display account. Never automatic sign-in on the main account.
- 4 Daily-use version: pages built from the designs, manual backup and restore.
- 5 Reminders, outside monitor, automatic backup (the MVP). Then seven days of
  daily use before anything further.
- 6 and 7 Built-in assistant. Then calendar, Derwent and Veyra health, daily
  briefing, notes, connectors, approvals and Gmail suggestions.
- Later vision, not scheduled: Nexus Voice & Ambient Intelligence (below).

## Future vision: Nexus Voice & Ambient Intelligence

Recorded 15 October 2026 at the owner's request. Documentation only: do not
build any of it, or any listening feature, until the owner approves a phase.

The long-term goal is a voice-enabled personal AI operating system:

1. Native voice dictation within Notes.
2. Natural spoken conversations with the Nexus AI assistant.
3. Optional wake-word activation and spoken daily briefings.
4. A dedicated Raspberry Pi or similar room device with microphone and
   speaker.
5. Future Omi wearable integration for capturing useful thoughts and
   conversations, subject to privacy and consent requirements.
6. AI extraction of useful notes, ideas and tasks from authorised recordings.
7. Selective retention: private or irrelevant material discarded, with clear
   controls for reviewing and deleting anything stored.
8. AI organisation of captured notes into the relevant projects through the
   planned Smart Inbox.

Privacy is part of the architecture from the start, not added later. AI
classification can never guarantee that sensitive material is not retained,
so the design must not rely on it: consent, capture limits, review before
anything is kept, and easy deletion come first. Other people recorded in
conversations have their own consent and legal rights to respect.

## Open questions

- The cloud project's plan (free assumed), region and PostgreSQL version
  (local is 17); needed before 4b-2.
- Windows details for the TV check: edition, display arrangement and scale,
  everyday browser, virtual desktops.
