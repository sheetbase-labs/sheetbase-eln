import { defineConfig } from 'vitest/config'

// Real HTTP contract layer: the same-origin proxy talks to the running pinned
// PostgREST service and a fresh migrated database per file. The whole database
// is dropped afterwards; retained evidence is never deleted row by row.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Server code logs structured lines on expected error paths, which buried
    // the results. Keep console output only for tests that fail; pass
    // --silent=false to see everything.
    silent: 'passed-only',
    environment: 'node',
    include: ['tests/api/**/*.test.ts'],
    fileParallelism: false,
    sequence: { hooks: 'stack' },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['tests/api/setup.ts'],
    // Generates the uncommitted route tree and API contract when missing.
    globalSetup: ['tests/global-generate.ts'],
  },
})
