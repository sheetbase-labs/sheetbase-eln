/**
 * PLAT-01 — restore-drill verification.
 *
 * A backup is only proven when a restored database is *usable Sheetbase
 * state*, not merely a file that exists. These checks run against a
 * disposable restored database and detect an unusable backup:
 *
 *   - the Drizzle migration journal is present and applied;
 *   - every core domain table exists in the `api` schema;
 *   - row-level security is enabled on the restored tables;
 *   - the core domain RPC surface is present;
 *   - row counts for the primary domain surfaces are reported;
 *   - restored `file_objects` metadata matches the object archive contents.
 *
 * Run by `pnpm backup:restore-drill` against a disposable PostgreSQL
 * container. Never run against the active development or production
 * database.
 */
import type { Client } from 'pg'

export const CORE_TABLES = [
  'workspaces',
  'workspace_memberships',
  'projects',
  'records',
  'file_objects',
  'revisions',
  'datasets',
  'dataset_rows',
  'dataset_row_values',
  'change_events',
  'sheet_instances',
  'notebook_templates',
  'connectors',
  'connector_runs',
] as const

export const CORE_RPCS = [
  'create_project',
  'validate_dataset_row_batch',
  'commit_dataset_row_batch',
  'start_connector_run',
  'complete_connector_run',
  'fail_connector_run',
] as const

export interface VerificationCheck {
  name: string
  ok: boolean
  detail?: string
}

export interface DatabaseVerificationReport {
  ok: boolean
  checks: VerificationCheck[]
  counts: Record<string, number>
}

type SqlRow = Record<string, unknown>
type SqlFn = (sql: string, params?: unknown[]) => Promise<{ rows: SqlRow[] }>

function check(name: string, ok: boolean, detail?: string): VerificationCheck {
  return ok ? { name, ok } : { name, ok, detail }
}

/** Runs every database-level check against the restored database. */
export async function verifyRestoredDatabase(
  sql: SqlFn,
): Promise<DatabaseVerificationReport> {
  const checks: VerificationCheck[] = []
  const counts: Record<string, number> = {}

  // Every probe is failure-tolerant: an unusable backup can make a query
  // throw (missing schema/table), and that must surface as a failed check,
  // not as an unhandled crash of the drill.
  const probe = async (
    name: string,
    run: () => Promise<VerificationCheck | void>,
  ): Promise<void> => {
    try {
      const result = await run()
      checks.push(result ?? check(name, true))
    } catch (error) {
      checks.push(
        check(
          name,
          false,
          error instanceof Error ? error.message : String(error),
        ),
      )
    }
  }

  // Migration journal: a restored database without applied migrations cannot
  // serve the application even if the tables happen to exist.
  await probe('migrations_applied', async () => {
    const migrations = await sql(
      'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
    )
    const migrationCount = Number(migrations.rows[0]?.n ?? 0)
    return check(
      'migrations_applied',
      migrationCount > 0,
      `count=${migrationCount}`,
    )
  })

  // Core domain tables exist.
  for (const table of CORE_TABLES) {
    await probe(`table_${table}`, async () => {
      const result = await sql('SELECT to_regclass($1) AS reg', [
        `api.${table}`,
      ])
      return check(`table_${table}`, result.rows[0]?.reg !== null)
    })
  }

  // Row-level security enabled on every core table (the isolation boundary
  // is part of usable state, not optional metadata).
  for (const table of CORE_TABLES) {
    await probe(`rls_${table}`, async () => {
      const result = await sql(
        `SELECT c.relrowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'api' AND c.relname = $1`,
        [table],
      )
      const guarded = result.rows[0]?.relrowsecurity === true
      return check(
        `rls_${table}`,
        guarded,
        guarded ? undefined : 'RLS not enabled',
      )
    })
  }

  // Core RPC surface present.
  for (const rpc of CORE_RPCS) {
    await probe(`rpc_${rpc}`, async () => {
      const result = await sql(
        `SELECT count(*)::int AS n
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'api' AND p.proname = $1`,
        [rpc],
      )
      return check(`rpc_${rpc}`, Number(result.rows[0]?.n ?? 0) > 0)
    })
  }

  // Row counts for the primary domain surfaces. Counts are reported, not
  // asserted above zero: a legitimately empty deployment restores fine.
  for (const table of [
    'workspaces',
    'datasets',
    'dataset_rows',
    'file_objects',
    'connector_runs',
  ]) {
    await probe(`count_${table}`, async () => {
      const result = await sql(`SELECT count(*)::int AS n FROM api.${table}`)
      counts[table] = Number(result.rows[0]?.n ?? 0)
    })
  }

  return { ok: checks.every((c) => c.ok), checks, counts }
}

export interface ArchiveEntry {
  name: string
  size: number
}

export interface ObjectVerificationReport {
  ok: boolean
  checks: VerificationCheck[]
}

/**
 * Verifies restored file metadata against the object-storage archive: every
 * non-deleted `file_objects` row must have its bytes present in the archive
 * with a matching size. Orphaned archive entries are reported but do not
 * fail the drill (deleted rows legitimately leave no bytes behind).
 */
export function verifyObjectArchive(
  entries: ArchiveEntry[],
  fileRows: {
    storage_key: string
    byte_size: string | number
    status: string
  }[],
): ObjectVerificationReport {
  const checks: VerificationCheck[] = []
  const byName = new Map(entries.map((e) => [e.name, e.size]))

  const active = fileRows.filter((r) => r.status === 'active')
  const missing: string[] = []
  const sizeMismatch: string[] = []
  for (const row of active) {
    const expected = Number(row.byte_size)
    const actual = byName.get(row.storage_key)
    if (actual === undefined) {
      missing.push(row.storage_key)
    } else if (actual !== expected) {
      sizeMismatch.push(row.storage_key)
    }
  }
  checks.push(
    check(
      'object_bytes_present',
      missing.length === 0,
      missing.length > 0 ? `missing ${missing.length} objects` : undefined,
    ),
  )
  checks.push(
    check(
      'object_sizes_match',
      sizeMismatch.length === 0,
      sizeMismatch.length > 0
        ? `size mismatch on ${sizeMismatch.length} objects`
        : undefined,
    ),
  )
  checks.push(
    check(
      'object_metadata_present',
      fileRows.length > 0 ? entries.length > 0 : true,
      fileRows.length > 0 && entries.length === 0
        ? 'file metadata exists but the archive is empty'
        : undefined,
    ),
  )
  return { ok: checks.every((c) => c.ok), checks }
}

/** Convenience: run the verification against an open pg client. */
export async function verifyRestoredDatabaseWithClient(
  client: Client,
): Promise<DatabaseVerificationReport> {
  return verifyRestoredDatabase((text, values) => client.query(text, values))
}
