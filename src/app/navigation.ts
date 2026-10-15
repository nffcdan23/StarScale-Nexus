import { Folder, House, NotebookPen, SquareCheck, type LucideIcon } from 'lucide-react'

export interface NavEntry {
  id: string
  label: string
  path: string
  icon: LucideIcon
}

export interface NavGroup {
  id: string
  /** Read out by screen readers; not shown on screen. */
  label: string
  entries: NavEntry[]
}

/**
 * The sidebar is drawn from this list. To add a section, add an entry here
 * and a matching route in routes.tsx. Only sections that work belong here:
 * planned ones stay out until they are built. A new group appears below a
 * divider.
 */
export const navigation: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    entries: [
      { id: 'mission-control', label: 'Mission Control', path: '/', icon: House },
      { id: 'tasks', label: 'Tasks', path: '/tasks', icon: SquareCheck },
      { id: 'notes', label: 'Notes', path: '/notes', icon: NotebookPen },
      { id: 'projects', label: 'Projects', path: '/projects', icon: Folder },
    ],
  },
]
