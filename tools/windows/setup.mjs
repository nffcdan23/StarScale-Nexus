// npm run setup:windows
//
// Installs the Windows-only tools (tools/windows/package.json) exactly as
// recorded in tools/windows/package-lock.json. Refuses on any other computer.

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { projectRoot, requireWindows, toolsDir } from './windows-only.mjs'

try {
  requireWindows('Installing the Windows tools')
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

// npm run sets npm_execpath to npm's own script, so this works without a shell.
const npm = process.env.npm_execpath
if (!npm) {
  console.error('Run this through npm: npm run setup:windows')
  process.exit(1)
}

const result = spawnSync(
  process.execPath,
  [npm, 'ci', '--prefix', toolsDir, '--cache', join(projectRoot, '.npm-cache'), '--ignore-scripts', '--no-audit'],
  { cwd: projectRoot, stdio: 'inherit' },
)
process.exit(result.status ?? 1)
