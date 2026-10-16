// npm run desktop:build:cloud   the everyday app, connected only to the Supabase Cloud project
// npm run desktop:build:local   the local app, connected only to the local Supabase stack
//
// Windows only. Builds the app and its installer for one variant (see
// desktop-variants.mjs). The app is given exactly two public values, its
// Supabase address and publishable key; every other VITE_ setting is
// removed, and scripts/check-bundle.mjs then fails the build unless the app
// contains that one address and no other. The cloud values come from
// .env.cloud.local, the local ones from .env.local. Building never creates
// accounts and never connects to any database.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseEnv } from 'node:util'
import { cloudAppSettings } from '../../scripts/cloud/settings.mjs'
import { buildEnvironment, desktopOverlay, VARIANTS, variantOf } from './desktop-variants.mjs'
import { ensureIcons, runTauri, tauriEntry } from './tauri-cli.mjs'
import { projectRoot, requireWindows } from './windows-only.mjs'

// Refuse on any other computer before reading anything.
try {
  requireWindows('The desktop build')
} catch (error) {
  stop(error.message)
}

function stop(message) {
  console.error(`\nDesktop build stopped: ${message}\n`)
  process.exit(1)
}

function readEnvFile(name) {
  const file = join(projectRoot, name)
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : null
}

function cloudValues() {
  const env = readEnvFile('.env.cloud.local')
  if (!env) stop('.env.cloud.local is missing. Copy .env.cloud.example and fill it in (docs/cloud-setup.md).')
  const { apiUrl, publishableKey } = cloudAppSettings(env)
  return { url: apiUrl, publishableKey }
}

function localValues() {
  const env = readEnvFile('.env.local')
  if (!env) stop('.env.local is missing. Copy .env.example and fill it in from the local stack.')
  const url = (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/$/, '')
  const publishableKey = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()
  if (variantOf(url) !== 'local') {
    stop(`VITE_SUPABASE_URL in .env.local must be the local stack (http://127.0.0.1:54321), not "${url}".`)
  }
  if (!publishableKey || publishableKey.startsWith('sb_secret_')) {
    stop('VITE_SUPABASE_PUBLISHABLE_KEY in .env.local must be the local publishable key.')
  }
  return { url, publishableKey }
}

const variant = process.argv[2]
if (!VARIANTS[variant]) stop('use npm run desktop:build:cloud or npm run desktop:build:local')
const entry = tauriEntry()
if (!entry) stop('the Tauri tool is not installed yet. Run: npm run setup:windows')

let values
try {
  values = variant === 'cloud' ? cloudValues() : localValues()
} catch (error) {
  stop(error.message)
}

const base = JSON.parse(readFileSync(join(projectRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const overlay = desktopOverlay(variant, base, values.url)
const overlayDir = join(projectRoot, 'src-tauri', 'target')
mkdirSync(overlayDir, { recursive: true })
const overlayPath = join(overlayDir, `nexus-${variant}.conf.json`)
writeFileSync(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`)

console.log(`\nBuilding ${overlay.productName} (${variant})`)
console.log(`  Connects only to: ${values.url}`)
console.log(`  Keeps its sign-in and drafts in: %LOCALAPPDATA%\\${overlay.identifier}`)
console.log(`  Window title: ${overlay.app.windows[0].title}\n`)

if (!ensureIcons(entry)) process.exit(1)
if (runTauri(entry, ['build', '--config', overlayPath], buildEnvironment(process.env, values)) !== 0) {
  stop('the build failed; see the messages above. Nothing was installed.')
}

const bundleDir = join(projectRoot, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const installers = existsSync(bundleDir)
  ? readdirSync(bundleDir).filter((name) => name.startsWith(`${overlay.productName}_`) && name.endsWith('-setup.exe'))
  : []
console.log(`\nBuilt ${overlay.productName}.`)
for (const name of installers) console.log(`Installer: ${relative(projectRoot, join(bundleDir, name))}`)
console.log('Nothing has been installed yet. See docs/desktop-app.md before installing.\n')
