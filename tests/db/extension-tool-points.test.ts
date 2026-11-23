/**
 * The plugin points a manifest may declare are listed in
 * `src/lib/extensions/points.ts` and again in the database check
 * `internal.validate_extension_runner_points`. A point on one side only is
 * either silently ignored by the database or refused by the page. This reads
 * the list out of the function as installed and compares.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { EXTENSION_RUNNER_POINTS } from '#/lib/extensions/points'
import { prepareTestDatabase } from './helpers'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
})

afterAll(async () => {
  await migrator.end()
})

it('checks exactly the runner points the page lists', async () => {
  const { rows } = await migrator.query<{ def: string }>(
    `select pg_get_functiondef('internal.validate_extension_runner_points(jsonb)'::regprocedure) as def`,
  )
  const match =
    /FOREACH\s+v_point\s+IN\s+ARRAY\s+ARRAY\[([\s\S]*?)\]\s*LOOP/i.exec(
      rows[0].def,
    )

  expect(
    match,
    'internal.validate_extension_runner_points no longer loops over a point list the test can read',
  ).not.toBeNull()

  const inDatabase = [...match![1].matchAll(/'([a-z-]+)'/g)]
    .map((found) => found[1])
    .sort()
  const onPage = [...EXTENSION_RUNNER_POINTS].sort()

  expect(
    inDatabase,
    'the plugin points in internal.validate_extension_runner_points and EXTENSION_RUNNER_POINTS (src/lib/extensions/points.ts) differ',
  ).toEqual(onPage)
})
