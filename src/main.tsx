import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import '@fontsource-variable/figtree/index.css'
import './styles/tokens.css'
import './styles/global.css'
import { AuthProvider } from './app/auth/AuthProvider'
import { DataProvider } from './app/data/DataProvider'
import { isDesktopApp } from './app/desktop/desktop'
import { routes } from './app/routes'
import { readSupabaseSettings } from './data/config'
import { createSupabaseAuthService } from './data/supabaseAuth'
import { createPasswordCheck, createSupabaseClient } from './data/supabaseClient'
import { createSupabaseDataServices } from './data/supabaseData'

const settings = readSupabaseSettings(import.meta.env)
const client = settings.ok ? createSupabaseClient(settings.settings) : null
const authService = client && settings.ok ? createSupabaseAuthService(client, createPasswordCheck(settings.settings)) : null
const dataServices = client ? createSupabaseDataServices(client) : null
const router = createBrowserRouter(routes)

// In the desktop app, links that leave Nexus open in the default browser.
// Loaded only there, so the browser version never downloads it.
if (isDesktopApp()) {
  void Promise.all([import('./app/desktop/externalLinks'), import('@tauri-apps/plugin-opener')]).then(
    ([links, opener]) => links.handleExternalLinks((url) => opener.openUrl(url)),
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider service={authService} configProblem={settings.ok ? null : settings.problem}>
      <DataProvider services={dataServices}>
        <RouterProvider router={router} />
      </DataProvider>
    </AuthProvider>
  </StrictMode>,
)
