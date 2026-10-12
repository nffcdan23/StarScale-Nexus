import { Outlet, useLocation } from 'react-router'
import { Backdrop } from '../../components/Backdrop/Backdrop'
import { Sidebar } from '../../components/Sidebar/Sidebar'
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

  return (
    <div className={styles.shell}>
      <Backdrop />
      <div className={styles.sidebar}>
        <Sidebar />
      </div>
      <main className={styles.main}>
        {/* Keyed by address so the entrance transition replays on each page change. */}
        <div key={pathname} className={styles.page}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
