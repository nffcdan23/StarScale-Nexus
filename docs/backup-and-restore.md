# Backing up Nexus

This guide covers backups of the **cloud project** (Phase 4a), where your
real information lives, and of the **local** database on the Windows PC
(Phase 3c-4b-1), which holds only test data. Both run on the Windows PC only.

## What a backup holds

One file with your contexts, projects, tasks and notes, exactly as the
database stores them:

- every note's title and formatted text (headings, lists, checklists, links,
  quotes, code), pinned and archived state, revision number and dates;
- every task's details, deadline, priority, status, completion date and dates;
- every context, including "Show on TV";
- every project, with its context and archived state;
- which context and project each task and note belongs to.

Backups are in format 2 since Phase 4b. A database that does not have
projects yet is backed up in format 1; format 1 backups always remain
readable and restorable (as having no projects, every task and note in the
Inbox).

It never holds anything from sign-in: no account ids, email addresses,
passwords, sessions, tokens or authenticator secrets. Accounts are created
again on the database a backup is restored into. Unsaved draft copies kept by
the app on a computer are not in a backup either.

If the database contains records from other accounts (for example test
accounts), they are left out and the backup says how many.

## Where backups go, and keeping them private

Backups are saved in the `backups` folder inside the project, named by date
and time, for example `backups\nexus-local-2026-10-17-103015.json`.

**A backup is your notes in readable form.** Anyone who can open the file can
read them. So:

- The `backups` folder is excluded from Git, so it is never committed or sent
  to GitHub with the code. Do not move backups into another folder of the
  project.
- Never email a backup, paste it into a chat (including ChatGPT or Claude),
  or upload it anywhere unencrypted.
- If the project folder is inside OneDrive, Dropbox or Google Drive, those
  services copy the backups to the internet. The backup command warns you if
  it sees this. Keep the project in an ordinary folder.

## How a backup is checked

Every file carries two fingerprints, short codes calculated from its
contents. If even one character changes after saving, the check fails and the
file is refused. This catches damage, incomplete copies and accidental edits.
It is not a lock: someone who deliberately edits a file and recalculates the
codes is not stopped, which is another reason to keep backups private.

The backup command then **proves the file can be restored**: it builds a
temporary database from this project's migrations, restores the file into it
with the database's own rules active (so every note's formatting, links and
search text are checked again), puts back the original dates and revisions,
and compares every record with the file. The temporary database exists only
in memory and disappears afterwards.

**The limit of this proof:** the temporary database is PostgreSQL (PGlite)
with a small imitation of Supabase, the same one the simulated security
checks use. It is not real Supabase. That the real cloud database accepts a
restore is proved separately by the restore drill in the cloud security
checks, with fictional records (a real backup cannot be restored beside the
very records it copies).

## Backing up the cloud project (Windows PC)

Needs `.env.cloud.local` and `supabase-ca.crt` (see `docs/cloud-setup.md`) and
the database password, typed into a hidden prompt. No secret key. Docker is
not needed. In a terminal in the project folder:

```
npm run backup:cloud
```

It connects only to your project, over an encrypted connection whose
certificate it checks, and reads through a read-only connection: it cannot
change, reset or overwrite anything. It saves
`backups\nexus-cloud-<date>-<time>.json` and ends with `Backup verified` and a
data fingerprint, or stops with a message in plain English.

Back up before every database change (migration), and regularly anyway.

## Backing up the local database (Windows PC)

The local Supabase stack must be running. Then:

```
npm run backup:local
```

It works the same way, for the local test database.

## Comparing two backups

Around a database change (migration): back up, apply the change, back up
again, then:

```
npm run backup:compare
```

It compares the two newest backups of the same database and ends with `The
same records` when every context, project, task and note is unchanged and
nothing was added or lost. Two particular files:
`npm run backup:compare -- "<before>" "<after>"`.

## Checking a backup later

The newest backup in the `backups` folder:

```
npm run backup:verify
```

Any other backup file, for example your second copy (keep the quotes):

```
npm run backup:verify -- "E:\Nexus backups\nexus-local-2026-10-17-103015.json"
```

## Keeping a second copy

One copy on the same PC does not protect you if the PC fails. Keep a second
copy somewhere private and encrypted:

- **Recommended: your password manager.** If it stores files (1Password calls
  them Documents), add the backup there. It is encrypted, kept off the PC and
  only you can open it.
- **Or an encrypted USB drive** kept at home, away from the PC. On Windows
  Pro, BitLocker To Go encrypts a USB drive (right-click the drive in File
  Explorer, Turn on BitLocker). Windows Home does not offer it.

Not suitable: an ordinary USB stick, email, chat apps, or a cloud folder
unless the file is inside an encrypted container.

After copying, check the copy with `npm run backup:verify -- "<path>"`. It
must show the same data fingerprint as the original.

Old backups are never deleted automatically. Remove ones you no longer need
yourself.

## Restoring

There is no command to restore into a real database yet: one would only be
built, with its own approval, if a restore were ever needed. The restore code
only ever writes into an **empty** database, all or nothing, so it cannot
overwrite anything.

## For future changes

`scripts/backup/format.mjs` lists every column a backup holds. When a
migration changes the contexts, tasks or notes tables, that list and the
restore must change in the same commit. The tools refuse a database whose
columns differ, so nothing can be silently left out.
