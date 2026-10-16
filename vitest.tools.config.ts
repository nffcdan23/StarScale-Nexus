import { defineConfig } from 'vitest/config'

// The Node tools: backup and restore (Phase 3c-4b-1), the cloud tools
// (Phase 3c-4b-2) and the desktop build variants (Phase 3c-4b-3). Fictional data in throwaway in-memory databases and fake
// connections only: nothing here reaches a real database or the internet.
// Runs on any computer (npm run test:tools) and is part of npm run check.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/backup/**/*.test.mjs', 'tests/cloud/**/*.test.mjs', 'tests/desktop/**/*.test.mjs'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
