import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import '@fontsource-variable/figtree/index.css'
import './styles/tokens.css'
import './styles/global.css'
import { AuthProvider } from './app/auth/AuthProvider'
import { routes } from './app/routes'
import { readSupabaseSettings } from './data/config'
import { createSupabaseAuthService } from './data/supabaseAuth'
import { createSupabaseClient } from './data/supabaseClient'

const settings = readSupabaseSettings(import.meta.env)
const authService = settings.ok ? createSupabaseAuthService(createSupabaseClient(settings.settings)) : null
const router = createBrowserRouter(routes)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider service={authService} configProblem={settings.ok ? null : settings.problem}>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
)
