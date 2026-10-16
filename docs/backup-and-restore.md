# Backing up Nexus

Phase 3c-4b-1. This guide covers backups of the **local** database on the
Windows PC. Backups of the cloud database come in a later checkpoint.

## What a backup holds

One file with your contexts, tasks and notes, exactly as the database stores
them:

- every note's title and formatted text (headings, lists, checklists, links,
  quotes, code), pinned and archived state, revision number and dates;
- every task's details, deadline, priority, status, completion date and dates;
- every context, including "Show on TV";
- which context each task and note belongs to.

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
checks use. It is not real Supabase. Restoring into a real Supabase database
must still be proved, and is part of the next checkpoint (3c-4b-2). Until
then, treat a backup as proven against the project's database design, not
against Supabase itself.

## Making a backup (Windows PC)

The local Supabase stack must be running, as it is when you use Nexus
locally. In a terminal in the project folder:

```
npm run backup:local
```

It reads the database through a read-only connection: it cannot change,
reset or overwrite anything. It ends with `Backup verified` and a data
fingerprint, or stops with a message in plain English.

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

There is no restore into your real database yet. The restore code only ever
writes into an **empty** database, all or nothing, so it cannot overwrite
anything. It will be used to move your data into the cloud project, after
backups have been proved against real Supabase (Phase 3c-4b-2 onwards).

## For future changes

`scripts/backup/format.mjs` lists every column a backup holds. When a
migration changes the contexts, tasks or notes tables, that list and the
restore must change in the same commit. The tools refuse a database whose
columns differ, so nothing can be silently left out.
