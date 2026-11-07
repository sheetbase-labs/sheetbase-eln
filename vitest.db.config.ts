import { defineConfig } from 'vitest/config'

// Database integration layer: runs against a real local PostgreSQL with the
// full migration history applied to a disposable database. Requires
// `pnpm services:up`. See docs/development/testing.md.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Server code logs structured lines on expected error paths, which buried
    // the results. Keep console output only for tests that fail; pass
    // --silent=false to see everything.
    silent: 'passed-only',
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    setupFiles: ['tests/db/setup.ts'],
    // Generates the uncommitted route tree and API contract when missing.
    globalSetup: ['tests/global-generate.ts'],
    // Each worker clones the migrated template into its own database, so files
    // run in parallel without sharing state (see tests/db/helpers.ts).
    fileParallelism: true,
    maxWorkers: 12,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
