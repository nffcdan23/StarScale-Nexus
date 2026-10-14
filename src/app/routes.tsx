import type { RouteObject } from 'react-router'
import { MissionControlPage } from '../pages/mission-control/MissionControlPage'
import { NotFoundPage } from '../pages/not-found/NotFoundPage'
import { ProjectsPage } from '../pages/projects/ProjectsPage'
import { SignInPage } from '../pages/sign-in/SignInPage'
import { TasksPage } from '../pages/tasks/TasksPage'
import { TvDashboardPage } from '../pages/tv/TvDashboardPage'
import { RequireOwner } from './auth/RequireOwner'
import { RequireTv } from './auth/RequireTv'
import { DesktopShell } from './layouts/DesktopShell'

// The guards below only choose which screen to show. The database itself
// refuses anything that is not the owner with an authenticator code, or a
// registered TV calling its summary.
export const routes: RouteObject[] = [
  // Password, authenticator code and authenticator set-up, one step at a time.
  { path: 'sign-in', element: <SignInPage /> },
  {
    // Interactive desktop app: the owner only, inside the sidebar shell.
    element: <RequireOwner />,
    children: [
      {
        element: <DesktopShell />,
        children: [
          { index: true, element: <MissionControlPage /> },
          { path: 'tasks', element: <TasksPage /> },
          { path: 'projects', element: <ProjectsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
  // Passive television display: full screen, no shell, no controls.
  {
    path: 'tv',
    element: <RequireTv />,
    children: [{ index: true, element: <TvDashboardPage /> }],
  },
]
