import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Server code logs structured lines on expected error paths, which buried
    // the results. Keep console output only for tests that fail; pass
    // --silent=false to see everything.
    silent: 'passed-only',
    environment: 'jsdom',
    // Restores web storage (and matchMedia) that Node ≥ 26's experimental
    // globals shadow inside the jsdom environment; see tests/unit/setup.ts.
    setupFiles: ['tests/unit/setup.ts'],
    exclude: [
      ...configDefaults.exclude,
      // Database, API and browser layers need the local service stack and
      // their own configs; see docs/development/testing.md.
      'tests/db/**',
      'tests/api/**',
      'tests/browser/**',
      'tests/visual/**',
    ],
  },
})
