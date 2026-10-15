import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Start every test from a clean page, empty browser storage and the real clock.
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})
