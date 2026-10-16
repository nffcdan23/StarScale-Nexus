import { describe, expect, it } from 'vitest'
import capability from '../../../src-tauri/capabilities/main-window.json'
import config from '../../../src-tauri/tauri.conf.json'
import project from '../../../package.json'

// The desktop app's settings that must never drift. The app itself is built
// and tested on the Windows PC; these checks run on any machine.

const policy = (csp: Record<string, string>) =>
  Object.fromEntries(Object.entries(csp).map(([directive, sources]) => [directive, sources.split(/\s+/)]))

describe('desktop app settings', () => {
  it('keeps its permanent name and identifier', () => {
    expect(config.productName).toBe('StarScale Nexus')
    expect(config.identifier).toBe('uk.co.starscale.nexus')
  })

  it('keeps the app\'s web address fixed, so sign-in and drafts are never orphaned', () => {
    // Changing this would move localStorage (sign-in session, note drafts) to a new place.
    expect(config.app.windows).toHaveLength(1)
    expect(config.app.windows[0]).toMatchObject({ label: 'main', title: 'StarScale Nexus', useHttpsScheme: false, decorations: true })
  })

  it('packs the normal build, which includes the secrets check', () => {
    expect(config.build.frontendDist).toBe('../dist')
    expect(config.build.beforeBuildCommand).toBe('npm run build')
    expect(project.scripts.build).toContain('scripts/check-bundle.mjs')
  })

  it('has a restrictive security policy for the built app', () => {
    const csp = policy(config.app.security.csp)
    expect(csp['default-src']).toEqual(["'self'"])
    expect(csp['script-src']).toEqual(["'self'"])
    expect(csp['style-src']).toEqual(["'self'"])
    for (const sources of Object.values(csp)) {
      expect(sources).not.toContain("'unsafe-inline'")
      expect(sources).not.toContain("'unsafe-eval'")
      expect(sources).not.toContain('*')
    }
    expect(csp['object-src']).toEqual(["'none'"])
    expect(csp['frame-src']).toEqual(["'none'"])
    expect(csp['base-uri']).toEqual(["'none'"])
    expect(config.app.security.freezePrototype).toBe(true)
  })

  it('lets the app reach the local Supabase stack and nothing else outside itself', () => {
    // The address the local stack prints when it starts (see .env.example).
    const connect = policy(config.app.security.csp)['connect-src']
    expect(connect).toContain('http://127.0.0.1:54321')
    const outside = connect.filter((source) => !["'self'", 'ipc:', 'http://ipc.localhost'].includes(source))
    expect(outside.every((source) => /^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(source))).toBe(true)
  })

  it('gives the window one permission only: opening web and email links', () => {
    expect(capability.windows).toEqual(['main'])
    expect(capability.permissions).toEqual([
      { identifier: 'opener:allow-open-url', allow: [{ url: 'https://*' }, { url: 'http://*' }, { url: 'mailto:*' }] },
    ])
  })

  it('builds a per-user Windows installer', () => {
    expect(config.bundle.targets).toEqual(['nsis'])
    expect(config.bundle.windows.nsis.installMode).toBe('currentUser')
  })
})
