import { defineConfig } from 'vitest/config'

// Integration tests: the real data layer against a real LOCAL Supabase stack.
// Windows PC only (npm run test:integration); never part of npm run check.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
