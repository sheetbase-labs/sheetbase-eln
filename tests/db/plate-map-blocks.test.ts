/** SCI-005 database contract proof for plate-map blocks. */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000050a'
const WS_B = '00000000-0000-4000-8000-00000000050b'
const PROJECT_A = '00000000-0000-4000-8000-00000000051a'
const PROJECT_B = '00000000-0000-4000-8000-00000000051b'
const USER_A = 'sci-005-owner-a'
const USER_B = 'sci-005-owner-b'
const SAMPLE_RECORD_ID_A = '00000000-0000-4000-8000-00000000052a'
const ARCHIVED_SAMPLE_RECORD_ID_A = '00000000-0000-4000-8000-00000000052b'
const SAMPLE_RECORD_ID_B = '00000000-0000-4000-8000-00000000052c'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function authenticated(user: string, workspace: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: user,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
  return client
}

async function createRecord(
  client: Client,
  project: string,
  kind: string,
  title: string,
) {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid,$2,$3,$4,ARRAY[]::text[],'{}'::jsonb)`,
    [project, kind, title, 'draft'],
  )
  return rows[0]
}

async function insertBlock(
  client: Client,
  recordId: string,
  payload: unknown,
  order: number,
) {
  const { rows } = await client.query(
    `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
     VALUES($1,'plate_map',$2::jsonb,$3,$4) RETURNING *`,
    [recordId, JSON.stringify(payload), order, USER_A],
  )
  return rows[0]
}

async function updateBlock(client: Client, id: string, payload: unknown) {
  const { rows } = await client.query(
    `UPDATE api.blocks SET payload=$2::jsonb,version=version+1 WHERE id=$1 RETURNING *`,
    [id, JSON.stringify(payload)],
  )
  return rows[0]
}

function payload(
  sample?: Record<string, any>,
  overrides: Record<string, any> = {},
) {
  const wells = sample
    ? [
        {
          wellCode: 'A1',
          row: 0,
          col: 0,
          role: 'sample',
          sampleRef: {
            recordId: sample.id,
            identifier: sample.identifier,
            title: sample.title,
          },
          replicate: 1,
          volume: { value: 20, unit: 'µL' },
        },
      ]
    : []
  return {
    title: 'Test plate',
    spec: {
      specVersion: 1,
      format: '96_well',
      rows: 8,
      cols: 12,
      wells,
      validation: {
        requiredRoles: ['positive_control'],
        volumeMin: 5,
        volumeMax: 100,
      },
      ...overrides,
    },
    provenance: 'Test lab',
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
    ('${USER_A}','SCI 005 A','sci-005-a@sheetbase.test',true),
    ('${USER_B}','SCI 005 B','sci-005-b@sheetbase.test',true)`)
  await migrator.query(`INSERT INTO api.workspaces(id,slug,name) VALUES
    ('${WS_A}','sci-005-a','SCI 005 A'),('${WS_B}','sci-005-b','SCI 005 B')`)
  await migrator.query(`INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
    ('${WS_A}','${USER_A}','owner'),('${WS_B}','${USER_B}','owner')`)
  await migrator.query(`INSERT INTO api.projects(id,workspace_id,key,title) VALUES
    ('${PROJECT_A}','${WS_A}','sci-005-a','SCI 005 A'),
    ('${PROJECT_B}','${WS_B}','sci-005-b','SCI 005 B')`)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator.end()
})

