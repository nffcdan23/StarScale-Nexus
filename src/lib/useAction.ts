import { useCallback, useState } from 'react'

/**
 * Runs a user action (save, add, sign in...), tracking whether it is still
 * working and any message to show if it failed. Returns true on success.
 */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, error, run, clearError: useCallback(() => setError(null), []) }
}
