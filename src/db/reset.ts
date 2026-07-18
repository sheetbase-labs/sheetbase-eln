/**
 * Reset the local development database: drop it and recreate it empty.
 * Guarded by src/db/reset-guard.ts — local sheetbase databases only.
 *
 * Usage: pnpm db:reset
 */
import { config } from 'dotenv'
import { Client } from 'pg'

import { parseResettableDatabaseUrl } from './reset-guard'

config({ path: ['.env.local', '.env'] })

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. Copy .env.example to .env.local.',
    )
  }

  const { databaseName, maintenanceUrl } =
    parseResettableDatabaseUrl(databaseUrl)

  const client = new Client({ connectionString: maintenanceUrl })
  await client.connect()
  try {
    await client.query(
      `DROP DATABASE IF EXISTS ${quoteIdent(databaseName)} WITH (FORCE)`,
    )
    // Recreate owned by migrator, matching docker/db/init/00-roles.sh, so the
    // reset database has the same ownership as a freshly initialised volume.
    await client.query(
      `CREATE DATABASE ${quoteIdent(databaseName)} OWNER ${quoteIdent('migrator')}`,
    )
  } finally {
    await client.end()
  }

  console.log(`Reset database "${databaseName}": dropped and recreated empty.`)
  console.log('Next: pnpm db:migrate && pnpm db:seed (or pnpm db:fresh).')
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
