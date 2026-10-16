import { Database, Info, ShieldCheck, SlidersHorizontal, UserRound } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { GlassPanel } from '../../components/GlassPanel/GlassPanel'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import {
  AboutSection,
  AccountSection,
  PreferencesSection,
  PrivacySection,
  SecuritySection,
} from '../../features/settings/SettingsSections'
import { useAccountDetails } from '../../features/settings/useAccountDetails'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import page from '../Page.module.css'
import styles from './SettingsPage.module.css'

const sections = [
  { id: 'account', label: 'My Account', icon: UserRound },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { id: 'privacy', label: 'Data & Privacy', icon: Database },
  { id: 'about', label: 'About Nexus', icon: Info },
] as const

type SectionId = (typeof sections)[number]['id']

/**
 * /settings, for the owner only (the route sits behind RequireOwner, like
 * every desktop page). The chosen section is kept in the address
 * (?section=security), so it survives a reload; nothing else ever is.
 */
export function SettingsPage() {
  useDocumentTitle('Settings')
  const [params] = useSearchParams()
  const chosen: SectionId = sections.find((section) => section.id === params.get('section'))?.id ?? 'account'
  const { state: account, reload } = useAccountDetails()
  const label = sections.find((section) => section.id === chosen)!.label

  return (
    <div className={page.stack}>
      <PageHeader title="Settings" lead="Your account, its security, and how Nexus looks after your information." />
      <div className={styles.workspace}>
        <GlassPanel as="aside" padding="md">
          <nav aria-label="Settings sections">
            <ul className={styles.sections}>
              {sections.map((section) => (
                <li key={section.id}>
                  <Link
                    to={section.id === 'account' ? '/settings' : `/settings?section=${section.id}`}
                    className={styles.sectionLink}
                    aria-current={section.id === chosen ? 'page' : undefined}
                  >
                    <section.icon className={styles.sectionIcon} aria-hidden="true" />
                    {section.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </GlassPanel>

        <GlassPanel as="section" padding="lg" className={styles.content} aria-labelledby="settings-heading">
          <h2 id="settings-heading" className={styles.heading}>
            {label}
          </h2>
          {chosen === 'account' && <AccountSection account={account} onRetry={reload} />}
          {chosen === 'security' && <SecuritySection account={account} onRetry={reload} />}
          {chosen === 'preferences' && <PreferencesSection />}
          {chosen === 'privacy' && <PrivacySection />}
          {chosen === 'about' && <AboutSection />}
        </GlassPanel>
      </div>
    </div>
  )
}
