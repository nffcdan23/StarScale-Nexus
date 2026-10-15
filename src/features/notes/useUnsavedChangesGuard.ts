import { useCallback, useEffect, useRef } from 'react'
import { useBlocker, type BlockerFunction } from 'react-router'

/**
 * While there are unsaved changes: moving to another page or note inside
 * Nexus is held until the owner confirms (blocker), and closing or reloading
 * the tab shows the browser's own warning.
 *
 * Call allowNextNavigation() just before a deliberate move that must not be
 * stopped, such as giving a new note its address after its first save. It
 * lets exactly one move through.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const allowed = useRef(false)

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => {
      if (allowed.current) {
        allowed.current = false
        return false
      }
      return dirty && currentLocation.pathname !== nextLocation.pathname
    },
    [dirty],
  )
  const blocker = useBlocker(shouldBlock)

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Older browsers need this set to show their warning.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const allowNextNavigation = useCallback(() => {
    allowed.current = true
  }, [])

  return { blocker, allowNextNavigation }
}
