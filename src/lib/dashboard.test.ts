import { describe, expect, it } from 'vitest'
import type { Context, Deadline, Task } from '../data/types'
import {
  addDays,
  contextProgress,
  dailySummary,
  dayLabel,
  deadlineLabel,
  londonDate,
  nextSevenDays,
  startOfLondonWeek,
  todayTasks,
} from './dashboard'

/** 2:30 PM on Wednesday 14 October 2026, London time (13:30 UTC). */
const now = new Date('2026-10-14T13:30:00Z')

let created = 0
function task(title: string, deadline: Deadline, changes: Partial<Task> = {}): Task {
  created += 1
  return {
    id: title,
    contextId: 'c1',
    title,
    notes: null,
    status: 'open',
    priority: 'medium',
    hideFromTv: false,
    deadline,
    completedAt: null,
    createdAt: `2026-10-01T00:00:${String(created).padStart(2, '0')}Z`,
    updatedAt: '',
    archivedAt: null,
    ...changes,
  }
}

const titles = (tasks: Task[]) => tasks.map((entry) => entry.title)

describe('London days', () => {
  it('uses the London calendar day, not the computer\'s or UTC\'s', () => {
    // 11:30 PM UTC on 16 October is 12:30 AM on 17 October in London (summer time).
    expect(londonDate(new Date('2026-10-16T23:30:00Z'))).toBe('2026-10-17')
    // After the clocks go back on 25 October, London is on UTC.
    expect(londonDate(new Date('2026-10-26T23:30:00Z'))).toBe('2026-10-26')
  })

  it('moves across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('starts the week at Monday midnight London time', () => {
    // Wednesday 14 October: the week began Monday 12 October, 00:00 BST = 11 October 23:00 UTC.
    expect(startOfLondonWeek(now).toISOString()).toBe('2026-10-11T23:00:00.000Z')
    // Monday 26 October, after the clocks went back: midnight is 00:00 UTC.
    expect(startOfLondonWeek(new Date('2026-10-26T10:00:00Z')).toISOString()).toBe('2026-10-26T00:00:00.000Z')
    // Sunday evening still belongs to the week that began the previous Monday.
    expect(startOfLondonWeek(new Date('2026-10-18T20:00:00Z')).toISOString()).toBe('2026-10-11T23:00:00.000Z')
  })

  it('names days the British way', () => {
    expect(dayLabel('2026-10-14', '2026-10-14')).toBe('Today')
    expect(dayLabel('2026-10-15', '2026-10-14')).toBe('Tomorrow')
    expect(dayLabel('2026-10-13', '2026-10-14')).toBe('Yesterday')
    expect(dayLabel('2026-10-17', '2026-10-14')).toBe('Sat 17 Oct')
    expect(dayLabel('2027-01-08', '2026-10-14')).toBe('Fri 8 Jan 2027')
    expect(deadlineLabel({ kind: 'time', at: '2026-10-14T16:00:00Z' }, now)).toBe('Today, 5:00 PM')
  })
})

describe('todayTasks', () => {
  it('puts passed deadlines in overdue, earliest first', () => {
    const tasks = [
      task('Due today, all day', { kind: 'date', date: '2026-10-14' }),
      task('Yesterday', { kind: 'date', date: '2026-10-13' }),
      task('Earlier today', { kind: 'time', at: '2026-10-14T08:00:00Z' }),
      task('Last week', { kind: 'date', date: '2026-10-07' }),
    ]
    expect(titles(todayTasks(tasks, now).overdue)).toEqual(['Last week', 'Yesterday', 'Earlier today'])
  })

  it('lists what is still due today by priority, and nothing else', () => {
    const tasks = [
      task('Later today, low', { kind: 'time', at: '2026-10-14T17:00:00Z' }, { priority: 'low' }),
      task('Today, all day', { kind: 'date', date: '2026-10-14' }),
      task('Later today, high', { kind: 'time', at: '2026-10-14T18:00:00Z' }, { priority: 'high' }),
      task('Tomorrow', { kind: 'date', date: '2026-10-15' }),
      task('Just after midnight', { kind: 'time', at: '2026-10-14T23:30:00Z' }), // 15 Oct in London
      task('No deadline', null),
    ]
    expect(titles(todayTasks(tasks, now).dueToday)).toEqual(['Later today, high', 'Today, all day', 'Later today, low'])
  })
})

describe('nextSevenDays', () => {
  it('groups the next seven London days after today, all-day first then by time', () => {
    const tasks = [
      task('Thu 9 AM', { kind: 'time', at: '2026-10-15T08:00:00Z' }),
      task('Thu all day', { kind: 'date', date: '2026-10-15' }),
      task('Just after midnight', { kind: 'time', at: '2026-10-14T23:30:00Z' }),
      task('Wed next week', { kind: 'date', date: '2026-10-21' }),
      task('Thu next week', { kind: 'date', date: '2026-10-22' }), // eighth day: left out
      task('Today', { kind: 'date', date: '2026-10-14' }), // today: left out
      task('No deadline', null),
    ]
    const days = nextSevenDays(tasks, now)
    expect(days.map((day) => [day.label, titles(day.tasks)])).toEqual([
      ['Tomorrow', ['Thu all day', 'Just after midnight', 'Thu 9 AM']],
      ['Wed 21 Oct', ['Wed next week']],
    ])
  })
})

describe('contextProgress', () => {
  const contexts: Context[] = [
    { id: 'c1', name: 'Personal', showOnTv: false, archivedAt: null, createdAt: '1' },
    { id: 'c2', name: 'StarScale', showOnTv: true, archivedAt: null, createdAt: '2' },
    { id: 'c3', name: 'Empty', showOnTv: false, archivedAt: null, createdAt: '3' },
    { id: 'c4', name: 'Old', showOnTv: false, archivedAt: '2026-10-01', createdAt: '4' },
  ]

  it('counts open tasks and this week\'s completions for each context that has any', () => {
    const open = [task('a', null), task('b', null), task('c', null, { contextId: 'c2' }), task('d', null, { contextId: 'c4' })]
    const done = [task('e', null, { contextId: 'c2', status: 'done' }), task('f', null, { contextId: 'c2', status: 'done' })]
    expect(contextProgress(contexts, open, done)).toEqual([
      { id: 'c1', name: 'Personal', archived: false, open: 2, doneThisWeek: 0 },
      { id: 'c2', name: 'StarScale', archived: false, open: 1, doneThisWeek: 2 },
      { id: 'c4', name: 'Old', archived: true, open: 1, doneThisWeek: 0 },
    ])
  })
})

describe('dailySummary', () => {
  const some = (n: number) => Array.from({ length: n }, (_, index) => task(`t${index}`, null))

  it('says what is overdue and due today in plain words', () => {
    expect(dailySummary({ overdue: some(1), dueToday: some(3) }, 7, 2)).toEqual({
      headline: '1 overdue task and 3 due today.',
      detail: '7 open tasks in total, and 2 tasks completed since Monday.',
    })
    expect(dailySummary({ overdue: some(2), dueToday: [] }, 2, 1).headline).toBe('2 overdue tasks.')
    expect(dailySummary({ overdue: [], dueToday: some(1) }, 1, 0).headline).toBe('1 task due today.')
    expect(dailySummary({ overdue: [], dueToday: [] }, 4, 0).headline).toBe('Nothing due today.')
    expect(dailySummary({ overdue: [], dueToday: [] }, 0, 0)).toEqual({
      headline: 'No open tasks.',
      detail: '0 open tasks in total, and 0 tasks completed since Monday.',
    })
  })
})
