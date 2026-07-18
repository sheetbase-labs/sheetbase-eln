import { defineConfig } from 'vitest/config'

// Database integration layer: runs against a real local PostgreSQL with the
// full migration history applied to a disposable database. Requires
// `pnpm services:up`. See docs/testing.md.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
