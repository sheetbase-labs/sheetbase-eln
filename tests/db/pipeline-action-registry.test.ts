/**
 * A pipeline step may only run an action the database lists in
 * `internal.pipeline_actions`. The same actions are declared once in
 * TypeScript (`PIPELINE_ACTIONS`), so each feature's migration has to insert a
 * matching row. A missing row means the action shows in the editor and the
 * API but a saved pipeline using it is refused; a stale row means the database
 * accepts arguments the app no longer sends.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PIPELINE_ACTIONS } from '#/lib/pipelines/actions'

import { prepareTestDatabase } from './helpers'

let migrator: Client
const stored = new Set<string>()
const matching = new Set<string>()

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())

  const rows = await migrator.query<{ operation: string }>(
    'select operation from internal.pipeline_actions',
  )

  for (const row of rows.rows) stored.add(row.operation)

  // jsonb equality ignores key order, so the database does the comparing.
  const same = await migrator.query<{ operation: string }>(
    `select a.operation
       from internal.pipeline_actions a
       join jsonb_array_elements($1::jsonb) as declared(definition)
         on declared.definition->>'operation' = a.operation
      where a.definition = declared.definition`,
    [JSON.stringify(PIPELINE_ACTIONS)],
  )

  for (const row of same.rows) matching.add(row.operation)
})

afterAll(async () => {
  await migrator.end()
})

/** The row a migration has to hold for an action, as the app declares it. */
function expectedRow(operation: string): string {
  const action = PIPELINE_ACTIONS.find((item) => item.operation === operation)

  return (
    `INSERT INTO internal.pipeline_actions (operation, definition) VALUES\n` +
    `  ('${operation}', '${JSON.stringify(action).replaceAll("'", "''")}'::jsonb)\n` +
    `ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;`
  )
}

describe('internal.pipeline_actions', () => {
  it('has a row for every action the app declares', () => {
    const missing = PIPELINE_ACTIONS.filter(
      (action) => !stored.has(action.operation),
    ).map((action) => action.operation)

    expect(
      missing,
      `Add a migration (pnpm db:new) with:\n\n${missing.map(expectedRow).join('\n\n')}\n`,
    ).toEqual([])
  })

  it('holds each action as the app declares it', () => {
    const drifted = PIPELINE_ACTIONS.filter(
      (action) =>
        stored.has(action.operation) && !matching.has(action.operation),
    ).map((action) => action.operation)

    expect(
      drifted,
      `Update the rows in a new migration (pnpm db:new):\n\n${drifted.map(expectedRow).join('\n\n')}\n`,
    ).toEqual([])
  })

  it('has no row for an action the app no longer declares', () => {
    const declared = new Set(PIPELINE_ACTIONS.map((action) => action.operation))
    const stale = [...stored].filter((operation) => !declared.has(operation))

    expect(
      stale,
      'Delete these rows in a new migration (pnpm db:new): DELETE FROM internal.pipeline_actions WHERE operation IN (…)',
    ).toEqual([])
  })
})
