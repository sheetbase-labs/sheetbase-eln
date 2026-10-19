/**
 * A dataset follows its model to a newer published version: the preview names
 * what is added, dropped or retyped, the upgrade moves only the version pointer
 * (values are keyed by field id), and an incompatible, unpublished, older,
 * foreign or stale request is refused with a cause.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '14000000-0000-4000-8000-0000000000a1'
const OWNER = 'dmu-owner'
const VIEWER = 'dmu-viewer'
const DEF = '14000000-0000-4000-8000-0000000000d1'
const OTHER_DEF = '14000000-0000-4000-8000-0000000000d2'
const V1 = '14000000-0000-4000-8000-0000000000e1'
const V2_ADDS = '14000000-0000-4000-8000-0000000000e2'
const V3_DROPS = '14000000-0000-4000-8000-0000000000e3'
const V4_RETYPES = '14000000-0000-4000-8000-0000000000e4'
const V5_REQUIRED = '14000000-0000-4000-8000-0000000000e5'
const V6_DRAFT = '14000000-0000-4000-8000-0000000000e6'
const VX_OTHER = '14000000-0000-4000-8000-0000000000e7'
const F_A = '14000000-0000-4000-8000-0000000000f1'
const F_B = '14000000-0000-4000-8000-0000000000f2'
const F_C = '14000000-0000-4000-8000-0000000000f3'
const DATASET = '14000000-0000-4000-8000-0000000000aa'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(user: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: user, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function version(
  id: string,
  schema: string,
  n: number,
  lifecycle: 'active' | 'draft',
  fields: Array<{
    field: string
    key: string
    type?: string
    nullable?: boolean
    order: number
  }>,
) {
  await migrator.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle) values ($1,$2,$3,'draft')`,
    [id, schema, n],
  )
  for (const f of fields) {
    await migrator.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,display_order)
       values ($1,$2,$3,$3,$4,$5,$6)`,
      [id, f.field, f.key, f.type ?? 'text', f.nullable ?? true, f.order],
    )
  }
  if (lifecycle === 'active') {
    await migrator.query(
      `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
      [id],
    )
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
     ($1,'Owner','dmu-owner@test.invalid',true),($2,'Viewer','dmu-viewer@test.invalid',true)`,
    [OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'dmu','Model upgrade')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'viewer')`,
    [WS, OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name,lifecycle) values
     ($1,$3,'assay','Assay','active'),($2,$3,'other','Other','active')`,
    [DEF, OTHER_DEF, WS],
  )
  const a = { field: F_A, key: 'reading', order: 1 }
  const b = { field: F_B, key: 'operator', order: 2 }
  await version(V1, DEF, 1, 'active', [a, b])
  await version(V2_ADDS, DEF, 2, 'active', [
    a,
    b,
    { field: F_C, key: 'notes', order: 3 },
  ])
  await version(V3_DROPS, DEF, 3, 'active', [a])
  await version(V4_RETYPES, DEF, 4, 'active', [{ ...a, type: 'decimal' }, b])
  await version(V5_REQUIRED, DEF, 5, 'active', [
    a,
    b,
    { field: F_C, key: 'lot', nullable: false, order: 3 },
  ])
  await version(V6_DRAFT, DEF, 6, 'draft', [a, b])
  await version(VX_OTHER, OTHER_DEF, 1, 'active', [a, b])
  await migrator.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name) values ($1,$2,$3,'Plate reads')`,
    [DATASET, WS, V1],
  )
  await migrator.query(
    `insert into api.dataset_rows(dataset_id,workspace_id) values ($1,$2)`,
    [DATASET, WS],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function preview(client: Client, target: string) {
  return (
    await client.query<{ result: Record<string, unknown> }>(
      `select api.preview_dataset_model_upgrade($1,$2) result`,
      [DATASET, target],
    )
  ).rows[0]!.result
}

describe('preview_dataset_model_upgrade', () => {
  it('lists what a compatible version adds', async () => {
    const owner = await actor(OWNER)
    const result = await preview(owner, V2_ADDS)
    expect(result).toMatchObject({
      ok: true,
      blocked: false,
      fromVersion: 1,
      toVersion: 2,
      rowCount: 1,
    })
    expect(result.added).toEqual([
      { key: 'notes', label: 'notes', type: 'text' },
    ])
  })

  it.each([
    [V3_DROPS, /drops fields/],
    [V4_RETYPES, /changes the type/],
    [V5_REQUIRED, /required fields/],
    [V6_DRAFT, /not published/],
    [VX_OTHER, /different model/],
    [V1, /already on that version/],
  ])('blocks %s with the cause', async (target, reason) => {
    const owner = await actor(OWNER)
    const result = await preview(owner, target)
    expect(result.blocked).toBe(true)
    expect(String(result.reason)).toMatch(reason)
  })
})

describe('apply_dataset_model_upgrade', () => {
  it('refuses a viewer, a stale revision and a blocked version, and moves nothing', async () => {
    const viewer = await actor(VIEWER)
    await expect(
      viewer.query(`select api.apply_dataset_model_upgrade($1,$2,null)`, [
        DATASET,
        V2_ADDS,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    const owner = await actor(OWNER)
    await expect(
      owner.query(`select api.apply_dataset_model_upgrade($1,$2,99)`, [
        DATASET,
        V2_ADDS,
      ]),
    ).rejects.toMatchObject({ code: 'SB001' })
    await expect(
      owner.query(`select api.apply_dataset_model_upgrade($1,$2,null)`, [
        DATASET,
        V3_DROPS,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    const { rows } = await migrator.query(
      `select schema_version_id from api.datasets where id=$1`,
      [DATASET],
    )
    expect(rows[0].schema_version_id).toBe(V1)
  })

  it('moves the dataset to the newer version and bumps its revision', async () => {
    const owner = await actor(OWNER)
    const before = (
      await migrator.query(`select revision from api.datasets where id=$1`, [
        DATASET,
      ])
    ).rows[0].revision
    const { rows } = await owner.query<{ result: Record<string, unknown> }>(
      `select api.apply_dataset_model_upgrade($1,$2,$3) result`,
      [DATASET, V2_ADDS, before],
    )
    expect(rows[0]!.result).toMatchObject({ applied: true, toVersion: 2 })
    const after = (
      await migrator.query(
        `select schema_version_id, revision from api.datasets where id=$1`,
        [DATASET],
      )
    ).rows[0]
    expect(after.schema_version_id).toBe(V2_ADDS)
    expect(Number(after.revision)).toBe(Number(before) + 1)
    const events = await migrator.query(
      `select 1 from api.change_events where entity_uuid=$1 and payload->>'effect'='dataset_model_upgrade'`,
      [DATASET],
    )
    expect(events.rowCount).toBe(1)
  })
})
