import { defineConfig } from 'vitest/config'

// Database integration layer: runs against a real local PostgreSQL with the
// full migration history applied to a disposable database. Requires
// `pnpm services:up`. See docs/development/testing.md.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    setupFiles: ['tests/db/setup.ts'],
    // Each worker clones the migrated template into its own database, so files
    // run in parallel without sharing state (see tests/db/helpers.ts).
    fileParallelism: true,
    maxWorkers: 12,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
