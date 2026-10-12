import { describe, expect, it } from 'vitest'
import { formatClock, formatDayMonth, formatLongDate, formatWeekday, greetingFor } from './time'

/** A moment on Tuesday 13 October 2026, in the computer's own time zone. */
const at = (hour: number, minute = 0) => new Date(2026, 9, 13, hour, minute)

describe('greetingFor', () => {
  it('says good morning from 05:00 until noon', () => {
    expect(greetingFor(at(5))).toBe('Good morning')
    expect(greetingFor(at(11, 59))).toBe('Good morning')
  })

  it('says good afternoon from noon until 18:00', () => {
    expect(greetingFor(at(12))).toBe('Good afternoon')
    expect(greetingFor(at(17, 59))).toBe('Good afternoon')
  })

  it('says good evening from 18:00 through the night', () => {
    expect(greetingFor(at(18))).toBe('Good evening')
    expect(greetingFor(at(23, 59))).toBe('Good evening')
    expect(greetingFor(at(0))).toBe('Good evening')
    expect(greetingFor(at(4, 59))).toBe('Good evening')
  })
})

describe('formatClock', () => {
  it('uses a 12-hour clock with AM and PM', () => {
    expect(formatClock(at(9, 7))).toBe('9:07 AM')
    expect(formatClock(at(20, 42))).toBe('8:42 PM')
  })

  it('shows midnight and noon as 12', () => {
    expect(formatClock(at(0, 5))).toBe('12:05 AM')
    expect(formatClock(at(12))).toBe('12:00 PM')
  })
})

describe('date formatting', () => {
  it('writes dates in British order', () => {
    expect(formatWeekday(at(9))).toBe('Tuesday')
    expect(formatDayMonth(at(9))).toBe('13 October')
    expect(formatLongDate(at(9))).toBe('Tuesday 13 October 2026')
  })
})
