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
const V7_DEFAULT = '14000000-0000-4000-8000-0000000000e8'
const V8_OPTIONAL_DEFAULT = '14000000-0000-4000-8000-0000000000e9'
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
    defaultValue?: unknown
    order: number
  }>,
) {
  await migrator.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle) values ($1,$2,$3,'draft')`,
    [id, schema, n],
  )
  for (const f of fields) {
    await migrator.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,display_order,default_value)
       values ($1,$2,$3,$3,$4,$5,$6,$7::jsonb)`,
      [
        id,
        f.field,
        f.key,
        f.type ?? 'text',
        f.nullable ?? true,
        f.order,
        JSON.stringify(f.defaultValue ?? null),
      ],
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
  await version(V7_DEFAULT, DEF, 7, 'active', [
    a,
    b,
    {
      field: F_C,
      key: 'lot',
      nullable: false,
      defaultValue: 'unassigned',
      order: 3,
    },
  ])
  await version(V8_OPTIONAL_DEFAULT, DEF, 8, 'active', [
    a,
    b,
    {
      field: F_C,
      key: 'passed',
      type: 'boolean',
      defaultValue: false,
      order: 3,
    },
  ])
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
  it('refuses semantic reinterpretation of populated scalar, many and reference fields without moving values or the schema pin', async () => {
    const owner = await actor(OWNER)
    const schema = crypto.randomUUID()
    const base = crypto.randomUUID()
    const dataset = crypto.randomUUID()
    const mass = crypto.randomUUID()
    const readings = crypto.randomUUID()
    const reference = crypto.randomUUID()
    await migrator.query(
      `insert into api.dataset_schema_definitions(id,workspace_id,key,name,lifecycle) values ($1,$2,'integrity','Integrity','active')`,
      [schema, WS],
    )
    await migrator.query(
      `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle) values ($1,$2,1,'draft')`,
      [base, schema],
    )
    await migrator.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,quantity,cardinality,relationship,display_order) values
      ($1,$2,'mass','Mass','decimal',true,'{"kind":"mass","dimension":"mass","storageUnit":"mg"}','one',null,1),
      ($1,$3,'readings','Readings','decimal',true,null,'many',null,2),
      ($1,$4,'sample','Sample','reference',true,null,'one','{"target":{"kind":"model","modelKey":"sample"},"cardinality":"one"}',3)`,
      [base, mass, readings, reference],
    )
    await migrator.query(
      `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
      [base],
    )
    await migrator.query(
      `insert into api.datasets(id,workspace_id,schema_version_id,name) values ($1,$2,$3,'Integrity readings')`,
      [dataset, WS, base],
    )
    const row = (
      await migrator.query(
        `insert into api.dataset_rows(dataset_id,workspace_id) values ($1,$2) returning id`,
        [dataset, WS],
      )
    ).rows[0].id
    await migrator.query(
      `insert into api.dataset_row_values(row_id,field_id,ordinal,numeric_value) values ($1,$2,0,10),($1,$3,0,2),($1,$3,1,37)`,
      [row, mass, readings],
    )
    const changes = [
      ['quantity', { kind: 'mass', dimension: 'mass', storageUnit: 'g' }, mass],
      [
        'quantity',
        { kind: 'mass', dimension: 'volume', storageUnit: 'mg' },
        mass,
      ],
      ['validation', { max: 5 }, mass],
      ['cardinality', 'one', readings],
      [
        'relationship',
        { target: { kind: 'model', modelKey: 'reagent' }, cardinality: 'one' },
        reference,
      ],
      ['nullable', false, mass],
      ['default_value', 0, mass],
      ['default_value', 12, mass],
    ] as const
    for (const [index, [column, value, field]] of changes.entries()) {
      const target = crypto.randomUUID()
      await migrator.query(
        `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle) values ($1,$2,$3,'draft')`,
        [target, schema, index + 2],
      )
      await migrator.query(
        `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,description,logical_type,nullable,default_value,quantity,validation,category,relationship,cardinality,lifecycle,display_order) select $1,field_id,key,label,description,logical_type,nullable,default_value,quantity,validation,category,relationship,cardinality,lifecycle,display_order from api.dataset_schema_version_fields where schema_version_id=$2`,
        [target, base],
      )
      // Column names come only from the fixed adversarial cases above.
      await migrator.query(
        `update api.dataset_schema_version_fields set ${column}=$1 where schema_version_id=$2 and field_id=$3`,
        [
          typeof value === 'object' ? JSON.stringify(value) : value,
          target,
          field,
        ],
      )
      await migrator.query(
        `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
        [target],
      )
      const result = (
        await owner.query(
          `select api.preview_dataset_model_upgrade($1,$2) result`,
          [dataset, target],
        )
      ).rows[0].result
      expect(result, column).toMatchObject({
        blocked: true,
        semanticChanges: [
          expect.objectContaining({
            key:
              field === mass
                ? 'mass'
                : field === readings
                  ? 'readings'
                  : 'sample',
          }),
        ],
      })
      await expect(
        owner.query(`select api.apply_dataset_model_upgrade($1,$2,null)`, [
          dataset,
          target,
        ]),
      ).rejects.toMatchObject({ code: '22023' })
    }
    expect(
      (
        await migrator.query(
          `select schema_version_id,revision from api.datasets where id=$1`,
          [dataset],
        )
      ).rows[0],
    ).toMatchObject({ schema_version_id: base, revision: '1' })
    expect(
      (
        await migrator.query(
          `select field_id,ordinal,numeric_value from api.dataset_row_values where row_id=$1 order by field_id,ordinal`,
          [row],
        )
      ).rows,
    ).toEqual(
      [
        { field_id: mass, ordinal: 0, numeric_value: '10' },
        { field_id: readings, ordinal: 0, numeric_value: '2' },
        { field_id: readings, ordinal: 1, numeric_value: '37' },
      ].sort(
        (a, b) => a.field_id.localeCompare(b.field_id) || a.ordinal - b.ordinal,
      ),
    )
  })

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
    [V7_DEFAULT, /explicit validated migration/],
    [V8_OPTIONAL_DEFAULT, /explicit validated migration/],
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
