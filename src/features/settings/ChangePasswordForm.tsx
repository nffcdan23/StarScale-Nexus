import { CircleCheck } from 'lucide-react'
import { useId, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../app/auth/authContext'
import form from '../../components/Form/Form.module.css'
import { AuthError } from '../../data/auth'
import { MIN_PASSWORD_LENGTH, passwordProblems, type PasswordForm, type PasswordProblems } from './passwordRules'
import styles from './Settings.module.css'

const empty: PasswordForm = { current: '', next: '', confirm: '' }

/**
 * Changes the signed-in account's own password. The passwords live only in
 * this form while it is being filled in: they are cleared after every
 * attempt that reaches Supabase, and never stored, logged or put in the
 * address.
 */
export function ChangePasswordForm() {
  const { actions } = useAuth()
  const id = useId()
  const [values, setValues] = useState<PasswordForm>(empty)
  const [problems, setProblems] = useState<PasswordProblems>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const fields = { current: useRef<HTMLInputElement>(null), next: useRef<HTMLInputElement>(null), confirm: useRef<HTMLInputElement>(null) }

  const change = (field: keyof PasswordForm) => (event: { target: { value: string } }) => {
    setValues((previous) => ({ ...previous, [field]: event.target.value }))
    setProblems((previous) => ({ ...previous, [field]: undefined }))
    setFailure(null)
    setDone(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const found = passwordProblems(values)
    setProblems(found)
    setFailure(null)
    setDone(false)
    const first = (['current', 'next', 'confirm'] as const).find((field) => found[field])
    if (first) {
      fields[first].current?.focus()
      return
    }

    setBusy(true)
    try {
      await actions.changePassword(values.current, values.next)
      setValues(empty)
      setDone(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not change the password.'
      const reason = error instanceof AuthError ? error.reason : null
      if (reason === 'wrong-password') {
        setValues((previous) => ({ ...previous, current: '' }))
        setProblems({ current: message })
        fields.current.current?.focus()
      } else if (reason === 'same-password' || reason === 'weak-password') {
        setValues((previous) => ({ ...previous, next: '', confirm: '' }))
        setProblems({ next: message })
        fields.next.current?.focus()
      } else {
        setValues((previous) => ({ ...previous, current: '' }))
        setFailure(message)
      }
    } finally {
      setBusy(false)
    }
  }

  const field = (name: keyof PasswordForm, label: string, autoComplete: string, hint?: string) => {
    const problemId = `${id}-${name}-problem`
    const hintId = `${id}-${name}-hint`
    const describedBy = [problems[name] ? problemId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
    return (
      <div className={form.field}>
        <label className={form.label} htmlFor={`${id}-${name}`}>
          {label}
        </label>
        <input
          ref={fields[name]}
          id={`${id}-${name}`}
          className={form.input}
          type="password"
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          value={values[name]}
          onChange={change(name)}
          disabled={busy}
          aria-invalid={problems[name] ? true : undefined}
          aria-describedby={describedBy}
        />
        {hint && (
          <p id={hintId} className={styles.hint}>
            {hint}
          </p>
        )}
        {problems[name] && (
          <p id={problemId} className={styles.fieldProblem}>
            {problems[name]}
          </p>
        )}
      </div>
    )
  }

  return (
    <form className={styles.passwordForm} onSubmit={submit} noValidate aria-label="Change password">
      {field('current', 'Current password', 'current-password')}
      {field(
        'next',
        'New password',
        'new-password',
        `At least ${MIN_PASSWORD_LENGTH} characters. A few unrelated words make a strong password that is easy to remember.`,
      )}
      {field('confirm', 'Type the new password again', 'new-password')}

      {failure && (
        <p className={form.error} role="alert">
          {failure}
        </p>
      )}
      {done && (
        <p className={styles.success} role="status">
          <CircleCheck className={styles.successIcon} aria-hidden="true" />
          Password changed. Use the new one next time you sign in, with your authenticator code.
        </p>
      )}

      <button className={`${form.primary} ${styles.submit}`} type="submit" disabled={busy}>
        {busy ? 'Changing password…' : 'Change password'}
      </button>
    </form>
  )
}
