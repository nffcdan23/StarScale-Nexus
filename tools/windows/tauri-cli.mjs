// The Tauri command-line tool installed in tools/windows. Windows only.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectRoot, toolsDir } from './windows-only.mjs'

/** The installed tool's own entry point, or null if it is not installed yet. */
export function tauriEntry() {
  const manifest = join(toolsDir, 'node_modules', '@tauri-apps', 'cli', 'package.json')
  if (!existsSync(manifest)) return null
  const { bin } = JSON.parse(readFileSync(manifest, 'utf8'))
  return join(dirname(manifest), typeof bin === 'string' ? bin : bin.tauri)
}

/** Runs the tool in the project root and returns its exit code. */
export function runTauri(entry, args, env = process.env) {
  return spawnSync(process.execPath, [entry, ...args], { cwd: projectRoot, stdio: 'inherit', env }).status ?? 1
}

/** Makes the Windows icons from src-tauri/app-icon.svg if they are missing. True when they exist. */
export function ensureIcons(entry) {
  if (existsSync(join(projectRoot, 'src-tauri', 'icons', 'icon.ico'))) return true
  console.log('Making the app icons from src-tauri/app-icon.svg (first build only)…')
  return runTauri(entry, ['icon', join('src-tauri', 'app-icon.svg')]) === 0
}
