import { latestMigrationVersion } from '#/lib/deployment-plan'

import { readJournal } from '../../scripts/lib/migrations.mjs'

/**
 * The newest migration this build carries, read from the journal that ships
 * with it. Diagnostics compares it with what the database has applied, so an
 * install that was not built with an explicit expectation (a plain container
 * build, or running from source) still says whether its schema matches.
 */
export function bundledMigrationVersion(root = process.cwd()): string | null {
  try {
    return latestMigrationVersion(readJournal(`${root}/drizzle`)).version
  } catch {
    return null
  }
}
