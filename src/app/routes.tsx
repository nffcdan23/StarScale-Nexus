import type { RouteObject } from 'react-router'
import { MissionControlPage } from '../pages/mission-control/MissionControlPage'
import { NotFoundPage } from '../pages/not-found/NotFoundPage'
import { ProjectsPage } from '../pages/projects/ProjectsPage'
import { TasksPage } from '../pages/tasks/TasksPage'
import { TvDashboardPage } from '../pages/tv/TvDashboardPage'
import { DesktopShell } from './layouts/DesktopShell'

export const routes: RouteObject[] = [
  {
    // Interactive desktop app: every page here sits inside the sidebar shell.
    element: <DesktopShell />,
    children: [
      { index: true, element: <MissionControlPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  // Passive television display: full screen, no shell, no controls.
  { path: 'tv', element: <TvDashboardPage /> },
]
