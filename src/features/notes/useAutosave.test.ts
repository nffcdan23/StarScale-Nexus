import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutosave, type SaveOutcome } from './useAutosave'

// The autosave timing on its own, with a controllable clock.

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** A note being edited: edits make it dirty, a successful save cleans it. */
function harness(outcomes: SaveOutcome[] = []) {
  const state = { dirty: false, edits: 0 }
  const save = vi.fn(async (): Promise<SaveOutcome> => {
    const outcome = outcomes.shift() ?? 'saved'
    if (outcome === 'saved') state.dirty = false
    return outcome
  })
  const hook = renderHook(({ editCount }) => useAutosave({ editCount, isDirty: () => state.dirty, save }), {
    initialProps: { editCount: 0 },
  })
  const edit = () => {
    state.dirty = true
    state.edits += 1
    hook.rerender({ editCount: state.edits })
  }
  return { state, save, hook, edit }
}

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

beforeEach(() => {
  vi.useFakeTimers()
  setVisibility('visible')
})
afterEach(() => setVisibility('visible'))

describe('autosave timing', () => {
  it('saves two seconds after the last edit', async () => {
    const { save, edit } = harness()
    edit()
    await wait(1_900)
    edit()
    await wait(1_900)
    expect(save).not.toHaveBeenCalled()
    await wait(100)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('saves at least every 15 seconds while editing continues', async () => {
    const { save, edit } = harness()
    for (let second = 0; second < 15; second += 1) {
      edit()
      await wait(1_000)
    }
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does nothing until something is edited', async () => {
    const { save } = harness()
    await wait(60_000)
    expect(save).not.toHaveBeenCalled()
  })

  it('runs one save at a time, and saves edits made during a save next', async () => {
    const { state, save, hook, edit } = harness()
    let finish: (outcome: SaveOutcome) => void = () => {}
    save.mockImplementationOnce(() => new Promise<SaveOutcome>((resolve) => (finish = resolve)))
    edit()
    await wait(2_000)
    expect(save).toHaveBeenCalledTimes(1)

    edit() // typed while the first save is on its way
    void hook.result.current.saveNow()
    expect(save).toHaveBeenCalledTimes(1)

    await act(async () => finish('saved'))
    state.dirty = true // the first save only covered the earlier edits
    await wait(2_000)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('saves at once on request', async () => {
    const { save, hook, edit } = harness()
    edit()
    await act(() => hook.result.current.saveNow())
    expect(save).toHaveBeenCalledTimes(1)
    await wait(5_000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('saves at once when the tab is hidden', async () => {
    const { save, edit } = harness()
    edit()
    await act(async () => setVisibility('hidden'))
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('autosave retries', () => {
  it('retries after 5, 15 and 30 seconds, then every minute', async () => {
    const { save, hook, edit } = harness(['retry', 'retry', 'retry', 'retry', 'retry'])
    edit()
    await wait(2_000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(hook.result.current.retrying).toBe(true)

    for (const [delay, calls] of [
      [5_000, 2],
      [15_000, 3],
      [30_000, 4],
      [60_000, 5],
      [60_000, 6],
    ]) {
      await wait(delay - 1)
      expect(save).toHaveBeenCalledTimes(calls - 1)
      await wait(1)
      expect(save).toHaveBeenCalledTimes(calls)
    }
    expect(hook.result.current.retrying).toBe(false)
  })

  it('retries at once when the network returns, then stops retrying once saved', async () => {
    const { save, hook, edit } = harness(['retry'])
    edit()
    await wait(2_000)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(save).toHaveBeenCalledTimes(2)
    expect(hook.result.current.retrying).toBe(false)
    await wait(120_000)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('keeps its retry pace while editing continues offline', async () => {
    const { save, edit } = harness(['retry'])
    edit()
    await wait(2_000)
    edit()
    await wait(2_000)
    expect(save).toHaveBeenCalledTimes(1)
    await wait(3_000)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('does not retry a stopped save (a conflict) until asked again', async () => {
    const { save, edit } = harness(['stop'])
    edit()
    await wait(2_000)
    await wait(120_000)
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('stops all timers when the note closes', async () => {
    const { save, hook, edit } = harness()
    edit()
    hook.unmount()
    await wait(60_000)
    expect(save).not.toHaveBeenCalled()
  })
})
