import type { ReactNode } from 'react'
import { useAuth } from '../../app/auth/authContext'
import { brand } from '../../app/brand'
import { isDesktopApp } from '../../app/desktop/desktop'
import form from '../../components/Form/Form.module.css'
import { currentEnvironment } from '../../data/environment'
import { useNoteDrafts } from '../notes/drafts'
import { ChangePasswordForm } from './ChangePasswordForm'
import { appVersion, databaseLabel, formatWhen, runsAsLabel } from './describe'
import styles from './Settings.module.css'
import type { AccountDetailsState } from './useAccountDetails'

// The five parts of Settings. Each shows only what is real today: nothing
// here looks like a control unless it works.

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className={styles.facts}>
      {rows.map(([term, value]) => (
        <div key={term} className={styles.fact}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Loading({ state, onRetry }: { state: Exclude<AccountDetailsState, { status: 'ready' }>; onRetry: () => void }) {
  if (state.status === 'loading') return <p className={styles.muted}>Reading your account…</p>
  return (
    <div className={styles.block}>
      <p className={form.error} role="alert">
        {state.message}
      </p>
      <button type="button" className={styles.textButton} onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

const roleLabel = { owner: 'Owner', tv: 'TV display' } as const

export function AccountSection({ account, onRetry }: { account: AccountDetailsState; onRetry: () => void }) {
  return (
    <>
      <p className={styles.intro}>The account you are signed in with.</p>
      {account.status !== 'ready' ? (
        <Loading state={account} onRetry={onRetry} />
      ) : (
        <Facts
          rows={[
            ['Email', account.details.email ?? 'Not recorded'],
            [
              'Role',
              <>
                {account.details.role ? roleLabel[account.details.role] : 'Not set'}
                <span className={styles.note}>Set by the administrator; it cannot be changed here.</span>
              </>,
            ],
            [
              'Signed in',
              account.details.sessionUsedCode
                ? 'With your password and authenticator code, on this computer.'
                : 'With your password only.',
            ],
            ['Database', databaseLabel(currentEnvironment)],
          ]}
        />
      )}
    </>
  )
}

export function SecuritySection({ account, onRetry }: { account: AccountDetailsState; onRetry: () => void }) {
  return (
    <>
      <section className={styles.block} aria-labelledby="settings-password">
        <h3 id="settings-password" className={styles.subheading}>
          Password
        </h3>
        <p className={styles.muted}>
          Your current password is checked first. Changing it does not affect your authenticator or anything you have
          saved.
        </p>
        <ChangePasswordForm />
      </section>

      <section className={styles.block} aria-labelledby="settings-authenticator">
        <h3 id="settings-authenticator" className={styles.subheading}>
          Authenticator app
        </h3>
        {account.status !== 'ready' ? (
          <Loading state={account} onRetry={onRetry} />
        ) : (
          <>
            <Facts
              rows={[
                [
                  'Status',
                  account.details.authenticatorVerified ? (
                    <span className={styles.good}>Set up and confirmed</span>
                  ) : (
                    'Not set up'
                  ),
                ],
                ...(account.details.authenticatorAddedAt
                  ? ([['Added', formatWhen(account.details.authenticatorAddedAt)]] as [string, ReactNode][])
                  : []),
              ]}
            />
            <p className={styles.muted}>
              Nexus asks for a code from it every time you sign in, and your notes and tasks cannot be read without
              one. Replacing or removing the authenticator is not available inside Nexus yet.
            </p>
          </>
        )}
      </section>
    </>
  )
}

export function PreferencesSection() {
  return (
    <p className={styles.intro}>
      There is nothing to set here yet. Choices such as appearance, notes, notifications and what happens when Nexus
      starts will appear here once Nexus can actually apply them.
    </p>
  )
}

export function PrivacySection() {
  const { state } = useAuth()
  const userId = state.phase === 'ready' ? state.snapshot.userId : null
  const unsaved = useNoteDrafts(userId).length
  const desktop = isDesktopApp()
  const here = desktop ? 'this app’s own storage on this computer' : 'this browser on this computer'
  const cloud = currentEnvironment.kind === 'cloud'

  return (
    <>
      <section className={styles.block} aria-labelledby="settings-saved">
        <h3 id="settings-saved" className={styles.subheading}>
          Saved in Nexus
        </h3>
        <p className={styles.muted}>
          {cloud
            ? 'Your notes, tasks and contexts are saved in your Supabase Cloud project, away from this computer, and are there wherever you sign in to this Nexus.'
            : 'Your notes, tasks and contexts are saved in the local Supabase database on the Windows PC, which is for development and testing.'}{' '}
          Only your account can read them, and only after your password and authenticator code. The TV account sees
          the titles, contexts, priorities and deadlines of tasks in contexts shown on the TV, never notes.
        </p>
      </section>

      <section className={styles.block} aria-labelledby="settings-unsaved">
        <h3 id="settings-unsaved" className={styles.subheading}>
          Unsaved changes on this computer
        </h3>
        <p className={styles.fact}>
          {unsaved === 0
            ? 'No notes have unsaved changes kept here.'
            : `${unsaved} ${unsaved === 1 ? 'note has' : 'notes have'} unsaved changes kept here.`}
        </p>
        <p className={styles.muted}>
          Until the database confirms a save, Nexus keeps a copy of your changes in {here}, so nothing is lost if the
          connection drops or the app closes. These copies are not encrypted: anyone using this Windows account could
          read them. When you sign out, Nexus asks whether to keep or delete them.
        </p>
      </section>

      <section className={styles.block} aria-labelledby="settings-session">
        <h3 id="settings-session" className={styles.subheading}>
          Your sign-in on this computer
        </h3>
        <p className={styles.muted}>
          Your sign-in is kept in {here}, so you stay signed in, and it renews itself while Nexus is open. Nexus never
          stores your password. Signing out removes the sign-in from this computer. The cloud and local versions of
          Nexus keep separate sign-ins and separate unsaved changes.
        </p>
      </section>

      <Facts
        rows={[
          ['Database', databaseLabel(currentEnvironment)],
          ['Runs as', runsAsLabel(desktop)],
        ]}
      />
    </>
  )
}

export function AboutSection() {
  return (
    <>
      <p className={styles.intro}>
        {brand.name} {brand.byline}.
      </p>
      <Facts
        rows={[
          ['Version', appVersion],
          ['Database', databaseLabel(currentEnvironment)],
          ['Runs as', runsAsLabel(isDesktopApp())],
        ]}
      />
    </>
  )
}
