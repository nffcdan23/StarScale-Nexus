import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Start every test from a clean page and the real clock.
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
