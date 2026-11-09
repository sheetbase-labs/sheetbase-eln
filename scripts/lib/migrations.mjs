/**
 * The migration list and the runner that applies it.
 *
 * Migrations 0000 to 0108 are the numbered history, listed in the frozen
 * `drizzle/meta/_journal.json`. Every migration after that is a plain
 * `drizzle/<YYYYMMDDHHMMSS>_<name>.sql` file with no journal entry, so two
 * branches that each add one never touch the same line and never need
 * renumbering. Order is by file name.
 *
 * Applied migrations are recognised by the hash of their SQL, as Drizzle
 * records it in `drizzle.__drizzle_migrations`, so an existing database
 * carries on from where it is and nothing is run twice. A migration that
 * merged late (an older timestamp than one already applied) still runs.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** First moment a timestamp-named migration may carry (2026-11-06T00:00:00Z). */
export const TIMESTAMP_EPOCH_MS = Date.UTC(2026, 10, 6)

export const TIMESTAMP_NAME = /^(\d{14})_([a-z0-9][a-z0-9_]*)\.sql$/

/** `20261106230800` to milliseconds since the Unix epoch. */
export function timestampMs(stamp) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp)

  if (!m) throw new Error(`Not a migration timestamp: ${stamp}`)
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number)

  return Date.UTC(year, month - 1, day, hour, minute, second)
}

/**
 * Every migration in order, each with the `when` the ledger records. Numbered
 * migrations keep the value in the journal. A timestamped one gets a value
 * above every numbered one that still rises with its timestamp, so
 * "the newest applied `when`" keeps meaning "the newest migration" for
 * diagnostics, health checks and the upgrade backup.
 */
export function listMigrations(folder = 'drizzle') {
  const journal = JSON.parse(
    readFileSync(join(folder, 'meta/_journal.json'), 'utf8'),
  )

  const ceiling = Math.max(...journal.entries.map((e) => e.when))

  const migrations = journal.entries.map((entry) => ({
    tag: entry.tag,
    when: entry.when,
  }))

  const names = readdirSync(folder)
    .filter((name) => TIMESTAMP_NAME.test(name))
    .sort()

  for (const name of names) {
    const ms = timestampMs(name.slice(0, 14))

    if (ms < TIMESTAMP_EPOCH_MS) {
      throw new Error(
        `${name}: timestamp is before the first timestamped migration`,
      )
    }

    migrations.push({
      tag: name.replace(/\.sql$/, ''),
      when: ceiling + (ms - TIMESTAMP_EPOCH_MS) + 1,
    })
  }

  return migrations
}

/** The list with each migration's SQL statements and the hash Drizzle records. */
export function readMigrations(folder = 'drizzle') {
  return listMigrations(folder).map((migration) => {
    const sql = readFileSync(join(folder, `${migration.tag}.sql`), 'utf8')

    return {
      ...migration,
      hash: createHash('sha256').update(sql).digest('hex'),
      statements: sql.split('--> statement-breakpoint'),
    }
  })
}

/** The same list in the journal's shape, for code that wants tags and `when`. */
export function readJournal(folder = 'drizzle') {
  return {
    entries: listMigrations(folder).map(({ tag, when }, idx) => ({
      idx,
      version: '7',
      when,
      tag,
      breakpoints: true,
    })),
  }
}

/**
 * Apply what the database has not seen, all in one transaction (a failure
 * rolls the whole run back). Returns the tags it applied.
 */
export async function applyMigrations(client, folder = 'drizzle') {
  const migrations = readMigrations(folder)
  await client.query('CREATE SCHEMA IF NOT EXISTS drizzle')
  await client.query(
    `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
       id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  )

  const seen = new Set(
    (
      await client.query('SELECT hash FROM drizzle.__drizzle_migrations')
    ).rows.map((row) => row.hash),
  )

  const applied = []
  await client.query('BEGIN')

  try {
    for (const migration of migrations) {
      if (seen.has(migration.hash)) continue

      for (const statement of migration.statements) {
        await client.query(statement)
      }

      await client.query(
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
        [migration.hash, migration.when],
      )
      applied.push(migration.tag)
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }

  return applied
}
