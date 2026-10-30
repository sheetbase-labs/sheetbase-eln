import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { latestMigrationVersion } from '#/lib/deployment-plan'

/**
 * The newest migration this build carries, read from the journal that ships
 * with it. Diagnostics compares it with what the database has applied, so an
 * install that was not built with an explicit expectation (a plain container
 * build, or running from source) still says whether its schema matches.
 */
export function bundledMigrationVersion(root = process.cwd()): string | null {
  try {
    const journal = JSON.parse(
      readFileSync(resolve(root, 'drizzle/meta/_journal.json'), 'utf8'),
    ) as Parameters<typeof latestMigrationVersion>[0]
    return latestMigrationVersion(journal).version
  } catch {
    return null
  }
}
