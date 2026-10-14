import { useCallback, useEffect, useRef, useState } from 'react'
import { DataError } from '../data/types'

/** How often a live screen refreshes while it is visible (the approved 30 seconds). */
export const REFRESH_INTERVAL = 30_000

interface LiveState<T> {
  data?: T
  /** When the data on screen was last loaded successfully. */
  updatedAt?: Date
  /** Why the most recent refresh failed; cleared by the next success. */
  error?: { kind: DataError['kind']; message: string }
}

/**
 * Keeps a screen's data current: loads it at once, then again every 30
 * seconds while the page is visible, the moment the page becomes visible
 * again (a woken computer, a returning tab), and when the network returns.
 *
 * A failed refresh never removes data already on screen; it only sets
 * "error", so the screen can say its information may be out of date.
 *
 * "load" must keep the same identity between renders (wrap it in useCallback).
 */
export function useLiveData<T>(load: () => Promise<T>, interval = REFRESH_INTERVAL) {
  const [state, setState] = useState<LiveState<T>>({})
  // Only the newest request may change the screen, so a slow old reply can
  // never overwrite a newer one.
  const latest = useRef(0)

  const refresh = useCallback((): Promise<void> => {
    const request = (latest.current += 1)
    return load().then(
      (data) => {
        if (request === latest.current) setState({ data, updatedAt: new Date() })
      },
      (caught: unknown) => {
        if (request !== latest.current) return
        const error =
          caught instanceof DataError
            ? { kind: caught.kind, message: caught.message }
            : { kind: 'unknown' as const, message: caught instanceof Error ? caught.message : String(caught) }
        setState((previous) => ({ ...previous, error }))
      },
    )
  }, [load])

  useEffect(() => {
    void refresh()
    const visible = () => document.visibilityState === 'visible'
    const timer = setInterval(() => {
      if (visible()) void refresh()
    }, interval)
    const onVisible = () => {
      if (visible()) void refresh()
    }
    const onOnline = () => void refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      // Replies still on their way are ignored once the screen has gone.
      latest.current += 1
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [refresh, interval])

  return {
    data: state.data,
    updatedAt: state.updatedAt,
    error: state.error,
    /** True until the first load succeeds or fails. */
    loading: !state.data && !state.error,
    refresh,
  }
}
