import { defineConfig } from 'vitest/config'

// Real HTTP contract layer: the same-origin proxy talks to the running pinned
// PostgREST service and the local migrated database. The fixed fixture
// workspace is removed before and after each suite.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/api/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['tests/api/setup.ts'],
  },
})
