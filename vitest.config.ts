import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    exclude: [
      ...configDefaults.exclude,
      // Database, API and browser layers need the local service stack and
      // their own configs; see docs/testing.md.
      'tests/db/**',
      'tests/api/**',
      'tests/browser/**',
    ],
  },
})
