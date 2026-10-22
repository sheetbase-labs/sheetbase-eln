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
  'dataset_versions',
  'dataset_version_rows',
  'dataset_version_values',
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

  await probe('request_roles_unprivileged', async () => {
    const result = await sql(`SELECT count(*)::int AS n FROM pg_roles
      WHERE rolname IN ('authenticated','anon','api_client','authenticator','pipeline_sandbox')
        AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole`)
    return check('request_roles_unprivileged', result.rows[0]?.n === 5)
  })
  for (const table of [
    'records',
    'datasets',
    'dataset_versions',
    'file_objects',
    'projects',
    'revisions',
  ]) {
    await probe(`permissions_${table}`, async () => {
      const result = await sql(
        `SELECT
        pg_get_userbyid(relowner) = 'migrator' AS owned,
        has_table_privilege('authenticated', oid, 'SELECT') AS readable,
        has_table_privilege('anon', oid, 'SELECT') AS anonymous
        FROM pg_class WHERE oid = $1::regclass`,
        [`api.${table}`],
      )
      const row = result.rows.at(0)
      return check(
        `permissions_${table}`,
        row?.owned === true && row.readable === true && row.anonymous === false,
      )
    })
  }
  await probe('authenticator_membership', async () => {
    const result = await sql(`SELECT
      pg_has_role('authenticator','authenticated','MEMBER') AND
      NOT pg_has_role('authenticator','migrator','MEMBER') AND
      NOT pg_has_role('pipeline_sandbox','authenticated','MEMBER') AS ok`)
    return check('authenticator_membership', result.rows[0]?.ok === true)
  })

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
  sha256: string
}

export interface ObjectVerificationReport {
  ok: boolean
  checks: VerificationCheck[]
}

/**
 * Verifies restored file metadata against the object-storage archive: every
 * non-deleted `file_objects` row must have its bytes present in the archive
 * with a matching size and SHA-256. Orphaned archive entries do not
 * fail the drill (deleted rows legitimately leave no bytes behind).
 */
export function verifyObjectArchive(
  entries: ArchiveEntry[],
  fileRows: {
    storage_key: string
    byte_size: string | number
    status: string
    checksum: string | null
  }[],
): ObjectVerificationReport {
  const checks: VerificationCheck[] = []
  const byName = new Map(entries.map((e) => [e.name, e]))

  const active = fileRows.filter((r) => r.status === 'active')
  const missing: string[] = []
  const sizeMismatch: string[] = []
  const hashMismatch: string[] = []
  for (const row of active) {
    const expected = Number(row.byte_size)
    const actual = byName.get(row.storage_key)
    if (actual === undefined) {
      missing.push(row.storage_key)
    } else {
      if (actual.size !== expected) sizeMismatch.push(row.storage_key)
      if (!row.checksum || actual.sha256 !== row.checksum)
        hashMismatch.push(row.storage_key)
    }
  }
  checks.push(
    check(
      'object_checksums_match',
      hashMismatch.length === 0,
      hashMismatch.length
        ? `missing or mismatched sha256 on ${hashMismatch.length} objects`
        : undefined,
    ),
  )
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

/** Populated recovery proof through the real, non-owner PostgREST login.
 * All writes roll back. Missing representative actors are an evidence gap,
 * not a successful empty restore. Only call on a disposable replacement.
 */
export async function verifyRestoredAccess(admin: Client, request: Client) {
  const checks: VerificationCheck[] = []
  const witnesses = await admin.query<{
    id: string
    workspace_id: string
    owner_id: string
    viewer_id: string
    other_workspace: string
  }>(`SELECT r.id,r.workspace_id,p.lead_user_id AS owner_id,m.user_id AS viewer_id,
      other.id AS other_workspace
    FROM api.records r JOIN api.projects p ON p.id=r.project_id
    JOIN api.workspaces other ON other.id<>r.workspace_id
      AND NOT EXISTS (SELECT 1 FROM api.workspace_memberships om
        WHERE om.workspace_id=other.id AND om.user_id=p.lead_user_id)
    JOIN api.workspace_memberships m ON m.workspace_id=r.workspace_id AND m.role='viewer' AND m.suspended_at IS NULL
    JOIN api.project_access a ON a.project_id=p.id AND a.user_id=m.user_id AND a.can_view
    JOIN api.workspace_memberships owner ON owner.workspace_id=r.workspace_id AND owner.user_id=p.lead_user_id AND owner.role='owner' AND owner.suspended_at IS NULL
    WHERE r.deleted_at IS NULL
      AND (NOT (r.kind='experiment' AND r.status='draft') OR r.created_by_user_id=m.user_id)
    LIMIT 1`)
  const actor = witnesses.rows.at(0)
  if (!actor?.other_workspace)
    return {
      ok: false,
      checks: [
        check(
          'populated_access_witnesses',
          false,
          'need two workspaces, an owner-led record, and an explicitly authorised viewer',
        ),
      ],
    }
  const recordId = actor.id

  async function asActor(
    user: string,
    workspace: string,
    name: string,
    body: () => Promise<boolean>,
  ) {
    await request.query('BEGIN')
    try {
      await request.query('SET LOCAL ROLE authenticated')
      await request.query(`SELECT set_config('request.jwt.claims',$1,true)`, [
        JSON.stringify({
          role: 'authenticated',
          sub: user,
          workspace_id: workspace,
        }),
      ])
      checks.push(check(name, await body()))
    } catch (error) {
      checks.push(
        check(
          name,
          false,
          error instanceof Error ? error.message : String(error),
        ),
      )
    } finally {
      await request.query('ROLLBACK')
    }
  }
  async function readsRecord() {
    return (
      (
        await request.query('SELECT id FROM api.records WHERE id=$1', [
          recordId,
        ])
      ).rowCount === 1
    )
  }
  async function deniedWrite() {
    try {
      await request.query(`SELECT api.create_project('Restore denial probe')`)
      return false
    } catch (error) {
      return error instanceof Error && 'code' in error && error.code === '42501'
    }
  }
  async function deniedRecordWrite() {
    try {
      const updated = await request.query(
        'UPDATE api.records SET title=title WHERE id=$1 RETURNING id',
        [recordId],
      )
      return updated.rowCount === 0
    } catch (error) {
      return error instanceof Error && 'code' in error && error.code === '42501'
    }
  }
  await asActor(
    actor.owner_id,
    actor.workspace_id,
    'owner_read_write',
    async () => {
      if (!(await readsRecord())) return false
      const created = await request.query(
        `SELECT (api.create_project('Restore rollback probe')).id AS id`,
      )
      return typeof created.rows[0]?.id === 'string'
    },
  )
  await asActor(
    actor.viewer_id,
    actor.workspace_id,
    'viewer_read_write_denial',
    async () => (await readsRecord()) && (await deniedRecordWrite()),
  )
  await asActor(
    actor.owner_id,
    actor.other_workspace,
    'cross_workspace_denial',
    async () => !(await readsRecord()) && (await deniedWrite()),
  )
  return { ok: checks.every((item) => item.ok), checks }
}
