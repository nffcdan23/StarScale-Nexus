// The Supabase command-line tool installed in tools/windows, and the rules
// for what `npm run supabase` may ask it to do.
//
// `npm run supabase` is for the LOCAL stack only. It refuses:
//   * anything aimed at a cloud project or the Supabase platform: cloud work
//     goes only through npm run cloud:status and npm run cloud:migrate;
//   * resetting a database, and stopping the stack with --no-backup (which
//     deletes the local data): Nexus never runs either.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { toolsDir } from './windows-only.mjs'

const PLATFORM_COMMANDS = new Set([
  'link',
  'unlink',
  'login',
  'logout',
  'projects',
  'orgs',
  'branches',
  'secrets',
  'functions',
  'sso',
  'domains',
  'vanity-subdomains',
  'network-bans',
  'network-restrictions',
  'ssl-enforcement',
  'postgres-config',
  'snippets',
  'backups',
  'encryption',
  'config',
])
const CLOUD_FLAGS = ['--linked', '--db-url', '--project-ref']

/** Why `npm run supabase` refuses these arguments, or null if they are allowed. */
export function refusedCommand(args) {
  const words = args.filter((arg) => !arg.startsWith('-'))
  if (args.some((arg) => CLOUD_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`))) || PLATFORM_COMMANDS.has(words[0])) {
    return 'npm run supabase works only with the local stack. For the cloud project use npm run cloud:status or npm run cloud:migrate.'
  }
  if (words[0] === 'db' && words[1] === 'reset') {
    return 'Nexus never resets a database: that would delete everything in it.'
  }
  if (words[0] === 'stop' && args.includes('--no-backup')) {
    return 'Stopping with --no-backup deletes the local database. Use npm run supabase -- stop'
  }
  return null
}

/** The installed tool's own entry point, which finds the program for this computer. */
export function supabaseEntry() {
  const manifest = join(toolsDir, 'node_modules', 'supabase', 'package.json')
  if (!existsSync(manifest)) return null
  const { bin } = JSON.parse(readFileSync(manifest, 'utf8'))
  return join(dirname(manifest), typeof bin === 'string' ? bin : bin.supabase)
}
