/**
 * Make sure the derived files exist: the feature indexes, the route tree,
 * the public OpenAPI contract, the SDKs' event vocabulary and the Python
 * SDK's generated layer.
 *
 * They are not committed (see .gitignore), because two PRs that each added a
 * route or an endpoint conflicted on them and every merge made the rest
 * rebase. CI generates them once after install (`pnpm generate`); this script
 * does the same on a developer machine, but only for what is missing, so it
 * is cheap to run before typecheck and before the test layers.
 *
 * Usage: node scripts/ensure-generated.mjs [--force]
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { generateFeatures } from './generate-features.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ROUTE_TREE = `${ROOT}src/routeTree.gen.ts`
const OPENAPI = `${ROOT}docs/api/openapi/external-api-v0.json`
const SDK = `${ROOT}sdks/python/src/sheetbase/_generated/rpc.py`

// The webhook event vocabulary for the SDKs, written with the contract.
const EVENTS = [
  `${ROOT}docs/api/openapi/events.json`,
  `${ROOT}sdks/typescript/src/resources/event-names.gen.ts`,
  `${ROOT}sdks/python/src/sheetbase/_generated/events.py`,
]

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' })

export function ensureGenerated({ force = false } = {}) {
  // Cheap, and a new feature folder must show up at once: always rewritten
  // (only when it changes).
  generateFeatures()

  if (force || !existsSync(ROUTE_TREE)) {
    run('node', ['scripts/generate-routes.mjs'])
  }

  if (
    force ||
    !existsSync(OPENAPI) ||
    !existsSync(SDK) ||
    EVENTS.some((path) => !existsSync(path))
  ) {
    run('node_modules/.bin/tsx', ['scripts/generate-public-openapi.ts'])
    // The file is git-ignored, which prettier would otherwise honour and skip.
    run('node_modules/.bin/prettier', [
      '--ignore-path',
      '.prettierignore',
      '--write',
      'docs/api/openapi/external-api-v0.json',
    ])
    run('python3', ['sdks/python/scripts/generate.py'])
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ensureGenerated({ force: process.argv.includes('--force') })
}
