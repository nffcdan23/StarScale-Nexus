import { useMemo, useSyncExternalStore } from 'react'

const MINUTE = 60_000

// One shared timer serves every component that shows the time.
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

function notify() {
  for (const listener of listeners) listener()
}

function scheduleNextTick() {
  // Wake just after the next minute begins, so the display changes on time.
  const untilNextMinute = MINUTE - (Date.now() % MINUTE)
  timer = setTimeout(() => {
    notify()
    scheduleNextTick()
  }, untilNextMinute + 25)
}

// Browsers pause timers on hidden pages (a locked PC, a sleeping display),
// so catch up the moment the page is visible again.
function handleVisibilityChange() {
  if (document.visibilityState === 'visible') notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    scheduleNextTick()
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }
}

function currentMinute() {
  return Math.floor(Date.now() / MINUTE)
}

/** The current time to the minute, kept up to date while a component is on screen. */
export function useMinuteClock(): Date {
  const minute = useSyncExternalStore(subscribe, currentMinute)
  return useMemo(() => new Date(minute * MINUTE), [minute])
}
