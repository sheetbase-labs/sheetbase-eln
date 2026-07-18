/**
 * Guard for destructive local database operations. Pure and separately tested;
 * src/db/reset.ts refuses to run unless this passes.
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

const RESETTABLE_DATABASES = /^sheetbase(_test)?$/

export interface ResettableTarget {
  /** Name of the database that may be dropped and recreated. */
  databaseName: string
  /** Connection URL for the PostgreSQL maintenance database. */
  maintenanceUrl: string
}

export function parseResettableDatabaseUrl(url: string): ResettableTarget {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${url}`)
  }

  if (!parsed.hostname || !LOCAL_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(
      `Refusing to reset a non-local database (host "${parsed.hostname || '(none)'}"). ` +
        'Reset is only allowed against localhost.',
    )
  }

  const databaseName = parsed.pathname.replace(/^\//, '')
  if (!RESETTABLE_DATABASES.test(databaseName)) {
    throw new Error(
      `Refusing to reset database "${databaseName}". ` +
        'Only local sheetbase development and test databases may be reset.',
    )
  }

  const maintenance = new URL(parsed.toString())
  maintenance.pathname = '/postgres'

  return { databaseName, maintenanceUrl: maintenance.toString() }
}
