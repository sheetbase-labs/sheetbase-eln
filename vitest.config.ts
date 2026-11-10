import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  // The @sheetbase-labs packages can be linked from a checkout with its own
  // node_modules, which loads a second copy of React ("Invalid hook call").
  resolve: { tsconfigPaths: true, dedupe: ['react', 'react-dom'] },
  test: {
    // Server code logs structured lines on expected error paths, which buried
    // the results. Keep console output only for tests that fail; pass
    // --silent=false to see everything.
    silent: 'passed-only',
    // Run linked component packages and their React-using dependencies through
    // Vite so the React dedupe above reaches them.
    server: {
      deps: { inline: [/sheetbase-components\//, /@tanstack\/react-virtual/] },
    },
    environment: 'jsdom',
    // Restores web storage (and matchMedia) that Node ≥ 26's experimental
    // globals shadow inside the jsdom environment; see tests/unit/setup.ts.
    setupFiles: ['tests/unit/setup.ts'],
    // Generates the uncommitted route tree and API contract when missing.
    globalSetup: ['tests/global-generate.ts'],
    exclude: [
      ...configDefaults.exclude,
      // Disposable comparison copies are evidence, not maintained test suites.
      '.amp/in/**',
      // Database, API and browser layers need the local service stack and
      // their own configs; see docs/development/testing.md.
      'tests/db/**',
      'tests/api/**',
      'tests/browser/**',
      'tests/visual/**',
    ],
  },
})
