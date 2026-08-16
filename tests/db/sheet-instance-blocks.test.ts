import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '06200000-0000-4000-8000-000000000001'
const OTHER_WS = '06200000-0000-4000-8000-000000000002'
const PROJECT = '06200000-0000-4000-8000-000000000003'
const OTHER_PROJECT = '06200000-0000-4000-8000-000000000004'
const RECORD_A = '06200000-0000-4000-8000-000000000005'
const RECORD_B = '06200000-0000-4000-8000-000000000006'
const OWNER = 'core-062-owner'
const OTHER = 'core-062-other'

let migrator: Client
let auth: Client
let otherAuth: Client

async function authenticated(
  prepared: Awaited<ReturnType<typeof prepareTestDatabase>>,
  user: string,
  workspace: string,
): Promise<Client> {
  const client = await prepared.asRole('authenticator')
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: user,
      workspace_id: workspace,
    }),
  ])
  return client
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ($1,'CORE-06.2 owner','core-062-owner@test.invalid',true),
      ($2,'CORE-06.2 other','core-062-other@test.invalid',true)`,
    [OWNER, OTHER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ('${WS}','core-062','CORE-06.2'),
      ('${OTHER_WS}','core-062-other','CORE-06.2 other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ('${WS}',$1,'owner'),('${OTHER_WS}',$2,'owner')`,
    [OWNER, OTHER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ('${PROJECT}','${WS}','C62','CORE-06.2'),
      ('${OTHER_PROJECT}','${OTHER_WS}','C62O','CORE-06.2 other')`,
  )
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     VALUES
       ('${RECORD_A}','${WS}','${PROJECT}','experiment','C62-A','Notebook A',$1),
       ('${RECORD_B}','${WS}','${PROJECT}','experiment','C62-B','Notebook B',$1)`,
    [OWNER],
  )
  auth = await authenticated(prepared, OWNER, WS)
  otherAuth = await authenticated(prepared, OTHER, OTHER_WS)
})

afterAll(async () => {
  await Promise.all([migrator?.end(), auth?.end(), otherAuth?.end()])
})

