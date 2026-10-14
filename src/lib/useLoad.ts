import { useCallback, useEffect, useState } from 'react'

interface LoadResult<T> {
  request: number
  data?: T
  error?: string
}

/**
 * Loads something once, again on reload(), and again whenever the page
 * becomes visible (another device may have changed it meanwhile). While a
 * reload runs, the previous data stays on screen.
 *
 * "load" must keep the same identity between renders (wrap it in useCallback).
 */
export function useLoad<T>(load: () => Promise<T>) {
  const [request, setRequest] = useState(0)
  const [result, setResult] = useState<LoadResult<T> | null>(null)

  useEffect(() => {
    let active = true
    load().then(
      (data) => {
        if (active) setResult({ request, data })
      },
      (error: unknown) => {
        if (active) setResult({ request, error: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      active = false
    }
  }, [load, request])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setRequest((value) => value + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const reload = useCallback(() => setRequest((value) => value + 1), [])

  return {
    data: result?.data,
    error: result?.request === request ? result.error : undefined,
    loading: result?.request !== request,
    reload,
  }
}
