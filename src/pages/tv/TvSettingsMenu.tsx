import { Settings } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { cx } from '../../lib/cx'
import styles from './TvSettingsMenu.module.css'

/** How long the settings button stays clearly visible after the mouse moves or a key is pressed. */
const AWAKE_FOR = 5_000

interface TvSettingsMenuProps {
  onRefresh: () => void
  onSignOut: () => void
}

/**
 * The TV's only control: a faint settings button in the corner that opens
 * Refresh now and Sign out. It brightens when the mouse moves or a key is
 * pressed, works fully from the keyboard (Tab, Enter, Escape), and asks
 * before signing out, because signing back in needs the TV password.
 */
export function TvSettingsMenu({ onRefresh, onSignOut }: TvSettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [awake, setAwake] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Brighten on any mouse movement or key press, then fade again.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const wake = () => {
      setAwake(true)
      clearTimeout(timer)
      timer = setTimeout(() => setAwake(false), AWAKE_FOR)
    }
    window.addEventListener('pointermove', wake)
    window.addEventListener('keydown', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])

  // Keyboard focus follows the menu: first option when it opens, Cancel
  // (the safe choice) when asking to confirm sign-out.
  useEffect(() => {
    if (open) (confirming ? cancelRef : firstItemRef).current?.focus()
  }, [open, confirming])

  // Escape or a click elsewhere closes the menu.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  function close(returnFocus = true) {
    setOpen(false)
    setConfirming(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  return (
    <div ref={rootRef} className={cx(styles.root, (awake || open) && styles.awake)}>
      {open && (
        <div id={menuId} className={styles.menu} role="group" aria-label="TV settings">
          {confirming ? (
            <>
              <p className={styles.question}>Sign out this TV? It will need the TV password to sign in again.</p>
              <div className={styles.choices}>
                <button className={cx(styles.item, styles.danger)} type="button" onClick={onSignOut}>
                  Sign out
                </button>
                <button ref={cancelRef} className={styles.item} type="button" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                ref={firstItemRef}
                className={styles.item}
                type="button"
                onClick={() => {
                  onRefresh()
                  close()
                }}
              >
                Refresh now
              </button>
              <button className={styles.item} type="button" onClick={() => setConfirming(true)}>
                Sign out…
              </button>
            </>
          )}
        </div>
      )}
      <button
        ref={buttonRef}
        className={styles.trigger}
        type="button"
        aria-label="TV settings"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Settings className={styles.icon} aria-hidden="true" />
      </button>
    </div>
  )
}
