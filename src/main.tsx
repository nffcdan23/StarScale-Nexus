import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import '@fontsource-variable/figtree/index.css'
import './styles/tokens.css'
import './styles/global.css'
import { AuthProvider } from './app/auth/AuthProvider'
import { DataProvider } from './app/data/DataProvider'
import { routes } from './app/routes'
import { readSupabaseSettings } from './data/config'
import { createSupabaseAuthService } from './data/supabaseAuth'
import { createSupabaseClient } from './data/supabaseClient'
import { createSupabaseDataServices } from './data/supabaseData'

const settings = readSupabaseSettings(import.meta.env)
const client = settings.ok ? createSupabaseClient(settings.settings) : null
const authService = client ? createSupabaseAuthService(client) : null
const dataServices = client ? createSupabaseDataServices(client) : null
const router = createBrowserRouter(routes)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider service={authService} configProblem={settings.ok ? null : settings.problem}>
      <DataProvider services={dataServices}>
        <RouterProvider router={router} />
      </DataProvider>
    </AuthProvider>
  </StrictMode>,
)
