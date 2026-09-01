import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
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
    ],
  },
})
