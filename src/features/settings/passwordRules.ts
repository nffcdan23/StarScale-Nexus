// The rules a new sign-in password must meet in Nexus. Supabase may add its
// own (the project's password settings); those refusals are shown as well.

export const MIN_PASSWORD_LENGTH = 12
/** Supabase accepts at most 72 bytes; letters with accents or symbols take more than one. */
export const MAX_PASSWORD_BYTES = 72

export interface PasswordForm {
  current: string
  next: string
  confirm: string
}

export type PasswordProblems = Partial<Record<keyof PasswordForm, string>>

/** What is wrong with the form, field by field; empty when it can be sent. */
export function passwordProblems({ current, next, confirm }: PasswordForm): PasswordProblems {
  const problems: PasswordProblems = {}
  if (!current) problems.current = 'Enter your current password.'

  if (!next) problems.next = 'Enter a new password.'
  else if (next.length < MIN_PASSWORD_LENGTH) problems.next = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  else if (new TextEncoder().encode(next).length > MAX_PASSWORD_BYTES) {
    problems.next = 'That is too long: use at most 72 characters, fewer if it has accents or symbols.'
  } else if (next !== next.trim()) problems.next = 'Remove the space at the start or end.'
  else if (next === current) problems.next = 'Choose a password different from your current one.'

  if (!problems.next && confirm !== next) problems.confirm = 'The two new passwords do not match.'
  return problems
}
