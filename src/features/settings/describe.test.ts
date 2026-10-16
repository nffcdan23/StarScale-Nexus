import { describe, expect, it } from 'vitest'
import { databaseLabel, formatWhen, runsAsLabel } from './describe'
import { passwordProblems } from './passwordRules'

describe('describing this copy of Nexus', () => {
  it('names the database for local and cloud builds, without the full project id', () => {
    expect(databaseLabel({ kind: 'local' })).toBe('Local Supabase on the Windows PC (development and testing)')
    const cloud = databaseLabel({ kind: 'cloud', projectRef: 'abcdefghijklmnopqrst' })
    expect(cloud).toBe('Supabase Cloud (project abcd…qrst)')
    expect(cloud).not.toContain('abcdefghijklmnopqrst')
  })

  it('says how it runs and formats times the British way, on a 12-hour clock', () => {
    expect(runsAsLabel(true)).toBe('Windows desktop app')
    expect(runsAsLabel(false)).toBe('Web browser')
    expect(formatWhen('2026-10-16T13:41:00.000Z')).toBe('16 October 2026, 2:41 PM')
  })
})

describe('new password rules', () => {
  const current = 'the old password'
  it('accepts a long new password that matches its confirmation', () => {
    expect(passwordProblems({ current, next: 'a brand new passphrase', confirm: 'a brand new passphrase' })).toEqual({})
  })

  it('counts bytes, not letters, against the 72-byte limit', () => {
    expect(passwordProblems({ current, next: 'é'.repeat(36), confirm: 'é'.repeat(36) })).toEqual({})
    expect(passwordProblems({ current, next: 'é'.repeat(37), confirm: 'é'.repeat(37) }).next).toMatch(/too long/)
  })

  it('only asks for the confirmation once the new password itself is acceptable', () => {
    expect(passwordProblems({ current, next: 'short', confirm: 'different' })).toEqual({ next: 'Use at least 12 characters.' })
  })
})
