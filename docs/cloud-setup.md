# Setting up the cloud project

Phase 3c-4b-2. Everything here happens on the **Windows PC**. The MacBook
never connects to the cloud project, and the tools refuse to run on it.

At the end of this guide the cloud project has Nexus's tables and access
rules, and has passed every security check against the real cloud database.
It still holds **no accounts and no data**. Accounts and the cloud version of
the desktop app come in 3c-4b-3; moving your data comes in 3c-4b-4.

## Secrets: the rules

Two values are secret: the **database password** and the **secret key**
(`sb_secret_...`). Anyone with either can read and change everything.

- Keep the database password in your password manager.
- Create a secret key only when a step below needs it, and delete it when you
  have finished (step 9).
- The Nexus tools ask for both in a hidden prompt (nothing appears as you type
  or paste) and never store them.
- Never put either in a file, a screenshot or a chat (including this one and
  ChatGPT).

Everything else in this guide (project id, publishable key, pooler address,
certificate) is not secret.

## Part 1: dashboard settings (in your browser, at supabase.com)

1. **Your own Supabase login:** make sure two-factor authentication is on
   (your avatar, top right → Account preferences → Security).
2. Open the Nexus project. **Authentication → Sign In / Providers:**
   - "Allow new users to sign up": **off**.
   - Email: **on** (Nexus signs in with email and password).
   - Phone, anonymous sign-ins and every social provider (Google, Apple and
     so on): **off**. They are off unless someone turned them on.
3. **Authentication → Multi-Factor:** the authenticator app (TOTP) must be
   enabled. It is by default; leave phone off.
4. **Database password:** if it is not already in your password manager,
   reset it under Project Settings → Database → Reset database password and
   save the new one there. The project is empty, so this is harmless.
5. **Note these three things** for Part 2:
   - Project Settings → General → **Project ID** (20 letters).
   - Project Settings → API Keys → the **publishable key** (`sb_publishable_...`).
   - The **Connect** button at the top → **Session pooler**. The address looks
     like `postgresql://postgres.<project id>:[YOUR-PASSWORD]@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`.
     You need only the host: the part between `@` and `:5432`.
6. **Certificate:** Project Settings → Database → SSL Configuration →
   Download certificate. Save the file in the Nexus project folder and rename
   it to `supabase-ca.crt`. It lets the tools check they are really talking to
   Supabase before sending your password. Git ignores it.

## Part 2: the settings file

In the project folder, copy `.env.cloud.example` to `.env.cloud.local`. In
PowerShell:

```
Copy-Item .env.cloud.example .env.cloud.local
```

Open `.env.cloud.local` in Notepad and fill in the three values from step 5,
with nothing else on each line:

```
NEXUS_CLOUD_PROJECT_REF=<project id>
NEXUS_CLOUD_PUBLISHABLE_KEY=<sb_publishable_...>
NEXUS_CLOUD_DB_HOST=<aws-0-....pooler.supabase.com>
```

Git ignores this file. Never add the password or a secret key to it: the
tools refuse to start if a secret key is in it.

## Part 3: check, apply, verify

Get the latest checkpoint onto the PC and run `npm ci` first. No new packages
are needed.

**Step 1. Read-only check:**

```
npm run cloud:status
```

Type the database password when asked. It should show the publishable key
accepted, an encrypted connection with the certificate verified,
`Migrations: 0 of 4 applied`, every count 0 (empty), and the sign-in settings
correct. It changes nothing. If a sign-in setting needs fixing, fix it in the
dashboard and run it again.

**Step 2. Apply the migrations (the one permanent change):**

```
npm run cloud:migrate
```

Type the database password. It lists the 4 migrations and shows the Supabase
tool's own preview, which changes nothing. Then it asks you to **type the
project id** to go ahead. If the Supabase tool then lists the migrations
again and asks `Y/n`, answer `y`. It should end with
`All 4 migrations applied and recorded.`

This adds Nexus's tables, functions and access rules. It creates no accounts
and adds no data. Only do it if step 1 looked right.

**Step 3. Start the local stack.** The checks compare the cloud database's
structure with your local database, reading only. Start Docker Desktop, then:

```
npm run supabase -- start
```

**Step 4. Create a temporary secret key:** Project Settings → API Keys →
Secret keys → create one named `nexus-pc-temporary`. Keep the page open.

**Step 5. Run the cloud security checks:**

```
npm run test:security:cloud
```

The simulated checks run first (about a minute). Then it asks for the
database password, then the secret key (copy it from the dashboard and
paste: nothing will show). It checks the project is migrated and empty,
explains what it will do, and asks you to **type the project id**.

It then runs every access check, signs in with two temporary test accounts
(created and deleted by the run), compares the structure with your local
database, and restores a fictional backup inside a step that is undone. It
should end with:

```
Cloud project checks: 111 passed, 0 failed, 0 not executed, of 111
```

