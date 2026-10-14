import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataError } from '../data/types'
import { REFRESH_INTERVAL, useLiveData } from './useLiveData'

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Lets pending promises settle while fake timers are in use. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(0))

describe('useLiveData', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setVisibility('visible')
  })
  afterEach(() => setVisibility('visible'))

  it('loads at once, then every 30 seconds while visible', async () => {
    const load = vi.fn(async () => 'data')
    const { result } = renderHook(() => useLiveData(load))
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current.data).toBe('data')
    expect(result.current.updatedAt).toBeInstanceOf(Date)

    await act(() => vi.advanceTimersByTimeAsync(REFRESH_INTERVAL))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('pauses while hidden and refreshes the moment the page is visible again', async () => {
    const load = vi.fn(async () => 'data')
    renderHook(() => useLiveData(load))
    await settle()

    act(() => setVisibility('hidden'))
    await act(() => vi.advanceTimersByTimeAsync(REFRESH_INTERVAL * 4))
    expect(load).toHaveBeenCalledTimes(1)

    act(() => setVisibility('visible'))
    await settle()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('refreshes when the network comes back', async () => {
    const load = vi.fn(async () => 'data')
    renderHook(() => useLiveData(load))
    await settle()
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await settle()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good data when a refresh fails, and clears the problem on the next success', async () => {
    let fail = false
    const load = vi.fn(async () => {
      if (fail) throw new DataError('offline', 'Could not load: Nexus cannot reach the database.')
      return 'good'
    })
    const { result } = renderHook(() => useLiveData(load))
    await settle()
    const firstUpdate = result.current.updatedAt

    fail = true
    await act(() => vi.advanceTimersByTimeAsync(REFRESH_INTERVAL))
    expect(result.current.data).toBe('good')
    expect(result.current.error).toEqual({ kind: 'offline', message: 'Could not load: Nexus cannot reach the database.' })
    expect(result.current.updatedAt).toBe(firstUpdate)

    fail = false
    await act(() => vi.advanceTimersByTimeAsync(REFRESH_INTERVAL))
    expect(result.current.error).toBeUndefined()
    expect(result.current.updatedAt).not.toBe(firstUpdate)
  })

  it('reports a first load that fails, with nothing to show', async () => {
    const load = vi.fn(async () => {
      throw new DataError('refused', 'Nexus refused.')
    })
    const { result } = renderHook(() => useLiveData(load))
    expect(result.current.loading).toBe(true)
    await settle()
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeUndefined()
    expect(result.current.error?.kind).toBe('refused')
  })

  it('never lets an older, slower reply replace a newer one', async () => {
    const replies: Array<(value: string) => void> = []
    const load = vi.fn(() => new Promise<string>((resolve) => replies.push(resolve)))
    const { result } = renderHook(() => useLiveData(load))
    act(() => void result.current.refresh())
    await act(async () => {
      replies[1]('newer')
      replies[0]('older')
    })
    expect(result.current.data).toBe('newer')
  })

  it('stops refreshing when the screen closes', async () => {
    const load = vi.fn(async () => 'data')
    const { unmount } = renderHook(() => useLiveData(load))
    await settle()
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(REFRESH_INTERVAL * 3))
    expect(load).toHaveBeenCalledTimes(1)
  })
})
