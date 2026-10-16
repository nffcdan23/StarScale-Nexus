# The cloud desktop app: first install and checks

Phase 3c-4b-3, on the **Windows PC**. You need the cloud project from
`docs/cloud-setup.md`: migrated, verified (111 of 111) and empty.

**Use made-up (fictional) records only.** Real notes and tasks move to the
cloud only in 3c-4b-4, after its own approval.

Your existing local app is not changed by any of this. The cloud app installs
beside it as **StarScale Nexus Cloud**, with its own sign-in and its own
storage.

## 1. Get ready

Get the latest checkpoint onto the PC, then:

```
npm ci
```

```
npm run setup:windows
```

No new packages. `.env.cloud.local` and `supabase-ca.crt` from Phase 3c-4b-2
are used as they are. Check the project is still empty and fully migrated:

```
npm run cloud:status
```

## 2. Build and install the cloud app

Docker is not needed for this.

```
npm run desktop:build:cloud
```

Check the line `Connects only to: https://<your project id>.supabase.co`, and
that the bundle check line shows that same address and no other. Then run
`src-tauri\target\release\bundle\nsis\StarScale Nexus Cloud_0.1.0_x64-setup.exe`
(see `docs/desktop-app.md` about the Windows warning). Keep **Create desktop
shortcut** ticked.

## 3. Create your owner sign-in

1. In the Supabase dashboard: Project Settings → API Keys → create a secret
   key named `nexus-pc-temporary`. Keep the page open.
2. Run, with the email address you want to sign in with:

   ```
   npm run cloud:account -- owner --email you@example.com
   ```

   Type the database password, then paste the secret key (nothing shows), then
   type the project id to confirm. It shows a new password **once**: save it in
   your password manager straight away.

This is a new sign-in in the cloud project. Nothing is copied from the local
database, and your local sign-in and authenticator are unchanged.

## 4. Set up your authenticator (straight away)

1. Open **StarScale Nexus Cloud** and sign in with that email and password.
2. Nexus asks you to set up an authenticator: scan the code with your
   authenticator app and type the six-digit code.
3. In your authenticator app, rename the new entry to **Nexus Cloud**, so you
   can tell it apart from the local one.

Until this step is done, anyone with the password could set up their own
authenticator, so do it before using the password anywhere else.

## 5. Create the TV sign-in

```
npm run cloud:account -- tv --email office-tv@example.com
```

Save its password too. Then **delete the temporary secret key** in the
dashboard (API Keys → the key's menu → Delete). To see the sign-ins at any
time (needs only the database password):

```
npm run cloud:account -- list
```

## Changing a sign-in's password

Use this if a password has been exposed (for example in a screenshot) or you
want one of your own. It keeps the account, its role and its authenticator;
it does not use the password-reset email. Create a temporary secret key in the
dashboard first, then:

```
npm run cloud:account -- password --email you@example.com
```

Type the database password, paste the secret key, type the project id to
confirm, then type the new password twice (nothing shows; at least 12
characters). The old password stops working at once. Save the new one in your
password manager, then delete the temporary secret key.

## 6. Check Mission Control, Tasks and Notes (fictional records)

In StarScale Nexus Cloud, signed in as the owner:

1. **Tasks:** open the contexts manager and add a context named
   `Fictional test` with **Show on TV** on. Add a task "Fictional task" due
   today in that context, and a second one, then mark the second one done.
2. **Mission Control:** "Fictional task" appears under Today; the progress
   card counts the finished one.
3. **Notes:** add a note "Fictional note" in `Fictional test`, with a heading,
   a sentence and a checklist. Wait for "Saved". Search for `fictional`.

Keep every test record in the `Fictional test` context. They stay in the cloud
project afterwards (Nexus never deletes, only archives), and 3c-4b-4 has to
deal with them before your real data moves.

## 7. Docker is not needed

Quit Docker Desktop (the whale icon by the clock → Quit Docker Desktop). Close
StarScale Nexus Cloud completely and open it again. It should open signed in
and show the fictional records. (The local app cannot reach its database while
Docker is off. That is expected.)

## 8. Accounts stay separate

1. In the cloud app, none of your local notes, tasks or contexts appear: only
   the fictional ones.
2. Sign out (bottom of the sidebar). Sign in as the **TV**. It should go
   straight to the TV display, show "Fictional task", show no notes, and offer
   no other pages. Sign out through the TV's settings menu (move the mouse,
   open the menu, Sign out, confirm).
3. Sign in as the owner again (password and code).
4. Later, with Docker running again, open the local app: your local data is
   all there, unchanged, under your local sign-in.

## 9. Offline recovery

1. In the cloud app, open "Fictional note".
2. Turn off Wi-Fi (or unplug the network cable).
3. Type a new sentence. The note should say its changes are kept on this
   computer, not saved yet. Within about 30 seconds Mission Control should say
   its information may be out of date.
4. Close the app completely, then open it again, still offline, within a few
   minutes. Open "Fictional note": your new sentence should be there.
5. Turn the network back on. Within a few seconds the note should show
   "Saved", and Mission Control should refresh.

## 10. Optional: mark the local app as local

The local app installed in 3c-4a still says "StarScale Nexus" in its window
title. To make it say "(Local)", rebuild and reinstall it. With Docker and the
local stack running:

1. Open the local app → Notes. Make sure nothing is listed under "Not saved
   yet" and no note shows unsaved changes or a version to resolve. (The update
   keeps them anyway; this is a precaution.)
2. Build it:

   ```
   npm run desktop:build:local
   ```

3. Run `StarScale Nexus_0.1.0_x64-setup.exe`. It updates the local app in
   place and keeps its sign-in and drafts. If it offers to uninstall first,
   **never** tick "Delete the application data".

## 11. Send back

For each of steps 2 to 9 (and 10 if done), say whether it worked. Include any
message shown, but never a password or key.
