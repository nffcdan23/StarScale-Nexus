// Runs after every build. Fails if the built app could leak a secret: a
// Supabase secret key, a service-role token, administrator script code, or
// any browser setting other than the two that are public by design.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(projectRoot, 'dist')
const allowedBrowserSettings = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'])
const problems = []

// 1. Browser settings: anything starting VITE_ is copied into the app.
const envFiles = ['.env', '.env.local', '.env.production', '.env.production.local']
for (const name of envFiles) {
  const path = join(projectRoot, name)
  if (!existsSync(path)) continue
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const key = line.match(/^\s*(VITE_[A-Z0-9_]+)\s*=/)?.[1]
    if (key && !allowedBrowserSettings.has(key)) problems.push(`${name} sets ${key}, which is not allowed in the app`)
  }
}
for (const key of Object.keys(process.env)) {
  if (key.startsWith('VITE_') && !allowedBrowserSettings.has(key)) {
    problems.push(`the environment sets ${key}, which is not allowed in the app`)
  }
}

// 2. The built files themselves.
if (!existsSync(distDir)) {
  problems.push('dist/ does not exist: run the build first')
} else {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(js|mjs|css|html|json|svg|map|txt)$/.test(name)) files.push(path)
    }
  }
  walk(distDir)

  const isServiceRoleToken = (token) => {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
      return payload?.role === 'service_role'
    } catch {
      return false
    }
  }

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const where = relative(projectRoot, file)
    if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(text)) problems.push(`${where} contains a Supabase secret key`)
    for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
      if (isServiceRoleToken(token)) problems.push(`${where} contains a service-role token`)
    }
    if (text.includes('NEXUS-ADMIN-ONLY') || text.includes('NEXUS_TEST_SECRET_KEY')) {
      problems.push(`${where} contains administrator script code`)
    }
  }
  // 3. The note editor (TipTap and ProseMirror) must load only when Notes is
  // opened, never as part of the first download that every page, the TV
  // included, makes. The first download is the entry script in index.html
  // and the files it preloads.
  const indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8')
  const startup = [...indexHtml.matchAll(/<(?:script|link)[^>]+(?:src|href)="\/([^"]+\.js)"/g)].map((match) => match[1])
  let startupBytes = 0
  for (const asset of startup) {
    const text = readFileSync(join(distDir, asset), 'utf8')
    startupBytes += Buffer.byteLength(text)
    if (/ProseMirror|prosemirror/.test(text)) {
      problems.push(`${asset} is downloaded by every page but contains the note editor; load it only from Notes`)
    }
  }

  if (problems.length === 0) {
    console.log(
      `Bundle check: ${files.length} built files checked, no secrets found; ` +
        `first download ${(startupBytes / 1024).toFixed(0)} KB with no note editor code.`,
    )
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`Bundle check FAILED: ${problem}`)
  process.exitCode = 1
}
