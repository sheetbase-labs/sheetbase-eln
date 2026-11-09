/**
 * Every event the trigger picker offers is accepted by the database when a
 * schedule is saved (api.normalize_pipeline_event_type), so a trigger that can
 * be picked can be saved.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { PIPELINE_TRIGGER_EVENTS } from '../../src/lib/pipeline-schedule'
import { prepareTestDatabase } from './helpers'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
})

afterAll(async () => {
  await migrator?.end()
})

it('accepts every event the trigger picker offers', async () => {
  const rejected: string[] = []
  for (const name of PIPELINE_TRIGGER_EVENTS) {
    try {
      const { rows } = await migrator.query(
        `select api.normalize_pipeline_event_type($1) as name`,
        [name],
      )
      if (rows[0].name !== name) rejected.push(name)
    } catch {
      rejected.push(name)
    }
  }
  expect(rejected).toEqual([])
})
