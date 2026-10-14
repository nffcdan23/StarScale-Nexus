import type { ReactNode } from 'react'
import type { DataServices } from '../../data/types'
import { DataContext } from './dataContext'

/** Hands the data layer to every screen, the same way AuthProvider hands out sign-in. */
export function DataProvider({ services, children }: { services: DataServices | null; children: ReactNode }) {
  return <DataContext.Provider value={services}>{children}</DataContext.Provider>
}
