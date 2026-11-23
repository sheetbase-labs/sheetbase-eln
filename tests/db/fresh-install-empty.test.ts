import { expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

/**
 * A new install holds only what the product ships with: the built-in record
 * types, their fields, and the lists the app reads (events, pipeline actions).
 * No project, sample, experiment, report, registry entry or any other record
 * exists until someone makes it, and a brand-new workspace starts the same
 * way. Example data comes only from the demo seeds.
 */

/** Tables a new workspace may hold a row in straight after it is created. */
const WORKSPACE_OWN_ROWS = new Set([
  'workspaces',
  'workspace_memberships',
  'workspace_change_seq',
  'search_documents',
])

async function recordTables(
  migrator: Awaited<ReturnType<typeof prepareTestDatabase>>['migrator'],
): Promise<Array<string>> {
  const tables = await migrator.query<{ table_name: string }>(`
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'api'
       and c.column_name = 'workspace_id'
       and t.table_type = 'BASE TABLE'
     order by 1`)

  return tables.rows.map((row) => row.table_name)
}

async function populated(
  migrator: Awaited<ReturnType<typeof prepareTestDatabase>>['migrator'],
  tables: Array<string>,
): Promise<Array<string>> {
  const found: Array<string> = []

  for (const table of tables) {
    const count = await migrator.query<{ n: string }>(
      `select count(*) as n from (select 1 from api."${table}" limit 1) x`,
    )

    if (Number(count.rows[0]?.n) > 0) found.push(table)
  }

  return found
}

it('holds no records in a freshly migrated database or a brand-new workspace', async () => {
  const { migrator } = await prepareTestDatabase()

  try {
    await migrator.query('set row_security = off')

    const tables = await recordTables(migrator)

    expect(tables.length).toBeGreaterThan(50)
    expect(await populated(migrator, tables)).toEqual([])

    // The first sign-up: a person, their workspace and an owner membership.
    await migrator.query(
      `insert into internal."user" (id, name, email, "emailVerified")
       values ('00000000-0000-4000-8000-00000000fff1', 'New Owner', 'new.owner@example.com', true)`,
    )

    const workspace = await migrator.query<{ id: string }>(
      `insert into api.workspaces (slug, name) values ('ws-new-owner', 'New lab') returning id`,
    )

    await migrator.query(
      `insert into api.workspace_memberships (workspace_id, user_id, role)
       values ($1, '00000000-0000-4000-8000-00000000fff1', 'owner')`,
      [workspace.rows[0]?.id],
    )

    const found = (await populated(migrator, tables)).filter(
      (table) => !WORKSPACE_OWN_ROWS.has(table),
    )

    expect(found).toEqual([])
  } finally {
    await migrator.end()
  }
})
