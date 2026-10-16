// The two desktop apps built from one project (Phase 3c-4b-3), and the
// settings each is built with. Pure functions: tested on any computer.
//
//   cloud  "StarScale Nexus Cloud", for everyday use, connected only to the
//          Supabase Cloud project. Its own identifier, so it installs beside
//          the local app and keeps its sign-in and note drafts in its own
//          storage (%LOCALAPPDATA%\uk.co.starscale.nexus.cloud).
//   local  "StarScale Nexus", connected only to the local Supabase stack. It
//          keeps the name and identifier the app was first installed with,
//          so the existing installation, its sign-in and any unsaved note
//          drafts carry on exactly as before. Its window title says (Local).
//
// Changing a variant's productName or identifier after it has been installed
// would orphan that app's stored sign-in and drafts. Do not.

export const VARIANTS = {
  cloud: { productName: 'StarScale Nexus Cloud', identifier: 'uk.co.starscale.nexus.cloud', title: 'StarScale Nexus' },
  local: { productName: 'StarScale Nexus', identifier: 'uk.co.starscale.nexus', title: 'StarScale Nexus (Local)' },
}

// The same rules as src/data/environment.ts (a test keeps them in step).
const LOCAL_ADDRESS = /^http:\/\/(127\.0\.0\.1|localhost):54321$/
const CLOUD_ADDRESS = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/

/** Which variant a Supabase address belongs to, or null if neither. */
export function variantOf(url) {
  const address = String(url).trim().replace(/\/$/, '')
  if (LOCAL_ADDRESS.test(address)) return 'local'
  if (CLOUD_ADDRESS.test(address)) return 'cloud'
  return null
}

/**
 * Settings merged over src-tauri/tauri.conf.json for one variant: its name,
 * identifier and window title, and a security policy whose only outside
 * connection is that variant's own Supabase address. Everything else in the
 * policy stays exactly as committed.
 */
export function desktopOverlay(variant, base, supabaseUrl) {
  const chosen = VARIANTS[variant]
  if (!chosen) throw new Error(`Unknown desktop variant "${variant}".`)
  if (variantOf(supabaseUrl) !== variant) {
    throw new Error(`${supabaseUrl} is not a ${variant} Supabase address, so it cannot be built into the ${variant} app.`)
  }
  const origin = new URL(supabaseUrl).origin
  return {
    productName: chosen.productName,
    identifier: chosen.identifier,
    app: {
      windows: base.app.windows.map((window) => ({ ...window, title: chosen.title })),
      security: {
        csp: { ...base.app.security.csp, 'connect-src': `'self' ipc: http://ipc.localhost ${origin}` },
      },
    },
  }
}

/** Build-time settings for the app: exactly the two public values, and nothing else starting VITE_. */
export function buildEnvironment(processEnv, { url, publishableKey }) {
  const clean = Object.fromEntries(Object.entries(processEnv).filter(([name]) => !name.startsWith('VITE_')))
  return {
    ...clean,
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    // Read by scripts/check-bundle.mjs: the built app must contain this address and no other.
    NEXUS_EXPECTED_SUPABASE_URL: url,
  }
}
