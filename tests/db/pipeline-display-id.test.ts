/**
 * AUTO — pipeline definitions get a stable per-workspace PL-nnnn display id.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000110a'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'plid-ws', 'PL id WS')`,
  )
})

afterAll(async () => {
  await migrator.end()
})

async function insertPipeline(key: string, displayId: string | null) {
  const { rows } = await migrator.query<{ display_id: string }>(
    `INSERT INTO api.pipeline_definitions (workspace_id, key, name, display_id)
     VALUES ($1, $2, $3, $4) RETURNING display_id`,
    [WS, key, key, displayId],
  )
  return rows[0]!.display_id
}

describe('pipeline display id', () => {
  it('assigns sequential PL-nnnn ids and keeps an explicit one', async () => {
    expect(await insertPipeline('first', null)).toBe('PL-0001')
    expect(await insertPipeline('second', null)).toBe('PL-0002')
    expect(await insertPipeline('design', 'PL-0014')).toBe('PL-0014')
  })
})
