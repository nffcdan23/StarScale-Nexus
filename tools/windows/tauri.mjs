// npm run tauri -- <command>
//
// Runs the Tauri command-line tool installed in tools/windows, in the project
// root. Windows only. For example:
//   npm run tauri -- build     builds the app and its installer
//   npm run tauri -- dev       opens the app on the Vite development server
//
// Before build or dev it makes the Windows icons from src-tauri/app-icon.svg
// if they are missing, and checks that the app's security policy lets it
// reach the Supabase address in .env.local; otherwise the app could not sign
// in, so it stops with a plain explanation instead.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectRoot, requireWindows, toolsDir } from './windows-only.mjs'

try {
  requireWindows('The Tauri desktop build')
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

const manifest = join(toolsDir, 'node_modules', '@tauri-apps', 'cli', 'package.json')
if (!existsSync(manifest)) {
  console.error('The Tauri tool is not installed yet. Run: npm run setup:windows')
  process.exit(1)
}
const { bin } = JSON.parse(readFileSync(manifest, 'utf8'))
const entry = join(dirname(manifest), typeof bin === 'string' ? bin : bin.tauri)

const tauri = (args) => spawnSync(process.execPath, [entry, ...args], { cwd: projectRoot, stdio: 'inherit' }).status ?? 1

/** The Supabase address the app will be built with, from .env.local. */
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
if (args[0] === 'build' || args[0] === 'dev') {
  const origin = supabaseOrigin()
  if (!origin) {
    console.error('No VITE_SUPABASE_URL in .env.local. The app needs it to sign in; see .env.example.')
    process.exit(1)
  }
  const config = JSON.parse(readFileSync(join(projectRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  const policy = args[0] === 'dev' ? config.app.security.devCsp : config.app.security.csp
  if (!policy['connect-src'].split(/\s+/).includes(origin)) {
    console.error(
      `The app's security policy does not allow ${origin} (VITE_SUPABASE_URL in .env.local).\n` +
        'Add it to connect-src in src-tauri/tauri.conf.json, or ask Claude to, then build again.',
    )
    process.exit(1)
  }

  if (!existsSync(join(projectRoot, 'src-tauri', 'icons', 'icon.ico'))) {
    console.log('Making the app icons from src-tauri/app-icon.svg (first build only)…')
    if (tauri(['icon', join('src-tauri', 'app-icon.svg')]) !== 0) process.exit(1)
  }
}

process.exit(tauri(args))