**Step 6. Confirm the project is empty again:**

```
npm run cloud:status
```

It should show `all 4 applied` and every count 0.

**Step 7. Record the results.** The run wrote
`tests/security/cloud/results.json` and updated `docs/security-report.md`.
These contain no secrets and no data. Commit them:

```
git add tests/security/cloud/results.json docs/security-report.md
```

```
git commit -m "Record cloud security results"
```

**Step 8.** Send back the last lines of steps 1, 2, 5 and 6: counts and
pass or fail only.

**Step 9. Delete the temporary secret key** in the dashboard (API Keys →
the key's menu → Delete). A new one can be made whenever it is needed again.

## If something goes wrong

- The tools stop with a plain message and change nothing they have not
  announced. The messages never contain your password or keys.
- `the project is not empty`: the checks run only on an empty project. If
  `nexus-test-` accounts were left behind by an interrupted run, delete them
  under Authentication → Users, then run the checks again. Nothing is ever
  deleted automatically.
- `certificate could not be verified`: download the certificate again (Part
  1, step 6). If it still fails, stop and send the message.
- Do not try other commands against the cloud project. `npm run supabase`
  refuses cloud commands, database resets and `stop --no-backup` on purpose.

## What each command does

| Command | Changes the cloud project? |
|---|---|
| `npm run cloud:status` | No. Read-only connection |
| `npm run cloud:migrate` | Yes, only after you type the project id: adds the missing migrations, in order. Never resets, never adds seed data, refuses any migration that would delete or change stored data |
| `npm run cloud:account -- owner\|tv --email ADDRESS` | Yes, only after you type the project id, and only once the cloud checks are recorded as passed: creates one sign-in (Phase 3c-4b-3, `docs/cloud-desktop.md`). `list` changes nothing |
| `npm run cloud:account -- password --email ADDRESS` | Only that sign-in's password, after you type the project id; the new password is typed twice, hidden. Nothing created or deleted |
| `npm run test:security:cloud` | Only temporarily, only after you type the project id, and only on an empty project: test accounts and made-up records that the run removes. Access checks and the restore drill are undone |
| `npm run test:security:cloud-live` | No. For the project in use: after you type the project id, every check runs inside a step that is undone, no accounts are made, and it proves afterwards that every existing record is unchanged (see below) |
| `npm run backup:cloud` | No. Read-only connection; saves a proven backup in the `backups` folder |

## Checking the project in use (Phase 4a)

Once the project holds your accounts and records, the full run above refuses
(it needs an empty project). After any database change, check the project
with:

```
npm run test:security:cloud-live
```

1. **Close Nexus on every device** first: the last check proves nothing in the
   project changed, and your own edits would show up as changes.
2. Have Docker Desktop and the local stack running (`npm run supabase --
   start`): the structure is compared with the local database, reading only.
3. Type the database password (hidden) and then the project id. No secret key.
4. It should end with `Cloud project checks (in use): 102 passed, 0 failed, 0
   not executed, of 102`.

It runs every access check and REAL-01 inside transactions that are always
undone, compares the structure with the local database, restores a fictional
backup for a stand-in owner inside a transaction that is undone, and compares
a fingerprint of every account, sign-in, context, task and note before and
after (LIVE-06). It never creates accounts, so the sign-in checks REAL-02 to
REAL-10 stay proven by the last full run. Results go to
`tests/security/cloud/live-results.json` and `docs/cloud-security-report.md`,
separate from the local report.

## Applying a new migration (from Phase 4b)

Every database change goes to the local stack first, then to the cloud
project, with a proven backup on each side before and after. Nothing is ever
reset. Keep Nexus closed on every device from step 6 to step 10.

**Local stack** (Docker Desktop running, `npm run supabase -- start`):

1. `npm run backup:local`: ends with `Backup verified`.
2. `npm run supabase -- migration up --local`: applies only the new migration.
3. `npm run backup:local` again, then `npm run backup:compare`: ends with
   `The same records`.
4. `npm run test:security:real`: every check passes.
5. `npm run test:integration`: every test passes.

**Cloud project:**

6. `npm run backup:cloud`: ends with `Backup verified`.
7. `npm run cloud:migrate`: lists only the new migration and the Supabase
   tool's preview; type the project id to go ahead (answer `y` if asked).
8. `npm run test:security:cloud-live`: every check passes.
9. `npm run backup:cloud` again, then `npm run backup:compare`: ends with
   `The same records`.
10. Open the installed cloud app: Mission Control, Tasks and Notes work as
    before.

Then commit `tests/security/real/results.json`,
`tests/security/cloud/live-results.json`, `docs/security-report.md` and
`docs/cloud-security-report.md`.

A backup made before the migration may be in an older format (for example
format 1, before projects). That is expected: it still restores, and
`backup:compare` reads it as the migration leaves the records.
