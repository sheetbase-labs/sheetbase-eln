/**
 * DATA-23 — a dataset linked from the notebook is a link on its experiment.
 *
 * The `/linked` block keeps the dataset in its payload; a trigger writes the
 * `dataset` row in `record_links` that the Links tab, "Used by" and results
 * read, by the dataset's display id and with no target record.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000023a0'
const OTHER_WS = '00000000-0000-4000-8000-0000000023a9'
const PROJECT = '00000000-0000-4000-8000-0000000023a1'
const EXP = '00000000-0000-4000-8000-0000000023a2'
const DEF = '00000000-0000-4000-8000-0000000023a3'
const VERSION = '00000000-0000-4000-8000-0000000023a4'
const DATASET = '00000000-0000-4000-8000-0000000023a5'
const FOREIGN_DATASET = '00000000-0000-4000-8000-0000000023a6'
const USER = 'data23-user'

let migrator: Client
let order = 0

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
    [USER, `${USER}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'data23','DATA-23'),($2,'data23x','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title) values($1,$2,'D23','Links')`,
    [PROJECT, WS],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-D23','Uses a dataset','in_progress',$4)`,
    [EXP, WS, PROJECT, USER],
  )
  await migrator.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name,lifecycle) values($1,$2,'a','A','active')`,
    [DEF, WS],
  )
  await migrator.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle) values($1,$2,1,'draft')`,
    [VERSION, DEF],
  )
  await migrator.query(
    `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,display_order)
     values($1,gen_random_uuid(),'k','k','text',true,1)`,
    [VERSION],
  )
  await migrator.query(
    `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
    [VERSION],
  )
  await migrator.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name,display_id) values($1,$2,$3,'Plate reads','DS-9301')`,
    [DATASET, WS, VERSION],
  )
})

afterAll(async () => {
  await migrator?.end()
})

async function block(payload: Record<string, unknown>) {
  order += 1
  const { rows } = await migrator.query<{ id: string }>(
    `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
     values($1,'linked_record',$2::jsonb,$3,$4) returning id`,
    [EXP, JSON.stringify(payload), order, USER],
  )
  return rows[0]!.id
}

async function datasetLinks() {
  const { rows } = await migrator.query<{
    target_identifier: string
    target_kind: string
    target_record_id: string | null
  }>(
    `select target_identifier, target_kind, target_record_id from api.record_links
      where source_record_id = $1 and link_type = 'dataset' order by target_identifier`,
    [EXP],
  )
  return rows
}

describe('a dataset block writes the dataset link', () => {
  it('links by the picked dataset id, under its display id', async () => {
    await block({
      targetKind: 'dataset',
      targetIdentifier: 'DS-9301',
      targetId: DATASET,
      linkType: 'dataset',
    })
    expect(await datasetLinks()).toEqual([
      {
        target_identifier: 'DS-9301',
        target_kind: 'dataset',
        target_record_id: null,
      },
    ])
  })

  it('a second block for the same dataset does not duplicate the link', async () => {
    await block({ targetKind: 'dataset', targetIdentifier: 'DS-9301' })
    expect(await datasetLinks()).toHaveLength(1)
  })

  it('links a typed display id when it names a dataset in the workspace', async () => {
    await migrator.query(
      `delete from api.record_links where source_record_id=$1`,
      [EXP],
    )
    await block({ targetKind: 'dataset', targetIdentifier: 'DS-9301' })
    expect(await datasetLinks()).toHaveLength(1)
  })

  it('links when an existing block is edited to point at the dataset', async () => {
    await migrator.query(
      `delete from api.record_links where source_record_id=$1`,
      [EXP],
    )
    const id = await block({ targetKind: 'dataset', targetIdentifier: '' })
    expect(await datasetLinks()).toHaveLength(0)
    await migrator.query(
      `update api.blocks set payload = payload || $2::jsonb where id=$1`,
      [id, JSON.stringify({ targetIdentifier: 'DS-9301', targetId: DATASET })],
    )
    expect(await datasetLinks()).toHaveLength(1)
  })

  it('ignores a typed id that matches no dataset, and other kinds', async () => {
    await migrator.query(
      `delete from api.record_links where source_record_id=$1`,
      [EXP],
    )
    await block({ targetKind: 'dataset', targetIdentifier: 'DS-0000' })
    await block({ targetKind: 'experiment', targetIdentifier: 'DS-9301' })
    expect(await datasetLinks()).toHaveLength(0)
  })

  it('never links a dataset from another workspace', async () => {
    await migrator
      .query(
        `insert into api.datasets(id,workspace_id,schema_version_id,name,display_id) values($1,$2,$3,'Foreign','DS-9302')`,
        [FOREIGN_DATASET, OTHER_WS, VERSION],
      )
      .catch(() => undefined)
    await block({
      targetKind: 'dataset',
      targetIdentifier: 'DS-9302',
      targetId: FOREIGN_DATASET,
    })
    expect(await datasetLinks()).toHaveLength(0)
  })

  it('does not fail the save when the payload id is not a uuid', async () => {
    await block({
      targetKind: 'dataset',
      targetIdentifier: 'DS-9301',
      targetId: 'nope',
    })
    expect(await datasetLinks()).toHaveLength(1)
  })
})
