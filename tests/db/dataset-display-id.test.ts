/**
 * DSET — datasets get a stable per-workspace DS-nnnn display id, assigned on
 * insert and immutable afterwards.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000100a'
const SCHEMA_DEF = '00000000-0000-4000-8000-00000000100b'
const SCHEMA_VERSION = '00000000-0000-4000-8000-00000000100c'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'dsid-ws', 'DS id WS')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle) VALUES ('${SCHEMA_DEF}', '${WS}', 'dsid_schema', 'Display id schema', 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle) VALUES ('${SCHEMA_VERSION}', '${SCHEMA_DEF}', 1, 'draft')`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active', published_at = now() WHERE id = '${SCHEMA_VERSION}'`,
  )
})

afterAll(async () => {
  await migrator.end()
})

async function insertDataset(
  name: string,
  displayId: string | null,
): Promise<string> {
  const { rows } = await migrator.query<{ display_id: string }>(
    `INSERT INTO api.datasets (workspace_id, schema_version_id, name, display_id)
     VALUES ($1, $2, $3, $4) RETURNING display_id`,
    [WS, SCHEMA_VERSION, name, displayId],
  )
  return rows[0]!.display_id
}

describe('dataset display id', () => {
  it('assigns sequential DS-nnnn ids on insert', async () => {
    expect(await insertDataset('First', null)).toBe('DS-0001')
    expect(await insertDataset('Second', null)).toBe('DS-0002')
  })

  it('keeps an explicit design id', async () => {
    expect(await insertDataset('Design', 'DS-0298')).toBe('DS-0298')
  })

  it('is immutable', async () => {
    const id = await insertDataset('Immutable', null)
    await expect(
      migrator.query(
        `UPDATE api.datasets SET display_id = 'DS-9999' WHERE display_id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
  })
})