describe('CORE-06.2 canonical Notebook Sheet Instance blocks', () => {
  it('creates independent Instances, embeds an existing one, and keeps lifecycle on delete', async () => {
    const first = (
      await auth.query(
        `SELECT api.insert_sheet_instance_block($1,NULL,$2,NULL) result`,
        [RECORD_A, 1],
      )
    ).rows[0].result
    const instanceA = first.instance.id as string
    const blockA = first.block.id as string
    expect(first.block.payload).toEqual({ instanceId: instanceA })
    expect(first.structure_version).toBe(2)
    expect(first.instance.notebook_record_id).toBe(RECORD_A)

    const second = (
      await auth.query(
        `SELECT api.insert_sheet_instance_block($1,NULL,$2,NULL) result`,
        [RECORD_A, 2],
      )
    ).rows[0].result
    const instanceB = second.instance.id as string
    expect(instanceB).not.toBe(instanceA)
    expect(second.block.payload.instanceId).toBe(instanceB)

    const shared = (
      await auth.query(
        `SELECT api.insert_sheet_instance_block($1,NULL,$2,$3) result`,
        [RECORD_B, 1, instanceA],
      )
    ).rows[0].result
    expect(shared.instance.id).toBe(instanceA)
    expect(shared.block.payload.instanceId).toBe(instanceA)
    expect(shared.block.record_id).toBe(RECORD_B)

    const moved = (
      await auth.query(
        `SELECT api.move_block($1,$2,NULL,NULL) result`,
        [second.block.id, 3],
      )
    ).rows[0].result
    expect(moved.block.payload.instanceId).toBe(instanceB)

    await auth.query(`SELECT api.delete_block($1,$2)`, [blockA, 4])
    const remaining = (
      await auth.query(
        `SELECT lifecycle FROM api.sheet_instances WHERE id=$1`,
        [instanceA],
      )
    ).rows[0]
    expect(remaining.lifecycle).toBe('active')
    const stillEmbedded = (
      await auth.query(
        `SELECT payload FROM api.blocks WHERE id=$1`,
        [shared.block.id],
      )
    ).rows[0]
    expect(stillEmbedded.payload).toEqual({ instanceId: instanceA })

    const duplicated = (
      await auth.query(
        `SELECT api.duplicate_sheet_instance_block($1,$2) result`,
        [shared.block.id, 2],
      )
    ).rows[0].result
    expect(duplicated.instance.id).not.toBe(instanceA)
    expect(duplicated.block.payload.instanceId).toBe(duplicated.instance.id)
    expect(duplicated.instance.duplicated_from_instance_id).toBe(instanceA)

    await expectDenied(
      otherAuth.query(
        `SELECT api.insert_sheet_instance_block($1,NULL,NULL,$2)`,
        [RECORD_A, instanceA],
      ),
      '42501',
    )

    await expectDenied(
      auth.query(
        `SELECT api.update_block_payload($1,$2::jsonb,$3,1)`,
        [
          second.block.id,
          JSON.stringify({ instanceId: instanceA }),
          second.block.version,
        ],
      ),
      '23514',
    )

    const depsFromNotebook = (
      await auth.query(
        `SELECT api.discover_object_dependencies('notebook_record',$1) result`,
        [RECORD_A],
      )
    ).rows[0].result
    const notebookInstanceIds = (
      depsFromNotebook.dependencies as Array<{ id: string; kind: string }>
    )
      .filter((item) => item.kind === 'sheet_instance')
      .map((item) => item.id)
    expect(notebookInstanceIds).toEqual(
      expect.arrayContaining([instanceB]),
    )

    const depsFromInstance = (
      await auth.query(
        `SELECT api.discover_object_dependencies('sheet_instance',$1) result`,
        [instanceA],
      )
    ).rows[0].result
    expect(
      (depsFromInstance.dependencies as Array<{ kind: string; id: string }>)
        .filter((item) => item.kind === 'notebook_block')
        .map((item) => item.id),
    ).toContain(shared.block.id)
  })

  it('keeps legacy scientific-table blocks working and converts them explicitly', async () => {
    const legacy = (
      await auth.query(`SELECT api.insert_sheet_block($1,NULL,$2) result`, [
        RECORD_B,
        3,
      ])
    ).rows[0].result
    const tableId = legacy.table.id as string
    expect(legacy.block.payload).toEqual({ tableId })

    await expectDenied(
      auth.query(
        `SELECT api.update_block_payload($1,$2::jsonb,$3,1)`,
        [
          legacy.block.id,
          JSON.stringify({ instanceId: crypto.randomUUID() }),
          legacy.block.version,
        ],
      ),
      '23514',
    )

    const converted = (
      await auth.query(
        `SELECT api.convert_legacy_sheet_block($1,$2) result`,
        [legacy.block.id, legacy.block.version],
      )
    ).rows[0].result
    expect(converted.block.payload.instanceId).toBe(converted.instance.id)
    expect(converted.block.payload.tableId).toBeUndefined()
    const table = (
      await auth.query(`SELECT id FROM api.scientific_tables WHERE id=$1`, [
        tableId,
      ])
    ).rows[0]
    expect(table.id).toBe(tableId)

    await auth.query(
      `SELECT api.archive_sheet_instance($1,$2)`,
      [converted.instance.id, converted.instance.revision],
    )
    const archived = (
      await auth.query(
        `SELECT lifecycle FROM api.sheet_instances WHERE id=$1`,
        [converted.instance.id],
      )
    ).rows[0]
    expect(archived.lifecycle).toBe('archived')
    const payload = (
      await auth.query(`SELECT payload FROM api.blocks WHERE id=$1`, [
        converted.block.id,
      ])
    ).rows[0]
    expect(payload.payload.instanceId).toBe(converted.instance.id)
  })

  it('rejects mixed payload identities and stale structure versions', async () => {
    await expectDenied(
      auth.query(
        `SELECT api.insert_block($1,'sheet',$2::jsonb,1,NULL,NULL)`,
        [
          RECORD_A,
          JSON.stringify({
            instanceId: crypto.randomUUID(),
            tableId: crypto.randomUUID(),
          }),
        ],
      ),
      '23514',
    )
    await expectDenied(
      auth.query(
        `SELECT api.insert_sheet_instance_block($1,NULL,$2,NULL)`,
        [RECORD_A, 1],
      ),
      'SB001',
    )
  })

  it('lets an ad-hoc Notebook Sheet add a local row without Dataset composition', async () => {
    const inserted = (
      await auth.query(
        `SELECT api.insert_sheet_instance_block($1,NULL,NULL,NULL) result`,
        [RECORD_B],
      )
    ).rows[0].result
    const instanceId = inserted.instance.id as string
    const fieldId = inserted.instance.state.localFields[0].fieldId as string
    expect(inserted.instance.state.localFields[0].key).toBe('column_1')
    const rowKey = '06200000-0000-4000-8000-0000000000aa'
    const updated = (
      await auth.query(
        `SELECT to_jsonb(api.mutate_sheet_instance_local_state($1,$2,$3,'[]'::jsonb,$4::jsonb,$5::jsonb)) result`,
        [
          instanceId,
          inserted.instance.revision,
          crypto.randomUUID(),
          JSON.stringify([{ kind: 'local', rowKey }]),
          JSON.stringify([{ rowKey, fieldId, value: 'first observation' }]),
        ],
      )
    ).rows[0].result
    expect(updated.state.localValues[rowKey][fieldId]).toBe(
      'first observation',
    )
  })
})
