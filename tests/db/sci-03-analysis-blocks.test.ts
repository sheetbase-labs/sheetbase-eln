/**
 * SCI-03 database contract proof for notebook analysis blocks: definition
 * reference integrity, frozen-authority rules (only the SECURITY DEFINER
 * RPCs may write a frozen payload), and the freeze/unfreeze lifecycle with
 * verbatim definition pinning and dataset provenance.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000130a'
const PROJECT_A = '00000000-0000-4000-8000-00000000131a'
const USER_A = 'sci-03-owner-a'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

// Fixture state shared by tests.
let experimentId = ''
let tableId = ''
let resourceName = ''
const cols: Record<string, { id: string; field_name: string }> = {}
let definitionId = ''

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
     ('${USER_A}','SCI 03 A','sci-03-a@sheetbase.test',true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ('${WS_A}','sci-03-a','SCI 03 A')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role)
     VALUES ('${WS_A}','${USER_A}','owner')`,
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title)
     VALUES ('${PROJECT_A}','${WS_A}','sci-03-a','SCI 03 A')`,
  )
  await migrator.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: USER_A, workspace_id: WS_A }),
  ])

  const rec = await migrator.query(
    `SELECT * FROM api.create_record(
       $1::uuid,'experiment','Analysis blocks','draft',ARRAY[]::text[],'{}'::jsonb)`,
    [PROJECT_A],
  )
  experimentId = rec.rows[0].id

  // Generated scientific-table resource (same shape DATA-002 created).
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  const suffix = Array.from(
    { length: 26 },
    () => alphabet[Math.floor(Math.random() * 32)],
  ).join('')
  resourceName = `sheet_${suffix}`
  await migrator.query(
    `CREATE TABLE api.${resourceName} (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       workspace_id uuid NOT NULL,
       version bigint NOT NULL DEFAULT 1,
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now(),
       formula_column_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
       created_by_user_id text,
       updated_by_user_id text
     )`,
  )
  const sheet = await migrator.query(
    `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
     VALUES ($1,'sheet','{}'::jsonb,1,$2) RETURNING id`,
    [experimentId, USER_A],
  )
  const tableRes = await migrator.query(
    `INSERT INTO api.scientific_tables(workspace_id,record_id,block_id,resource_name,name,created_by_user_id)
     VALUES ($1,$2,$3,$4,'Assay readings',$5) RETURNING id`,
    [WS_A, experimentId, sheet.rows[0].id, resourceName, USER_A],
  )
  tableId = tableRes.rows[0].id
  const columnDefs = [
    { label: 'Time', logical_type: 'decimal' },
    { label: 'Recovery', logical_type: 'decimal' },
  ]
  for (const [index, column] of columnDefs.entries()) {
    const fieldSuffix = Array.from(
      { length: 26 },
      () => alphabet[Math.floor(Math.random() * 32)],
    ).join('')
    const fieldName = `col_${fieldSuffix}`
    // The physical column must exist before the metadata row: the deferred
    // regrant trigger grants column privileges on commit.
    await migrator.query(
      `ALTER TABLE api.${resourceName} ADD COLUMN "${fieldName}" decimal`,
    )
    const colRes = await migrator.query(
      `INSERT INTO api.scientific_columns(table_id,workspace_id,field_name,label,display_order,logical_type,created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        tableId,
        WS_A,
        fieldName,
        column.label,
        index + 1,
        column.logical_type,
        USER_A,
      ],
    )
    cols[column.label] = { id: colRes.rows[0].id, field_name: fieldName }
  }
  const rows: Array<[number, number]> = [
    [0, 1],
    [24, 3],
    [48, 5],
  ]
  for (const [time, recovery] of rows) {
    await migrator.query(
      `INSERT INTO api.${resourceName}(workspace_id,"${cols['Time'].field_name}","${cols['Recovery'].field_name}")
       VALUES ($1,$2,$3)`,
      [WS_A, time, recovery],
    )
  }

  // A saved analysis definition in this workspace.
  const def = {
    definitionVersion: 1,
    kind: 'regression',
    datasets: [{ tableId }],
    outcome: {
      columnId: cols['Recovery'].id,
      fieldName: cols['Recovery'].field_name,
    },
    predictor: {
      columnId: cols['Time'].id,
      fieldName: cols['Time'].field_name,
    },
    degree: 1,
  }
  const defRes = await migrator.query(
    `INSERT INTO api.analysis_definitions(workspace_id,owner_user_id,name,definition,source_revisions)
     VALUES ($1,$2,'Recovery slope',$3::jsonb,'[]'::jsonb) RETURNING id`,
    [WS_A, USER_A, JSON.stringify(def)],
  )
  definitionId = defRes.rows[0].id
})

afterAll(async () => {
  const generated = await migrator.query<{ resource_name: string }>(
    `SELECT resource_name FROM api.scientific_tables WHERE workspace_id=$1`,
    [WS_A],
  )
  for (const row of generated.rows) {
    if (/^sheet_[a-z2-7]{26}$/.test(row.resource_name)) {
      await migrator.query(`DROP TABLE IF EXISTS api.${row.resource_name}`)
    }
  }
  await migrator.query(
    `DELETE FROM api.analysis_definitions WHERE workspace_id=$1`,
    [WS_A],
  )
  await migrator.query(
    `DELETE FROM api.scientific_tables WHERE workspace_id=$1`,
    [WS_A],
  )
  await migrator.query(
    `DELETE FROM api.blocks WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id=$1)`,
    [WS_A],
  )
  await migrator.query(
    `DELETE FROM api.revisions WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id=$1)`,
    [WS_A],
  )
  await migrator.query(`DELETE FROM api.records WHERE workspace_id=$1`, [WS_A])
  await migrator.query(`DELETE FROM api.projects WHERE workspace_id=$1`, [WS_A])
  await migrator.query(`DELETE FROM api.workspaces WHERE id=$1`, [WS_A])
  await migrator.query(`DELETE FROM internal."user" WHERE id=$1`, [USER_A])
  await Promise.all(clients.map((client) => client.end()))
  await migrator.end()
})

let blockOrder = 1

async function insertAnalysisBlock(payload: unknown) {
  blockOrder += 1
  const { rows } = await migrator.query(
    `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
     VALUES ($1,'analysis',$2::jsonb,$3,$4) RETURNING *`,
    [experimentId, JSON.stringify(payload), blockOrder * 0.001, USER_A],
  )
  return rows[0]
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Recovery over time',
    definitionId,
    frozen: null,
    ...overrides,
  }
}

describe('SCI-03 analysis blocks', () => {
  it('enforces definition-reference integrity and required fields', async () => {
    const block = await insertAnalysisBlock(payload())
    expect(block.id).toBeTruthy()

    // Unknown definition UUID is rejected.
    await expect(
      insertAnalysisBlock({
        title: 'Bad',
        definitionId: '00000000-0000-4000-8000-0000000000ff',
      }),
    ).rejects.toMatchObject({ code: '23514' })

    // Title is required on non-draft payloads.
    await expect(insertAnalysisBlock({ definitionId })).rejects.toMatchObject({
      code: '23514',
    })
  })

  it('freezes through the RPC, pinning the definition and input provenance', async () => {
    const block = await insertAnalysisBlock(payload())
    const res = await migrator.query(
      `SELECT * FROM api.freeze_analysis_block($1,$2)`,
      [block.id, block.version],
    )
    const frozenBlock = res.rows[0]
    const frozen = frozenBlock.payload.frozen
    expect(frozen).toBeTruthy()
    expect(frozen.definition.kind).toBe('regression')
    expect(frozen.definitionVersion).toBe(1)
    expect(frozen.data.rows).toHaveLength(3)
    expect(frozen.datasetProvenance[0].rowCount).toBe(3)
    expect(frozen.datasetProvenance[0].checksum).toMatch(/^[0-9a-f]{32}$/)
    // Version bumped by the freeze.
    expect(frozenBlock.version).toBe(block.version + 1)
  })

  it('rejects authenticated attempts to fabricate or alter frozen payloads', async () => {
    const block = await insertAnalysisBlock(payload())
    // An ordinary authenticated user can never write the frozen transition.
    const user = await asRole('authenticator')
    clients.push(user)
    await user.query('SET ROLE authenticated')
    await user.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({
        sub: USER_A,
        workspace_id: WS_A,
        role: 'authenticated',
      }),
    ])
    await expect(
      user.query(
        `UPDATE api.blocks SET payload=jsonb_set(payload,'{frozen}', $2::jsonb) WHERE id=$1`,
        [
          block.id,
          JSON.stringify({
            revisionId: null,
            frozenAt: '2026-01-01T00:00:00Z',
            frozenByUserId: USER_A,
            definition: { kind: 'descriptive' },
            datasetProvenance: [],
            data: { columns: [], rows: [] },
          }),
        ],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('binds a frozen analysis to a submitted revision and locks it', async () => {
    const block = await insertAnalysisBlock(payload())
    const frozen = await migrator.query(
      `SELECT * FROM api.freeze_analysis_block($1,$2)`,
      [block.id, block.version],
    )
    // A submitted revision capturing this record (REV-002 shape).
    const rev = await migrator.query(
      `INSERT INTO api.revisions(record_id,structure_version,metadata_version,metadata_snapshot,block_snapshot,reason,created_by_user_id)
       VALUES ($1,1,1,'{}'::jsonb,'[]'::jsonb,'submit',$2) RETURNING id`,
      [experimentId, USER_A],
    )
    const bound = await migrator.query(
      `SELECT * FROM api.bind_analysis_revision($1,$2,$3)`,
      [block.id, rev.rows[0].id, frozen.rows[0].version],
    )
    expect(bound.rows[0].payload.frozen.revisionId).toBe(rev.rows[0].id)
    expect(bound.rows[0].version).toBe(frozen.rows[0].version + 1)

    // Binding is single-shot.
    await expect(
      migrator.query(`SELECT * FROM api.bind_analysis_revision($1,$2,$3)`, [
        block.id,
        rev.rows[0].id,
        bound.rows[0].version,
      ]),
    ).rejects.toThrow(/already bound/)

    // A bound analysis can no longer be unfrozen.
    await expect(
      migrator.query(`SELECT * FROM api.unfreeze_analysis_block($1,$2)`, [
        block.id,
        bound.rows[0].version,
      ]),
    ).rejects.toThrow(/locked into a submitted revision/)

    // Revisions from OTHER records are rejected before any write.
    const otherRec = await migrator.query(
      `SELECT * FROM api.create_record(
         $1::uuid,'experiment','Other record','draft',ARRAY[]::text[],'{}'::jsonb)`,
      [PROJECT_A],
    )
    const otherRev = await migrator.query(
      `INSERT INTO api.revisions(record_id,structure_version,metadata_version,metadata_snapshot,block_snapshot,reason,created_by_user_id)
       VALUES ($1,1,1,'{}'::jsonb,'[]'::jsonb,'submit',$2) RETURNING id`,
      [otherRec.rows[0].id, USER_A],
    )
    const block2 = await insertAnalysisBlock(payload())
    const frozen2 = await migrator.query(
      `SELECT * FROM api.freeze_analysis_block($1,$2)`,
      [block2.id, block2.version],
    )
    await expect(
      migrator.query(`SELECT * FROM api.bind_analysis_revision($1,$2,$3)`, [
        block2.id,
        otherRev.rows[0].id,
        frozen2.rows[0].version,
      ]),
    ).rejects.toThrow(/does not belong to this record/)
  })

  it('unfreezes back to live state and refuses when not frozen', async () => {
    const block = await insertAnalysisBlock(payload())
    const frozen = await migrator.query(
      `SELECT * FROM api.freeze_analysis_block($1,$2)`,
      [block.id, block.version],
    )
    const unfrozen = await migrator.query(
      `SELECT * FROM api.unfreeze_analysis_block($1,$2)`,
      [block.id, frozen.rows[0].version],
    )
    expect(unfrozen.rows[0].payload.frozen ?? null).toBeNull()
    // Unfreeze again → honest error.
    await expect(
      migrator.query(`SELECT * FROM api.unfreeze_analysis_block($1,$2)`, [
        block.id,
        unfrozen.rows[0].version,
      ]),
    ).rejects.toThrow(/not frozen/)
  })
})
