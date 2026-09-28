/**
 * LAB-06 — instruments get a stable per-workspace INS-nnnn display id.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000140a'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'insid-ws', 'INS id WS')`,
  )
})

afterAll(async () => {
  await migrator.end()
})

async function insertInstrument(name: string, displayId: string | null) {
  const { rows } = await migrator.query<{ display_id: string }>(
    `INSERT INTO api.instruments (workspace_id, name, display_id)
     VALUES ($1, $2, $3) RETURNING display_id`,
    [WS, name, displayId],
  )
  return rows[0]!.display_id
}

describe('instrument display id', () => {
  it('assigns sequential INS-nnnn ids and keeps an explicit one', async () => {
    expect(await insertInstrument('First', null)).toBe('INS-0001')
    expect(await insertInstrument('Second', null)).toBe('INS-0002')
    expect(await insertInstrument('Design', 'INS-0007')).toBe('INS-0007')
  })
})
