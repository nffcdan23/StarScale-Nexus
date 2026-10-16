import { afterEach, describe, expect, it, vi } from 'vitest'
import { draftPrefix, type NoteDraft } from './drafts'

// A fictional project id: it belongs to no real project.
const cloudUrl = 'https://abcdefghijklmnopqrst.supabase.co'

const draft = (noteId: string): NoteDraft => ({
  ownerId: 'owner-1',
  noteId,
  isNew: false,
  baseRevision: 2,
  title: 'Fictional note',
  contextId: null,
  content: { type: 'doc', content: [] },
  changedAt: '2026-10-17T10:00:00.000Z',
  held: false,
})

/** The drafts module as a build for this address would load it. */
async function draftsFor(url: string) {
  vi.stubEnv('VITE_SUPABASE_URL', url)
  vi.resetModules()
  return (await import('./drafts')).drafts
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  localStorage.clear()
})

describe('drafts are filed per database', () => {
  it('keeps the original names for the local stack, and separate ones for a cloud project', () => {
    expect(draftPrefix({ kind: 'local' })).toBe('nexus.noteDraft.v1:')
    const cloud = draftPrefix({ kind: 'cloud', projectRef: 'abcdefghijklmnopqrst' })
    expect(cloud).toBe('nexus.noteDraft.v1@abcdefghijklmnopqrst:')
    expect(cloud.startsWith(draftPrefix({ kind: 'local' }))).toBe(false)
  })

  it('a cloud build never lists, restores or removes a draft made against the local database', async () => {
    const local = await draftsFor('http://127.0.0.1:54321')
    expect(local.write(draft('local-note'))).toBe(true)

    const cloud = await draftsFor(cloudUrl)
    expect(cloud.list('owner-1')).toEqual([])
    expect(cloud.read('owner-1', 'local-note')).toBeNull()
    expect(cloud.write(draft('cloud-note'))).toBe(true)
    cloud.deleteAllAndStop('owner-1')
    cloud.allow('owner-1')

    // The local draft is untouched by all of that.
    const localAgain = await draftsFor('http://127.0.0.1:54321')
    expect(localAgain.list('owner-1').map((entry) => entry.noteId)).toEqual(['local-note'])
    expect(localStorage.getItem('nexus.noteDraft.v1:owner-1:local-note')).not.toBeNull()
  })

  it('a local build never sees a draft made against the cloud project', async () => {
    const cloud = await draftsFor(cloudUrl)
    cloud.write(draft('cloud-note'))
    const local = await draftsFor('http://127.0.0.1:54321')
    expect(local.list('owner-1')).toEqual([])
    expect(localStorage.getItem('nexus.noteDraft.v1@abcdefghijklmnopqrst:owner-1:cloud-note')).not.toBeNull()
  })
})
