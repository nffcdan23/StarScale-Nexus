import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { AuthGate } from '../../app/auth/AuthGate'
import { useAuth } from '../../app/auth/authContext'
import form from '../../components/Form/Form.module.css'
import { StatusScreen } from '../../components/StatusScreen/StatusScreen'
import type { Enrolment } from '../../data/auth'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import styles from './SignInPage.module.css'

/** Runs a sign-in step, keeping track of "working" and of any message to show. */
function useStep() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

const sixDigits = (value: string) => value.replace(/\D/g, '').slice(0, 6)

/** Only send people back to an address inside Nexus. */
function safeReturnPath(state: unknown): string | null {
  const from = (state as { from?: unknown } | null)?.from
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : null
}

export function SignInPage() {
  useDocumentTitle('Sign in')
  const { state } = useAuth()
  const location = useLocation()

  if (state.phase !== 'ready') return <AuthGate state={state} />
  const { status, email } = state.snapshot

  if (status === 'owner') return <Navigate to={safeReturnPath(location.state) ?? '/'} replace />
  if (status === 'tv') return <Navigate to="/tv" replace />
  if (status === 'needs-code') return <CodeStep email={email} />
  if (status === 'needs-enrolment') return <EnrolStep email={email} />
  if (status === 'unregistered') return <UnregisteredStep email={email} />
  return <PasswordStep sessionEnded={state.sessionEnded} />
}

function PasswordStep({ sessionEnded }: { sessionEnded: boolean }) {
  const { actions } = useAuth()
  const { busy, error, run } = useStep()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(() => actions.signIn(email.trim(), password))
  }

  return (
    <StatusScreen title="Sign in">
      {sessionEnded && (
        <p className={form.notice} role="status">
          Your session has ended. Please sign in again.
        </p>
      )}
      <form className={form.form} onSubmit={submit}>
        <label className={form.field}>
          <span className={form.label}>Email</span>
          <input
            className={form.input}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className={form.field}>
          <span className={form.label}>Password</span>
          <input
            className={form.input}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className={form.error} role="alert">
            {error}
          </p>
        )}
        <button className={form.primary} type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </StatusScreen>
  )
}

function SignOutButton({ label = 'Use a different account' }: { label?: string }) {
  const { actions } = useAuth()
  return (
    <button className={form.secondary} type="button" onClick={() => void actions.signOut()}>
      {label}
    </button>
  )
}

function CodeStep({ email }: { email: string | null }) {
  const { actions } = useAuth()
  const { busy, error, run } = useStep()
  const [code, setCode] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(() => actions.verifyCode(code))
  }

  return (
    <StatusScreen title="Enter your authenticator code">
      <p>Open your authenticator app and enter the six-digit code for Nexus{email ? ` (${email})` : ''}.</p>
      <form className={form.form} onSubmit={submit}>
        <label className={form.field}>
          <span className={form.label}>Code</span>
          <input
            className={`${form.input} ${form.code}`}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            required
            value={code}
            onChange={(event) => setCode(sixDigits(event.target.value))}
          />
        </label>
        {error && (
          <p className={form.error} role="alert">
            {error}
          </p>
        )}
        <button className={form.primary} type="submit" disabled={busy || code.length !== 6}>
          {busy ? 'Checking…' : 'Verify'}
        </button>
        <SignOutButton />
      </form>
    </StatusScreen>
  )
}

function EnrolStep({ email }: { email: string | null }) {
  const { actions } = useAuth()
  const { busy, error, run } = useStep()
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [code, setCode] = useState('')

  // Started by a click rather than automatically, so an authenticator is only
  // ever set up when the owner asks for one.
  const begin = () =>
    void run(async () => {
      setEnrolment(await actions.startEnrolment())
    })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (enrolment) void run(() => actions.finishEnrolment(enrolment.factorId, code))
  }

  return (
    <StatusScreen title="Set up your authenticator">
      <p>
        Nexus needs a code from an authenticator app every time you sign in
        {email ? ` as ${email}` : ''}. Set one up now, before using this password anywhere else.
      </p>
      {!enrolment ? (
        <div className={form.form}>
          {error && (
            <p className={form.error} role="alert">
              {error}
            </p>
          )}
          <button className={form.primary} type="button" onClick={begin} disabled={busy}>
            {busy ? 'Preparing…' : 'Show the QR code'}
          </button>
          <SignOutButton />
        </div>
      ) : (
        <form className={form.form} onSubmit={submit}>
          <img className={styles.qr} src={enrolment.qrCodeUrl} alt="QR code to add Nexus to your authenticator app" />
          <p className={styles.secretLabel}>Or type this key into the app:</p>
          <code className={styles.secret}>{enrolment.secret}</code>
          <label className={form.field}>
            <span className={form.label}>Code from the app</span>
            <input
              className={`${form.input} ${form.code}`}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              required
              value={code}
              onChange={(event) => setCode(sixDigits(event.target.value))}
            />
          </label>
          {error && (
            <p className={form.error} role="alert">
              {error}
            </p>
          )}
          <button className={form.primary} type="submit" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Finish set-up'}
          </button>
          <SignOutButton />
        </form>
      )}
    </StatusScreen>
  )
}

function UnregisteredStep({ email }: { email: string | null }) {
  return (
    <StatusScreen title="This account is not set up for Nexus.">
      <p>
        {email ?? 'This account'} can sign in, but it has not been registered as the owner or a TV.
        Nothing in Nexus is available to it.
      </p>
      <SignOutButton label="Sign out" />
    </StatusScreen>
  )
}
