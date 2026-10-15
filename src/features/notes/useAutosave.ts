import { useCallback, useEffect, useRef, useState } from 'react'

/** Approved timings (Phase 3c). */
export const autosaveTiming = {
  /** Save this long after typing stops. */
  quiet: 2_000,
  /** Save at least this often while typing continues. */
  maxWait: 15_000,
  /** Waits between attempts after a save fails; the last one repeats. */
  retries: [5_000, 15_000, 30_000, 60_000],
  /** How often an open note with nothing unsaved checks for changes made elsewhere. */
  peek: 30_000,
}

/**
 * What one save attempt reports: saved; failed but worth retrying (no
 * connection, sign-in being checked); or stopped, needing the owner (a
 * conflict with another device, or a value the database will not accept).
 */
export type SaveOutcome = 'saved' | 'retry' | 'stop'

interface AutosaveOptions {
  /** Raised by every edit to the title, text or context. */
  editCount: number
  /** Whether anything is unsaved right now (read from the latest edits, never a stale copy). */
  isDirty: () => boolean
  /** One save attempt with the latest edits. */
  save: () => Promise<SaveOutcome>
}

/**
 * Saves automatically: two seconds after the last edit, at least every 15
 * seconds while editing continues, and at once when the tab is hidden. Only
 * one save runs at a time. A failed save is retried after 5, 15 and 30
 * seconds, then every minute, and at once when the network returns or the
 * tab is shown again. A stopped save is not retried; the next edit, or
 * saveNow, tries again.
 */
export function useAutosave({ editCount, isDirty, save }: AutosaveOptions) {
  const latest = useRef({ isDirty, save })
  useEffect(() => {
    latest.current = { isDirty, save }
  })

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const firstEditAt = useRef<number | null>(null)
  const running = useRef<Promise<SaveOutcome> | null>(null)
  const failures = useRef(0)
  const waitingToRetry = useRef(false)
  const [retrying, setRetrying] = useState(false)
  // Lets a scheduled retry or follow-up call the current saveNow.
  const saveAgain = useRef<() => void>(() => {})

  const schedule = useCallback((delay: number, run: () => void) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(run, Math.max(0, delay))
  }, [])

  const saveNow = useCallback((): Promise<SaveOutcome> => {
    clearTimeout(timer.current)
    if (running.current) return running.current

    const attempt = async (): Promise<SaveOutcome> => {
      const outcome = await latest.current.save()
      if (outcome === 'retry') {
        const delay = autosaveTiming.retries[Math.min(failures.current, autosaveTiming.retries.length - 1)]
        failures.current += 1
        waitingToRetry.current = true
        setRetrying(true)
        schedule(delay, () => saveAgain.current())
        return outcome
      }
      failures.current = 0
      waitingToRetry.current = false
      setRetrying(false)
      firstEditAt.current = null
      // Anything typed while that save was on its way is saved next.
      if (outcome === 'saved' && latest.current.isDirty()) {
        firstEditAt.current = Date.now()
        schedule(autosaveTiming.quiet, () => saveAgain.current())
      }
      return outcome
    }

    running.current = attempt().finally(() => {
      running.current = null
    })
    return running.current
  }, [schedule])

  useEffect(() => {
    saveAgain.current = () => void saveNow()
  }, [saveNow])

  // Every edit (re)starts the quiet period, but never past the 15-second limit.
  useEffect(() => {
    if (editCount === 0 || waitingToRetry.current || !latest.current.isDirty()) return
    firstEditAt.current ??= Date.now()
    const untilLimit = firstEditAt.current + autosaveTiming.maxWait - Date.now()
    schedule(Math.min(autosaveTiming.quiet, untilLimit), () => void saveNow())
  }, [editCount, schedule, saveNow])

  useEffect(() => {
    const retryNow = () => {
      if (waitingToRetry.current) void saveNow()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (latest.current.isDirty() && !waitingToRetry.current) void saveNow()
      } else {
        retryNow()
      }
    }
    window.addEventListener('online', retryNow)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('online', retryNow)
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(timer.current)
    }
  }, [saveNow])

  return { saveNow, retrying }
}
