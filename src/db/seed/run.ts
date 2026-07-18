/**
 * Seed runner. See docs/seeds.md.
 *
 * Usage:
 *   pnpm db:seed        minimal fixtures only (safe for tests to assume absent)
 *   pnpm db:seed --demo fixtures plus the Virus Stability demonstration data
 *
 * Every step must be idempotent: upsert on a natural or stable key so reruns
 * converge instead of duplicating. Steps are added here as schema lands
 * (identity/workspace/project steps arrive with API-003).
 */
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'

import * as schema from '../schema'

config({ path: ['.env.local', '.env'] })

export interface SeedStep {
  name: string
  run: (db: ReturnType<typeof createDb>) => Promise<void>
}

function createDb(databaseUrl: string) {
  return drizzle(databaseUrl, { schema })
}

/**
 * Minimal fixtures: the stable initial user, workspace and project from
 * src/db/seed/identities.ts. Integration tests may assume these exist after
 * `pnpm db:seed`, but tests must still create their own isolated data rather
 * than mutating fixture rows.
 */
export const fixtureSteps: Array<SeedStep> = [
  // API-003: upsert fixture user, workspace, owner membership and project
  // using the FIXTURE_* identities. Keep steps idempotent (ON CONFLICT on the
  // stable key).
]

/**
 * Demonstration data: the Virus Stability example. Richer and slower than
 * fixtures; for humans exploring the product, never for test assertions.
 */
export const demoSteps: Array<SeedStep> = [
  // SCI-009: build the Virus Stability experiment from ordinary UI/API
  // capabilities. Until then this intentionally stays empty.
]

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. Copy .env.example to .env.local.',
    )
  }

  const withDemo = process.argv.includes('--demo')
  const steps = withDemo ? [...fixtureSteps, ...demoSteps] : fixtureSteps

  const db = createDb(databaseUrl)
  for (const step of steps) {
    await step.run(db)
    console.log(`seed: ${step.name}`)
  }

  console.log(
    steps.length === 0
      ? 'Seed complete: no steps defined yet (schema lands with API-003).'
      : `Seed complete: ${steps.length} step(s) applied idempotently.`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
