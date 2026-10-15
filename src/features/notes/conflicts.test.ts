import { describe, expect, it } from 'vitest'
import type { Note } from '../../data/types'
import { copyTitle, sameAsDatabase } from './conflicts'

describe('copyTitle', () => {
  it('names the copy after the version it keeps, in London time', () => {
    expect(copyTitle({ title: 'Plans', changedAt: '2026-10-15T13:41:00Z' })).toBe('Plans (my version, 15 Oct, 2:41 PM)')
    expect(copyTitle({ title: '  ', changedAt: '2026-11-02T09:05:00Z' })).toBe('Untitled (my version, 2 Nov, 9:05 AM)')
  })

  it('never goes over the title limit', () => {
    const title = copyTitle({ title: 'x'.repeat(200), changedAt: '2026-10-15T13:41:00Z' })
    expect(title.length).toBeLessThanOrEqual(200)
    expect(title.endsWith('(my version, 15 Oct, 2:41 PM)')).toBe(true)
  })
})

describe('sameAsDatabase', () => {
  const latest = {
    title: 'Plans',
    contextId: null,
    content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ text: 'Hi', type: 'text' }] }] },
  } as unknown as Note

  it('ignores the order the database returns keys in', () => {
    const mine = {
      title: 'Plans',
      contextId: null,
      content: { content: [{ attrs: { level: 2 }, type: 'heading', content: [{ type: 'text', text: 'Hi' }] }], type: 'doc' as const },
    }
    expect(sameAsDatabase(mine, latest)).toBe(true)
  })

  it('notices any real difference', () => {
    const base = { title: 'Plans', contextId: null, content: latest.content }
    expect(sameAsDatabase({ ...base, title: 'Plans!' }, latest)).toBe(false)
    expect(sameAsDatabase({ ...base, contextId: 'c1' }, latest)).toBe(false)
    expect(sameAsDatabase({ ...base, content: { type: 'doc', content: [] } }, latest)).toBe(false)
  })
})
