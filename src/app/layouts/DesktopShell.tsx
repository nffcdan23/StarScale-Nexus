import { useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { Backdrop } from '../../components/Backdrop/Backdrop'
import { Sidebar } from '../../components/Sidebar/Sidebar'
import { drafts, saveOpenNotes, type NoteDraft } from '../../features/notes/drafts'
import { SignOutDialog } from '../../features/notes/SignOutDialog'
import { useAuth } from '../auth/authContext'
import styles from './DesktopShell.module.css'

/**
 * The frame of the interactive desktop app: backdrop, sidebar and page area.
 *
 * The Ask Nexus command bar will dock at the bottom of the page area in a
 * later phase. Raising --dock-space in tokens.css keeps page content clear
 * of it.
 */
export function DesktopShell() {
  const { pathname } = useLocation()
  const { state, actions } = useAuth()
  const ownerId = state.phase === 'ready' ? state.snapshot.userId : null
  const [unsavedAtSignOut, setUnsavedAtSignOut] = useState<NoteDraft[] | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  // Signing out: save any open note first; if changes still have not reached
  // the database, ask what to do with the copies kept on this computer.
  const signOut = async () => {
    setSigningOut(true)
    await saveOpenNotes()
    setSigningOut(false)
    const pending = ownerId ? drafts.list(ownerId) : []
    if (pending.length === 0) await actions.signOut()
    else setUnsavedAtSignOut(pending)
  }

  return (
    <div className={styles.shell}>
      <Backdrop />
      <div className={styles.sidebar}>
        <Sidebar onSignOut={() => void signOut()} />
      </div>
      <main className={styles.main}>
        {/* Keyed by section (the first part of the address), so the entrance
            transition replays when changing page but not when moving between
            notes inside Notes. */}
        <div key={pathname.split('/')[1]} className={styles.page}>
          <Outlet />
        </div>
      </main>
      {unsavedAtSignOut && ownerId && (
        <SignOutDialog
          drafts={unsavedAtSignOut}
          busy={signingOut}
          onKeep={() => void actions.signOut()}
          onDelete={() => {
            drafts.deleteAllAndStop(ownerId)
            void actions.signOut()
          }}
          onCancel={() => setUnsavedAtSignOut(null)}
        />
      )}
    </div>
  )
}
