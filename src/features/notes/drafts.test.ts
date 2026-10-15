import { renderHook, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { drafts, registerOpenNote, saveOpenNotes, useNoteDrafts, type NoteDraft } from './drafts'

const draft = (changes: Partial<NoteDraft> = {}): NoteDraft => ({
  ownerId: 'owner-1',
  noteId: 'note-1',
  isNew: false,
  baseRevision: 3,
  title: 'Plans',
  contextId: null,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unsaved text' }] }] },
  changedAt: '2026-10-15T10:00:00.000Z',
  held: false,
  ...changes,
})

afterEach(() => {
  localStorage.clear()
  drafts.allow('owner-1')
})

describe('note drafts', () => {
  it('stores and reads back a draft for its owner and note', () => {
    expect(drafts.available()).toBe(true)
    expect(drafts.write(draft())).toBe(true)
    expect(drafts.read('owner-1', 'note-1')).toEqual(draft())
  })

  it('keeps each account\'s drafts to itself', () => {
    drafts.write(draft())
    drafts.write(draft({ ownerId: 'owner-2', noteId: 'note-2' }))
    expect(drafts.list('owner-1').map((entry) => entry.noteId)).toEqual(['note-1'])
    expect(drafts.read('owner-2', 'note-1')).toBeNull()
  })

  it('ignores damaged or mislabelled entries instead of trusting them', () => {
    localStorage.setItem('nexus.noteDraft.v1:owner-1:note-9', '{not json')
    localStorage.setItem('nexus.noteDraft.v1:owner-1:note-8', JSON.stringify(draft({ noteId: 'note-8', content: { type: 'paragraph' } as never })))
    // Filed under owner-1 but claiming to be owner-2's.
    localStorage.setItem('nexus.noteDraft.v1:owner-1:note-7', JSON.stringify(draft({ noteId: 'note-7', ownerId: 'owner-2' })))
    localStorage.setItem('nexus.noteDraft.v1:owner-1:note-6', JSON.stringify(draft({ noteId: 'note-6', title: 'x'.repeat(201) })))
    expect(drafts.list('owner-1')).toEqual([])
    // Ignored, not deleted.
    expect(localStorage.getItem('nexus.noteDraft.v1:owner-1:note-9')).toBe('{not json')
  })

  it('reports a write that did not stick, as when storage is full', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    expect(drafts.available()).toBe(false)
    expect(drafts.write(draft())).toBe(false)
    setItem.mockRestore()
  })

  it('keeps a version aside under its own id without losing it, then lists both kinds', () => {
    drafts.write(draft())
    const held = drafts.hold(draft(), 'held-1')
    expect(held).toEqual(draft({ held: true, heldId: 'held-1' }))
    expect(drafts.read('owner-1', 'note-1')).toBeNull()
    expect(drafts.readHeld('owner-1', 'note-1')).toEqual([held])
    drafts.write(draft({ changedAt: '2026-10-15T11:00:00.000Z' }))
    expect(drafts.list('owner-1').map((entry) => entry.held)).toEqual([false, true])
  })

  it('keeps every conflicting version, oldest first, and removes each one on its own', () => {
    drafts.hold(draft({ changedAt: '2026-10-15T12:00:00.000Z' }), 'later')
    drafts.hold(draft({ changedAt: '2026-10-15T10:00:00.000Z' }), 'earlier')
    const held = drafts.readHeld('owner-1', 'note-1')
    expect(held.map((entry) => entry.heldId)).toEqual(['earlier', 'later'])
    drafts.removeHeld(held[0])
    expect(drafts.readHeld('owner-1', 'note-1').map((entry) => entry.heldId)).toEqual(['later'])
  })

  it('does not remove the original if the held copy cannot be written', () => {
    drafts.write(draft())
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    expect(drafts.hold(draft())).toBeNull()
    setItem.mockRestore()
    expect(drafts.read('owner-1', 'note-1')).toEqual(draft())
  })

  it('does not remove a newer draft written meanwhile when holding an older one', () => {
    drafts.write(draft({ changedAt: '2026-10-15T11:00:00.000Z', writer: 'tab-b' }))
    drafts.hold(draft({ writer: 'tab-a' }), 'held-1')
    expect(drafts.read('owner-1', 'note-1')?.writer).toBe('tab-b')
  })

  it('lets a tab remove only the draft it wrote itself', () => {
    drafts.write(draft({ writer: 'tab-b' }))
    drafts.remove('owner-1', 'note-1', 'tab-a')
    expect(drafts.read('owner-1', 'note-1')).not.toBeNull()
    drafts.remove('owner-1', 'note-1', 'tab-b')
    expect(drafts.read('owner-1', 'note-1')).toBeNull()
  })

  it('reads a held version saved before Phase 3c-3 and refiles it under its own id', () => {
    const legacy = { ...draft(), held: true }
    localStorage.setItem('nexus.noteDraft.v1:owner-1:note-1:held', JSON.stringify(legacy))
    const [found] = drafts.readHeld('owner-1', 'note-1')
    expect(found).toEqual(legacy)
    const refiled = drafts.hold(found, 'new-id')
    expect(refiled?.heldId).toBe('new-id')
    expect(localStorage.getItem('nexus.noteDraft.v1:owner-1:note-1:held')).toBeNull()
    expect(drafts.readHeld('owner-1', 'note-1').map((entry) => entry.heldId)).toEqual(['new-id'])
  })

  it('deletes all of an owner\'s drafts at sign-out and writes none until Notes opens again', () => {
    drafts.write(draft())
    drafts.hold(draft({ noteId: 'note-2' }), 'held-2')
    drafts.write(draft({ ownerId: 'owner-2' }))
    drafts.deleteAllAndStop('owner-1')
    expect(drafts.list('owner-1')).toEqual([])
    expect(drafts.list('owner-2')).toHaveLength(1)
    expect(drafts.write(draft())).toBe(false)
    drafts.allow('owner-1')
    expect(drafts.write(draft())).toBe(true)
  })

  it('updates screens when drafts change', () => {
    const { result } = renderHook(() => useNoteDrafts('owner-1'))
    expect(result.current).toEqual([])
    act(() => {
      drafts.write(draft())
    })
    expect(result.current.map((entry) => entry.noteId)).toEqual(['note-1'])
    const before = result.current
    act(() => {
      drafts.remove('owner-1', 'note-1')
    })
    expect(result.current).toEqual([])
    expect(result.current).not.toBe(before)
  })
})

describe('saving open notes before signing out', () => {
  it('waits for open notes to save, but never longer than the limit', async () => {
    vi.useFakeTimers()
    const quick = vi.fn(async () => {})
    const stuck = vi.fn(() => new Promise<void>(() => {}))
    const unregisterQuick = registerOpenNote(quick)
    const unregisterStuck = registerOpenNote(stuck)
    let done = false
    void saveOpenNotes(5_000).then(() => (done = true))
    await act(() => vi.advanceTimersByTimeAsync(4_999))
    expect(done).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(done).toBe(true)
    expect(quick).toHaveBeenCalled()
    unregisterQuick()
    unregisterStuck()
  })
})
