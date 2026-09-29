/**
 * DSYS-05.4 — models and notebook templates get stable per-workspace
 * MDL-nnnn / TPL-nnnn display ids, assigned on insert and immutable afterwards.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000110a'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'mtid-ws', 'MT id WS')`,
  )
})

afterAll(async () => {
  await migrator.end()
})

async function insertModel(key: string, displayId: string | null) {
  const { rows } = await migrator.query<{ display_id: string }>(
    `INSERT INTO api.dataset_schema_definitions (workspace_id, key, name, lifecycle, display_id)
     VALUES ($1, $2, $3, 'draft', $4) RETURNING display_id`,
    [WS, key, `Model ${key}`, displayId],
  )
  return rows[0]!.display_id
}

async function insertTemplate(key: string, displayId: string | null) {
  const { rows } = await migrator.query<{ display_id: string }>(
    `INSERT INTO api.notebook_templates (workspace_id, key, name, lifecycle, display_id)
     VALUES ($1, $2, $3, 'active', $4) RETURNING display_id`,
    [WS, key, `Template ${key}`, displayId],
  )
  return rows[0]!.display_id
}

describe('model display id', () => {
  it('assigns sequential MDL-nnnn ids on insert', async () => {
    expect(await insertModel('m_one', null)).toBe('MDL-0001')
    expect(await insertModel('m_two', null)).toBe('MDL-0002')
  })

  it('keeps an explicit design id', async () => {
    expect(await insertModel('m_design', 'MDL-0012')).toBe('MDL-0012')
  })

  it('is immutable', async () => {
    const id = await insertModel('m_immutable', null)
    await expect(
      migrator.query(
        `UPDATE api.dataset_schema_definitions SET display_id = 'MDL-9999' WHERE display_id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
  })
})

describe('template display id', () => {
  it('assigns sequential TPL-nnnn ids on insert', async () => {
    expect(await insertTemplate('t_one', null)).toBe('TPL-0001')
    expect(await insertTemplate('t_two', null)).toBe('TPL-0002')
  })

  it('is immutable', async () => {
    const id = await insertTemplate('t_immutable', null)
    await expect(
      migrator.query(
        `UPDATE api.notebook_templates SET display_id = 'TPL-9999' WHERE display_id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
  })
})
