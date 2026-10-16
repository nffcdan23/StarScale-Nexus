# StarScale Nexus desktop apps (Windows)

The desktop app is the same Nexus, packed into a Windows program with its own
window (Tauri 2). It is built only on the Windows PC; the MacBook never
installs Rust or builds it.

There are two apps, built from the same code (Phase 3c-4b-3):

| | StarScale Nexus Cloud | StarScale Nexus |
|---|---|---|
| For | everyday use | development and testing |
| Connects to | the Supabase Cloud project only | the local Supabase stack only |
| Needs Docker | no | yes |
| Window title | StarScale Nexus | StarScale Nexus (Local) |
| Keeps its sign-in and drafts in | `%LOCALAPPDATA%\uk.co.starscale.nexus.cloud` | `%LOCALAPPDATA%\uk.co.starscale.nexus` |
| Build with | `npm run desktop:build:cloud` | `npm run desktop:build:local` |

They install side by side, each with its own Start menu entry (both in the
"StarScale Nexus" folder), and can run at the same time. Each keeps its own
sign-in and its own unsaved note drafts: nothing made in one is ever shown in,
or saved to, the other. The local app is the one installed in Phase 3c-4a;
installing the cloud app does not touch it.

## One-time set-up on the Windows PC

1. Install **Microsoft C++ Build Tools** (Visual Studio Build Tools) with the
   workload **Desktop development with C++**. Needs administrator rights and
   several GB of disk space.
2. Install **Rust** with `rustup-init.exe` from https://rustup.rs, accepting
   the defaults (the stable MSVC toolchain, installed in your user folder).
3. **WebView2** (the Edge engine the window uses) is already part of Windows
   10 and 11; nothing to install.
4. Close and reopen the terminal so it finds Rust.

## Build

From the Nexus folder:

```
npm ci
npm run setup:windows
```

Then one of:

```
npm run desktop:build:cloud
```

```
npm run desktop:build:local
```

- The **cloud** app is built with the project id and publishable key in
  `.env.cloud.local` (see `docs/cloud-setup.md`). Nothing else: no password,
  no secret key. Building does not need Docker and does not connect to
  anything.
- The **local** app is built with the address and publishable key in
  `.env.local`, which must be the local stack.

Each build prints the one Supabase address the app will use. The build stops
if the finished app contains any other Supabase address, any secret, or any
setting other than those two. The first build takes a while (icons, Rust
libraries, installer tools). The installer appears in
`src-tauri\target\release\bundle\nsis\`:
`StarScale Nexus Cloud_<version>_x64-setup.exe` or
`StarScale Nexus_<version>_x64-setup.exe`.

## Install and update

Run the installer you have just built. It is not code-signed, so Windows may
show a SmartScreen or unknown-publisher warning: continue only for the file
you have just built, from that folder. It installs for your user only (no
administrator rights). On the last page, keep **Create desktop shortcut**
ticked.

To update an app: build it again and run its new installer. It replaces the
program and keeps that app's sign-in and note drafts. **If the installer
offers to uninstall first, never tick "Delete the application data"**: that
would remove the unsaved drafts kept on this computer.

## Things to know

- The identifier and the name of each app must never change once installed,
  nor `useHttpsScheme: false`: the app would lose its sign-in and drafts. They
  are fixed in `tools/windows/desktop-variants.mjs`.
- Each app's security policy allows exactly one outside address: its own
  Supabase. Links in notes open in your default browser; only web and email
  links.
- Unsaved note drafts are filed per database as well, so even a browser that
  has used both could never mix them.
- The TV stays in a browser at `/tv` (the local web app for now), not in a
  desktop app.
- `npm run tauri -- build` is refused: build only with the two commands above.
  For development, `npm run tauri -- dev` opens the local app on the Vite
  development server (it needs port 5180 free).
