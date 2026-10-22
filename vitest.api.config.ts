import { defineConfig } from 'vitest/config'

// Real HTTP contract layer: the same-origin proxy talks to the running pinned
// PostgREST service and a fresh migrated database per file. The whole database
// is dropped afterwards; retained evidence is never deleted row by row.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/api/**/*.test.ts'],
    fileParallelism: false,
    sequence: { hooks: 'stack' },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['tests/api/setup.ts'],
  },
})
