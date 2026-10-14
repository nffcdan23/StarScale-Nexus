import { useCallback } from 'react'
import { useData } from '../../app/data/dataContext'
import type { Context } from '../../data/types'
import { useLoad } from '../../lib/useLoad'

/**
 * The owner's contexts, for any feature that groups things by area of life.
 * Not tied to tasks: notes and calendar will use the same list later.
 */
export function useContexts() {
  const { contexts } = useData()
  const load = useCallback(() => contexts.list({ includeArchived: true }), [contexts])
  const { data, error, loading, reload } = useLoad(load)
  const all: Context[] = data ?? []

  return {
    all,
    active: all.filter((context) => !context.archivedAt),
    archived: all.filter((context) => context.archivedAt),
    /** True only for the first load; later reloads keep the list on screen. */
    loading: loading && !data,
    error,
    reload,
  }
}

export type ContextsState = ReturnType<typeof useContexts>
