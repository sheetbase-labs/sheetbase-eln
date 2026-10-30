/**
 * Which rows belong to a workspace, worked out from the database's own
 * catalog so a new table is exported the day it is created.
 *
 * A table that has a `workspace_id` column is filtered by it. A table without
 * one (a notebook's blocks, a dataset version's rows) belongs to the workspace
 * through a foreign key to a table that does, so it is filtered through that
 * parent. Anything that cannot be tied to one workspace is left out and named
 * in the archive's manifest instead of guessed at.
 *
 * Pure: catalog in, plan out. The reader that runs the plan is in
 * `archive.server.ts`.
 */

export interface CatalogTable {
  schema: string
  name: string
  columns: string[]
}

export interface CatalogForeignKey {
  schema: string
  table: string
  /** The linking columns; more than one for a composite key. */
  columns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
}

export interface ExportTablePlan {
  /** `schema.table`, also the file name inside the archive. */
  name: string
  schema: string
  table: string
  /** Columns written, in catalog order. */
  columns: string[]
  /** Columns left out because they hold a secret. */
  droppedColumns: string[]
  /** SQL condition on the table aliased as `t`. */
  where: string
}

export interface ExportPlan {
  tables: ExportTablePlan[]
  /** Tables left out, with why. */
  skipped: { name: string; reason: string }[]
}

/** Tables that hold credentials, sign-in state or files' raw storage pieces. */
const NEVER_EXPORTED: Record<string, string> = {
  'internal.account': 'sign-in credentials',
  'internal.session': 'sign-in sessions',
  'internal.verification': 'sign-in verification codes',
  'internal.twoFactor': 'two-factor secrets',
  'internal.signature_password_attempts': 'sign-in throttling',
  'internal.connector_secrets': 'secrets',
  'internal.webhook_secrets': 'secrets',
  'internal.parser_webhook_secrets': 'secrets',
  'internal.file_blobs': 'stored under files/ instead',
  'internal.file_blob_chunks': 'stored under files/ instead',
  'internal.workspace_backups': 'a record of backups, not workspace data',
}

/**
 * Columns dropped wherever they appear: hashes and ciphertext of secrets. The
 * rest of the row (who, when, which scopes) is kept.
 */
export const SECRET_COLUMNS: ReadonlySet<string> = new Set([
  'secret',
  'secret_hash',
  'token',
  'token_hash',
  'ciphertext',
  'password',
])

/** What is kept of the account table: who people are, never how they sign in. */
const USER_COLUMNS = ['id', 'name', 'email', 'image', 'createdAt'] as const

const USER_TABLE = 'internal.user'
const WORKSPACE_TABLE = 'api.workspaces'

const identifier = (name: string) => `"${name.replace(/"/g, '""')}"`
const qualified = (schema: string, table: string) =>
  `${identifier(schema)}.${identifier(table)}`

/** Workspace ids are interpolated into SQL, so only a real UUID is accepted. */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function buildExportPlan(
  workspaceId: string,
  tables: CatalogTable[],
  foreignKeys: CatalogForeignKey[],
): ExportPlan {
  if (!UUID_PATTERN.test(workspaceId)) throw new Error('invalid workspace id')
  const skipped: ExportPlan['skipped'] = []

  // Conditions are built up in passes: a table is scoped once one of its
  // parents is. `scope` maps a table to a condition written against alias `t`.
  const scope = new Map<string, string>()
  for (const table of tables) {
    const name = `${table.schema}.${table.name}`
    if (NEVER_EXPORTED[name]) continue
    if (name === WORKSPACE_TABLE) {
      scope.set(name, `t.id = '${workspaceId}'`)
    } else if (name === USER_TABLE) {
      scope.set(
        name,
        `t.id IN (SELECT m.user_id FROM ${qualified('api', 'workspace_memberships')} m WHERE m.workspace_id = '${workspaceId}')`,
      )
    } else if (table.columns.includes('workspace_id')) {
      scope.set(name, `t.workspace_id = '${workspaceId}'`)
    }
  }

  let counter = 0
  let progressed = true
  while (progressed) {
    progressed = false
    for (const table of tables) {
      const name = `${table.schema}.${table.name}`
      if (scope.has(name) || NEVER_EXPORTED[name]) continue
      const parents = foreignKeys.filter(
        (fk) =>
          fk.schema === table.schema &&
          fk.table === table.name &&
          scope.has(`${fk.refSchema}.${fk.refTable}`) &&
          // People belong to many workspaces, so a row that merely points at a
          // person is not thereby in this one.
          `${fk.refSchema}.${fk.refTable}` !== USER_TABLE,
      )
      if (parents.length === 0) continue
      // Every parent a row can have places it in the workspace; a nullable
      // link alone would drop rows where it is empty, so all links are OR'd.
      const conditions = parents.map((fk) => {
        const alias = `p${counter++}`
        const parentName = `${fk.refSchema}.${fk.refTable}`
        const parentScope = scope.get(parentName) ?? 'false'
        const own = fk.columns.map((c) => `t.${identifier(c)}`).join(', ')
        const theirs = fk.refColumns
          .map((c) => `${alias}.${identifier(c)}`)
          .join(', ')
        return `(${own}) IN (SELECT ${theirs} FROM ${qualified(fk.refSchema, fk.refTable)} ${alias} WHERE ${rebase(parentScope, alias)})`
      })
      scope.set(
        name,
        conditions.length === 1
          ? conditions[0]
          : `(${conditions.join(' OR ')})`,
      )
      progressed = true
    }
  }

  const planned: ExportTablePlan[] = []
  for (const table of tables) {
    const name = `${table.schema}.${table.name}`
    if (NEVER_EXPORTED[name]) {
      skipped.push({ name, reason: NEVER_EXPORTED[name] })
      continue
    }
    const where = scope.get(name)
    if (!where) {
      skipped.push({
        name,
        reason: 'not tied to this workspace (shared data or personal settings)',
      })
      continue
    }
    const wanted =
      name === USER_TABLE
        ? table.columns.filter((c) =>
            (USER_COLUMNS as readonly string[]).includes(c),
          )
        : table.columns.filter((c) => !SECRET_COLUMNS.has(c))
    const droppedColumns =
      name === USER_TABLE
        ? table.columns.filter((c) => !wanted.includes(c))
        : table.columns.filter((c) => SECRET_COLUMNS.has(c))
    planned.push({
      name,
      schema: table.schema,
      table: table.name,
      columns: wanted,
      droppedColumns,
      where,
    })
  }
  planned.sort((a, b) => a.name.localeCompare(b.name))
  skipped.sort((a, b) => a.name.localeCompare(b.name))
  return { tables: planned, skipped }
}

/** Re-aims a condition written against alias `t` at another alias. */
function rebase(condition: string, alias: string): string {
  // Only the outermost `t.` references belong to this level: nested
  // subqueries already use their own `p<n>` aliases.
  return condition.replace(/\bt\./g, `${alias}.`)
}

/** The SELECT that reads one planned table as one JSON document per row. */
export function selectForTable(plan: ExportTablePlan): string {
  const dropped = plan.droppedColumns.length
    ? ` - ARRAY[${plan.droppedColumns.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ')}]::text[]`
    : ''
  return `SELECT (to_jsonb(t)${dropped})::text AS row FROM ${qualified(plan.schema, plan.table)} t WHERE ${plan.where}`
}
