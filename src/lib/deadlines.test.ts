import { describe, expect, it } from 'vitest'
import {
  deadlineState,
  deadlineToFields,
  fieldsToDeadline,
  formatDeadline,
  localDateString,
} from './deadlines'

// Tests run in London time (see vite.config.ts), so these moments are fixed.
/** 2:30 PM on Wednesday 14 October 2026, London time (British Summer Time). */
const now = new Date(2026, 9, 14, 14, 30)

describe('deadline fields', () => {
  it('turns empty boxes into no deadline', () => {
    expect(fieldsToDeadline({ date: '', time: '' })).toBeNull()
    expect(fieldsToDeadline({ date: '', time: '09:00' })).toBeNull()
  })

  it('keeps a date with no time as a date-only deadline', () => {
    expect(fieldsToDeadline({ date: '2026-10-17', time: '' })).toEqual({ kind: 'date', date: '2026-10-17' })
  })

  it('stores a date and time as an exact moment in local time', () => {
    // 9:00 AM in London during summer time is 8:00 AM UTC.
    expect(fieldsToDeadline({ date: '2026-10-17', time: '09:00' })).toEqual({ kind: 'time', at: '2026-10-17T08:00:00.000Z' })
    // After the clocks go back, London time is UTC.
    expect(fieldsToDeadline({ date: '2026-11-02', time: '09:00' })).toEqual({ kind: 'time', at: '2026-11-02T09:00:00.000Z' })
  })

  it('refuses a malformed date', () => {
    expect(() => fieldsToDeadline({ date: '17/10/2026', time: '' })).toThrow('Enter a valid deadline date.')
  })

  it('fills the boxes back from a stored deadline', () => {
    expect(deadlineToFields(null)).toEqual({ date: '', time: '' })
    expect(deadlineToFields({ kind: 'date', date: '2026-10-17' })).toEqual({ date: '2026-10-17', time: '' })
    expect(deadlineToFields({ kind: 'time', at: '2026-10-17T08:00:00+00:00' })).toEqual({ date: '2026-10-17', time: '09:00' })
  })

  it('uses the local calendar day, not the UTC one', () => {
    // 11:30 PM UTC on 16 October is 12:30 AM on 17 October in London.
    expect(localDateString(new Date('2026-10-16T23:30:00Z'))).toBe('2026-10-17')
  })
})

describe('deadlineState', () => {
  it('treats a date-only deadline as due all day', () => {
    expect(deadlineState({ kind: 'date', date: '2026-10-13' }, now)).toBe('overdue')
    expect(deadlineState({ kind: 'date', date: '2026-10-14' }, now)).toBe('today')
    expect(deadlineState({ kind: 'date', date: '2026-10-15' }, now)).toBe('upcoming')
  })

  it('treats a timed deadline as overdue once the moment passes', () => {
    expect(deadlineState({ kind: 'time', at: '2026-10-14T13:00:00Z' }, now)).toBe('overdue') // 2:00 PM London
    expect(deadlineState({ kind: 'time', at: '2026-10-14T15:00:00Z' }, now)).toBe('today') // 4:00 PM London
    expect(deadlineState({ kind: 'time', at: '2026-10-15T08:00:00Z' }, now)).toBe('upcoming')
  })

  it('has nothing to say about a task with no deadline', () => {
    expect(deadlineState(null, now)).toBeNull()
  })
})

describe('formatDeadline', () => {
  it('names nearby days and writes others the British way', () => {
    expect(formatDeadline({ kind: 'date', date: '2026-10-14' }, now)).toBe('Today')
    expect(formatDeadline({ kind: 'date', date: '2026-10-15' }, now)).toBe('Tomorrow')
    expect(formatDeadline({ kind: 'date', date: '2026-10-13' }, now)).toBe('Yesterday')
    expect(formatDeadline({ kind: 'date', date: '2026-10-17' }, now)).toBe('Sat 17 Oct')
    expect(formatDeadline({ kind: 'date', date: '2027-01-08' }, now)).toBe('Fri 8 Jan 2027')
  })

  it('adds the time on a 12-hour clock', () => {
    expect(formatDeadline({ kind: 'time', at: '2026-10-15T08:00:00Z' }, now)).toBe('Tomorrow, 9:00 AM')
    expect(formatDeadline({ kind: 'time', at: '2026-10-17T17:45:00Z' }, now)).toBe('Sat 17 Oct, 6:45 PM')
  })
})
