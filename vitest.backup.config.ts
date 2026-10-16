import { defineConfig } from 'vitest/config'

// Backup and restore tools (Phase 3c-4b-1): fictional data in throwaway
// in-memory databases. Runs on any computer (npm run test:backup) and is
// part of npm run check.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/backup/**/*.test.mjs'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
