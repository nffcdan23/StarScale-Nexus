// The two desktop apps (Phase 3c-4b-3): what each is built with. The apps
// themselves are built and tested on the Windows PC; these checks run on any
// computer, with a fictional project id.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { environmentOf } from '../../src/data/environment.ts'
import { buildEnvironment, desktopOverlay, VARIANTS, variantOf } from '../../tools/windows/desktop-variants.mjs'
import { projectRoot } from '../security/lib/paths.mjs'

const base = JSON.parse(await readFile(join(projectRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const project = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const cloudUrl = 'https://abcdefghijklmnopqrst.supabase.co'
const policy = (csp) => Object.fromEntries(Object.entries(csp).map(([directive, sources]) => [directive, sources.split(/\s+/)]))

describe('the two desktop apps', () => {
  it('the local app keeps the name and storage it was first installed with', () => {
    expect(VARIANTS.local).toMatchObject({ productName: base.productName, identifier: base.identifier })
    expect(VARIANTS.local).toEqual({ productName: 'StarScale Nexus', identifier: 'uk.co.starscale.nexus', title: 'StarScale Nexus (Local)' })
  })

  it('the cloud app installs beside it, with its own name and its own storage', () => {
    expect(VARIANTS.cloud).toEqual({ productName: 'StarScale Nexus Cloud', identifier: 'uk.co.starscale.nexus.cloud', title: 'StarScale Nexus' })
    expect(VARIANTS.cloud.productName).not.toBe(VARIANTS.local.productName)
    expect(VARIANTS.cloud.identifier).not.toBe(VARIANTS.local.identifier)
  })

  it('the cloud app may connect to its own project and nothing else outside itself', () => {
    const overlay = desktopOverlay('cloud', base, cloudUrl)
    expect(overlay).toMatchObject({ productName: 'StarScale Nexus Cloud', identifier: 'uk.co.starscale.nexus.cloud' })
    const csp = policy(overlay.app.security.csp)
    expect(csp['connect-src']).toEqual(["'self'", 'ipc:', 'http://ipc.localhost', cloudUrl])
    // Every other part of the security policy is exactly the committed one.
    const withoutConnect = (csp) => Object.fromEntries(Object.entries(csp).filter(([directive]) => directive !== 'connect-src'))
    expect(withoutConnect(overlay.app.security.csp)).toEqual(withoutConnect(base.app.security.csp))
    expect(JSON.stringify(overlay)).not.toMatch(/127\.0\.0\.1|localhost:54321|\*/)
    expect(overlay.app.security).not.toHaveProperty('devCsp')
  })

  it('the local app may connect only to the local stack', () => {
    const overlay = desktopOverlay('local', base, 'http://127.0.0.1:54321')
    expect(overlay).toMatchObject({ productName: 'StarScale Nexus', identifier: 'uk.co.starscale.nexus' })
    expect(policy(overlay.app.security.csp)['connect-src']).toEqual(["'self'", 'ipc:', 'http://ipc.localhost', 'http://127.0.0.1:54321'])
  })

  it('keeps the window and its fixed web address, changing only the title', () => {
    for (const variant of ['cloud', 'local']) {
      const url = variant === 'cloud' ? cloudUrl : 'http://127.0.0.1:54321'
      const [window] = desktopOverlay(variant, base, url).app.windows
      expect(window).toEqual({ ...base.app.windows[0], title: VARIANTS[variant].title })
      expect(window.useHttpsScheme).toBe(false)
    }
  })

  it('refuses to build an app with the other environment’s address', () => {
    expect(() => desktopOverlay('cloud', base, 'http://127.0.0.1:54321')).toThrow(/not a cloud Supabase address/)
    expect(() => desktopOverlay('local', base, cloudUrl)).toThrow(/not a local Supabase address/)
    expect(() => desktopOverlay('cloud', base, 'https://example.com')).toThrow(/not a cloud Supabase address/)
    expect(() => desktopOverlay('staging', base, cloudUrl)).toThrow(/Unknown desktop variant/)
  })

  it('agrees with the app about which addresses are local or cloud', () => {
    for (const url of [
      'http://127.0.0.1:54321',
      'http://localhost:54321/',
      cloudUrl,
      'https://short.supabase.co',
      'http://127.0.0.1:3000',
      'https://example.com',
      `${cloudUrl}/rest/v1`,
    ]) {
      expect(variantOf(url), url).toBe(environmentOf(url)?.kind ?? null)
    }
  })

  it('gives the app exactly two public settings and removes any other VITE_ setting', () => {
    const env = buildEnvironment(
      { PATH: '/bin', VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_STRAY: 'leak', NEXUS_CLOUD_DB_HOST: 'pooler' },
      { url: cloudUrl, publishableKey: 'sb_publishable_FictionalKey' },
    )
    expect(Object.keys(env).filter((name) => name.startsWith('VITE_')).sort()).toEqual(['VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL'])
    expect(env).toMatchObject({
      VITE_SUPABASE_URL: cloudUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_FictionalKey',
      NEXUS_EXPECTED_SUPABASE_URL: cloudUrl,
      PATH: '/bin',
    })
  })

  it('has one build command per app, both through the bundle check', () => {
    expect(project.scripts['desktop:build:cloud']).toBe('node tools/windows/desktop-build.mjs cloud')
    expect(project.scripts['desktop:build:local']).toBe('node tools/windows/desktop-build.mjs local')
    expect(project.scripts).not.toHaveProperty('desktop:build')
    expect(base.build.beforeBuildCommand).toBe('npm run build')
    expect(project.scripts.build).toContain('scripts/check-bundle.mjs')
  })

  it('every desktop build command refuses before reading anything, on any computer but Windows', async () => {
    for (const file of ['tools/windows/desktop-build.mjs', 'tools/windows/tauri.mjs', 'scripts/cloud/account.mjs']) {
      const source = await readFile(join(projectRoot, file), 'utf8')
      const guard = source.indexOf('requireWindows(')
      expect(guard, file).toBeGreaterThan(-1)
      for (const later of ['readEnvFile(', 'loadCloudSettings(projectRoot)', 'readFileSync(join(projectRoot']) {
        const index = source.indexOf(later)
        if (index > -1) expect(guard, `${file}: ${later}`).toBeLessThan(index)
      }
    }
  })
})
