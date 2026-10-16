import { LogOut, Settings } from 'lucide-react'
import { NavLink } from 'react-router'
import { useAuth } from '../../app/auth/authContext'
import { brand } from '../../app/brand'
import { navigation } from '../../app/navigation'
import { GlassPanel } from '../GlassPanel/GlassPanel'
import { NexusMark } from '../NexusMark/NexusMark'
import styles from './Sidebar.module.css'

/**
 * The desktop sidebar: brand at the top, then the sections listed in
 * navigation.ts, and at the bottom Settings and Sign out. onSignOut replaces
 * the plain sign-out, so the page can first look after unsaved work.
 */
export function Sidebar({ onSignOut }: { onSignOut?: () => void }) {
  const { actions } = useAuth()

  return (
    <GlassPanel tone="strong" padding="none" className={styles.sidebar}>
      <div className={styles.brand}>
        <NexusMark className={styles.mark} />
        <div className={styles.brandText}>
          <span className={styles.name}>{brand.name}</span>
          <span className={styles.byline}>{brand.byline}</span>
        </div>
      </div>

      <nav aria-label="Primary" className={styles.nav}>
        {navigation.map((group) => (
          <ul key={group.id} aria-label={group.label} className={styles.group}>
            {group.entries.map((entry) => (
              <li key={entry.id}>
                <NavLink
                  to={entry.path}
                  end={entry.path === '/'}
                  className={styles.item}
                  data-label={entry.label}
                >
                  <entry.icon className={styles.icon} aria-hidden="true" />
                  <span className={styles.label}>{entry.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        ))}
      </nav>

      <div className={styles.footer}>
        <NavLink to="/settings" className={styles.item} data-label="Settings">
          <Settings className={styles.icon} aria-hidden="true" />
          <span className={styles.label}>Settings</span>
        </NavLink>
        <button
          type="button"
          className={styles.item}
          data-label="Sign out"
          onClick={() => (onSignOut ? onSignOut() : void actions.signOut())}
        >
          <LogOut className={styles.icon} aria-hidden="true" />
          <span className={styles.label}>Sign out</span>
        </button>
      </div>
    </GlassPanel>
  )
}
