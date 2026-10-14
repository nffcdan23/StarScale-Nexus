import { createContext, useContext } from 'react'
import type { DataServices } from '../../data/types'

export const DataContext = createContext<DataServices | null>(null)

/** The data layer for screens. Only ever available behind the owner sign-in guard. */
export function useData(): DataServices {
  const value = useContext(DataContext)
  if (!value) throw new Error('useData must be used inside DataProvider, with database settings present')
  return value
}