describe('SCI-005 plate-map blocks', () => {
  let a: Client
  let b: Client
  let experimentA: Record<string, any>
  let experimentB: Record<string, any>
  let sampleA: Record<string, any>
  let archivedSampleA: Record<string, any>
  let sampleB: Record<string, any>

  beforeAll(async () => {
    a = await authenticated(USER_A, WS_A)
    b = await authenticated(USER_B, WS_B)
    experimentA = await createRecord(a, PROJECT_A, 'experiment', 'Plate run A')
    experimentB = await createRecord(b, PROJECT_B, 'experiment', 'Plate run B')
    sampleA = await createRecord(a, PROJECT_A, 'sample', 'Test sample')
    archivedSampleA = await createRecord(
      a,
      PROJECT_A,
      'sample',
      'Archived sample',
    )
    sampleB = await createRecord(b, PROJECT_B, 'sample', 'Other sample')
    await migrator.query(
      `UPDATE api.records SET id=CASE id
         WHEN $1 THEN $2::uuid WHEN $3 THEN $4::uuid WHEN $5 THEN $6::uuid END
       WHERE id IN ($1,$3,$5)`,
      [
        sampleA.id,
        SAMPLE_RECORD_ID_A,
        archivedSampleA.id,
        ARCHIVED_SAMPLE_RECORD_ID_A,
        sampleB.id,
        SAMPLE_RECORD_ID_B,
      ],
    )
    sampleA.id = SAMPLE_RECORD_ID_A
    archivedSampleA.id = ARCHIVED_SAMPLE_RECORD_ID_A
    sampleB.id = SAMPLE_RECORD_ID_B
    await a.query('UPDATE api.records SET archived_at=now() WHERE id=$1', [
      archivedSampleA.id,
    ])
  })

  it('isolates plate-map blocks by workspace', async () => {
    const block = await insertBlock(a, experimentA.id, payload(), 1)
    const { rows } = await b.query('SELECT id FROM api.blocks WHERE id=$1', [
      block.id,
    ])
    expect(rows).toHaveLength(0)
  })

  it('rejects cross-workspace sample links', async () => {
    await expect(
      insertBlock(a, experimentA.id, payload(sampleB), 2),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('accepts same-workspace sample links', async () => {
    const block = await insertBlock(a, experimentA.id, payload(sampleA), 3)
    expect(block.payload.spec.wells[0].sampleRef.recordId).toBe(
      SAMPLE_RECORD_ID_A,
    )
  })

  it('keeps archived sample references readable', async () => {
    const block = await insertBlock(
      a,
      experimentA.id,
      payload(archivedSampleA),
      4,
    )
    const { rows } = await a.query(
      'SELECT payload FROM api.blocks WHERE id=$1',
      [block.id],
    )
    expect(rows[0].payload.spec.wells[0].sampleRef.title).toBe(
      'Archived sample',
    )
  })

  it('attributes plate-map payload mutations to the actor', async () => {
    const block = await insertBlock(a, experimentA.id, payload(), 5)
    await updateBlock(a, block.id, { ...payload(), title: 'Mutated plate' })
    const { rows } = await a.query(
      `SELECT actor_user_id FROM api.change_events
       WHERE entity_type='block' AND entity_uuid=$1 AND operation='update' ORDER BY sequence DESC LIMIT 1`,
      [block.id],
    )
    expect(rows[0].actor_user_id).toBe(USER_A)
  })

  it('emits durable insert and update change events', async () => {
    const block = await insertBlock(a, experimentA.id, payload(), 6)
    await updateBlock(a, block.id, { ...payload(), provenance: 'Updated lab' })
    const { rows } = await a.query(
      `SELECT operation FROM api.change_events WHERE entity_type='block' AND entity_uuid=$1 ORDER BY sequence`,
      [block.id],
    )
    expect(
      rows.map(
        (row) =>
          `block.${row.operation === 'create' ? 'insert' : row.operation}`,
      ),
    ).toEqual(['block.insert', 'block.update'])
  })

  it('rejects invalid dimensions, well codes, duplicate wells, and roles', async () => {
    const validWell = { wellCode: 'A1', row: 0, col: 0, role: 'blank' }
    const invalid = [
      payload(undefined, { rows: 7 }),
      payload(undefined, { wells: [{ ...validWell, wellCode: 'Z99' }] }),
      payload(undefined, { wells: [validWell, validWell] }),
      payload(undefined, { wells: [{ ...validWell, role: 'unknown' }] }),
    ]
    for (const [index, badPayload] of invalid.entries()) {
      await expect(
        insertBlock(a, experimentA.id, badPayload, 10 + index),
      ).rejects.toMatchObject({ code: '23514' })
    }
  })

  it('supports idempotent fixture-style insert, update, and verification', async () => {
    const block = await insertBlock(a, experimentA.id, {}, 20)
    const updated = await updateBlock(a, block.id, payload(sampleA))
    const { rows } = await a.query(
      'SELECT type,payload,version FROM api.blocks WHERE id=$1',
      [block.id],
    )
    expect(rows[0]).toMatchObject({
      type: 'plate_map',
      version: updated.version,
    })
    expect(rows[0].payload).toEqual(updated.payload)
  })
})
