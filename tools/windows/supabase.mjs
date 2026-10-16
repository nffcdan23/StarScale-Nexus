// npm run supabase -- <command>
//
// Runs the Supabase command-line tool installed in tools/windows, in the
// project root (where the supabase/ folder is), for the LOCAL stack only.
// For example:
//   npm run supabase -- start
//   npm run supabase -- migration up --local
// Refuses on any other computer, and refuses cloud, reset and --no-backup
// commands (see supabase-cli.mjs).

import { spawnSync } from 'node:child_process'
import { refusedCommand, supabaseEntry } from './supabase-cli.mjs'
import { projectRoot, requireWindows } from './windows-only.mjs'

try {
  requireWindows('The Supabase command-line tool')
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

const args = process.argv.slice(2)
const refusal = refusedCommand(args)
if (refusal) {
  console.error(`Refused: ${refusal}`)
  process.exit(1)
}

const entry = supabaseEntry()
if (!entry) {
  console.error('The Supabase tool is not installed yet. Run: npm run setup:windows')
  process.exit(1)
}

const result = spawnSync(process.execPath, [entry, ...args], { cwd: projectRoot, stdio: 'inherit' })
process.exit(result.status ?? 1)
