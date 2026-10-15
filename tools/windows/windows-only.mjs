// Shared by the Windows-only tools: they refuse to run anywhere else, so the
// work MacBook never installs or runs the PostgreSQL client or the Supabase
// command-line tool.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** This folder, tools/windows. */
export const toolsDir = dirname(fileURLToPath(import.meta.url))

/** The project root, two folders up. */
export const projectRoot = join(toolsDir, '..', '..')

export function requireWindows(what) {
  if (process.platform !== 'win32') {
    throw new Error(`${what} runs only on the Windows PC. This computer is ${process.platform}.`)
  }
}
