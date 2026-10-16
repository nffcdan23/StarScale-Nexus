# StarScale Nexus desktop app (Windows)

The desktop app is the same Nexus, packed into a Windows program with its own
window (Tauri 2). It is built only on the Windows PC; the MacBook never
installs Rust or builds it.

## One-time set-up on the Windows PC

1. Install **Microsoft C++ Build Tools** (Visual Studio Build Tools) with the
   workload **Desktop development with C++**. Needs administrator rights and
   several GB of disk space.
2. Install **Rust** with `rustup-init.exe` from https://rustup.rs, accepting
   the defaults (the stable MSVC toolchain, installed in your user folder).
3. **WebView2** (the Edge engine the window uses) is already part of Windows
   10 and 11; nothing to install.
4. Close and reopen the terminal so it finds Rust.

## Build and install

From the Nexus folder, with the local Supabase stack running
(`npm run supabase -- start`) and `.env.local` filled in as for the browser:

```
npm ci
npm run setup:windows
npm run desktop:build
```

The first build takes a while: it makes the app icons from
`src-tauri/app-icon.svg`, downloads the Rust libraries and Tauri's installer
tools, then compiles. The installer appears in
`src-tauri\target\release\bundle\nsis\` (a file ending `-setup.exe`).

Run it. The installer is not code-signed, so Windows may show a SmartScreen or
unknown-publisher warning. Continue only for the file you have just built,
from that folder. On the last page, keep **Create desktop shortcut** ticked.
It installs for your user only (no administrator rights) and adds a Start
menu entry.

To update: pull, run `npm run desktop:build` again and run the new installer.
It replaces the app and keeps your sign-in and note drafts.

## Things to know

- The app keeps its own sign-in and its own unsaved note drafts, separate from
  Chrome. Before switching, make sure Chrome's Notes list shows no "Not saved
  yet" notes or "Unsaved changes on this computer". Sign in once in the app
  with your password and authenticator code.
- Its data lives under `%LOCALAPPDATA%\uk.co.starscale.nexus`. The identifier
  `uk.co.starscale.nexus` and the setting `useHttpsScheme: false` must never
  change, or the app would lose its sign-in and drafts.
- The app only reaches the Supabase address in its security policy
  (`src-tauri/tauri.conf.json`, `connect-src`): currently the local stack at
  http://127.0.0.1:54321. `npm run desktop:build` stops with an explanation if
  `.env.local` points elsewhere.
- Links in notes open in your default browser; only web and email links.
- The TV stays in a browser at `/tv`, not in the desktop app.
- For development on the PC, `npm run tauri -- dev` opens the app on the Vite
  development server (it needs `npm run dev`'s port 5180 free).
