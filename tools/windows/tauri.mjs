// npm run tauri -- <command>
//
// Runs the Tauri command-line tool installed in tools/windows, in the project
// root. Windows only. For example:
//   npm run tauri -- dev       opens the local app on the Vite development server
//
// Building goes only through npm run desktop:build:cloud or
// npm run desktop:build:local (desktop-build.mjs), which choose the app's
// name, storage and Supabase address together, so `build` is refused here.
//
// Before dev it makes the Windows icons from src-tauri/app-icon.svg if they
// are missing, and checks that the development security policy lets the app
// reach the Supabase address in .env.local; otherwise the app could not sign
// in, so it stops with a plain explanation instead.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureIcons, runTauri, tauriEntry } from './tauri-cli.mjs'
import { projectRoot, requireWindows } from './windows-only.mjs'

try {
  requireWindows('The Tauri desktop build')
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

const entry = tauriEntry()
if (!entry) {
  console.error('The Tauri tool is not installed yet. Run: npm run setup:windows')
  process.exit(1)
}

/** The Supabase address the development app uses, from .env.local. */
function supabaseOrigin() {
  const file = join(projectRoot, '.env.local')
  if (!existsSync(file)) return null
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((entry) => /^\s*VITE_SUPABASE_URL\s*=/.test(entry))
  const value = line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '')
  try {
    return value ? new URL(value).origin : null
  } catch {
    return null
  }
}

const args = process.argv.slice(2)
if (args[0] === 'build') {
  console.error('Use npm run desktop:build:cloud (everyday app) or npm run desktop:build:local (local app).')
  process.exit(1)
}
if (args[0] === 'dev') {
  const origin = supabaseOrigin()
  if (!origin) {
    console.error('No VITE_SUPABASE_URL in .env.local. The app needs it to sign in; see .env.example.')
    process.exit(1)
  }
  const config = JSON.parse(readFileSync(join(projectRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  if (!config.app.security.devCsp['connect-src'].split(/\s+/).includes(origin)) {
    console.error(
      `The development security policy does not allow ${origin} (VITE_SUPABASE_URL in .env.local).\n` +
        'npm run tauri -- dev is for the local stack only.',
    )
    process.exit(1)
  }
  if (!ensureIcons(entry)) process.exit(1)
}

process.exit(runTauri(entry, args))
