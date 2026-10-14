import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // Fixed ports, so the local address never changes and never silently
  // collides with another project's dev server.
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    // Dates and deadlines are tested in the owner's own time zone, on any machine.
    env: { TZ: 'Europe/London' },
  },
})
