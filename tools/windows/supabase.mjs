// npm run supabase -- <command>
//
// Runs the Supabase command-line tool installed in tools/windows, in the
// project root (where the supabase/ folder is). For example:
//   npm run supabase -- start
//   npm run supabase -- migration up --local
// Refuses on any other computer.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectRoot, requireWindows, toolsDir } from './windows-only.mjs'

try {
  requireWindows('The Supabase command-line tool')
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

const manifest = join(toolsDir, 'node_modules', 'supabase', 'package.json')
if (!existsSync(manifest)) {
  console.error('The Supabase tool is not installed yet. Run: npm run setup:windows')
  process.exit(1)
}

// The package's own entry point, which finds the program for this computer.
const { bin } = JSON.parse(readFileSync(manifest, 'utf8'))
const entry = join(dirname(manifest), typeof bin === 'string' ? bin : bin.supabase)

const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], { cwd: projectRoot, stdio: 'inherit' })
process.exit(result.status ?? 1)
