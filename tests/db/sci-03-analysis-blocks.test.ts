/**
 * SCI-03 database contract proof for notebook analysis blocks: definition
 * reference integrity, frozen-authority rules (only the SECURITY DEFINER
 * RPCs may write a frozen payload), version-pinned frozen evidence (no
 * embedded rows), and submit-time revision binding through the revisions
 * trigger. Fixtures build a canonical Dataset per decision 0037.
 */
import pg from 'pg'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, ensureSessions } from './helpers'

const WS_A = crypto.randomUUID()
const PROJECT_A = crypto.randomUUID()
const USER_A = `sci-03-owner-${crypto.randomUUID().slice(0, 8)}`
const USER_B = `sci-03-member-${crypto.randomUUID().slice(0, 8)}`

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

// Fixture state shared by tests.
let experimentId = ''
let datasetId = ''
let fieldTime = ''
let fieldRecovery = ''
let definitionId = ''
let emptyDatasetId = ''

async function insertCanonicalDataset(
  name: string,
  rowCount: number,
): Promise<string> {
  const schemaRes = await migrator.query(
    `INSERT INTO api.dataset_schema_definitions(workspace_id,key,name,lifecycle)
     VALUES ($1,$2,$3,'active') RETURNING id`,
    [
      WS_A,
      `sci03_${name}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      name,
    ],
  )
  const schemaId = schemaRes.rows[0].id
  const versionRes = await migrator.query(
    `INSERT INTO api.dataset_schema_versions(schema_id,"version",lifecycle)
     VALUES ($1,1,'draft') RETURNING id`,
    [schemaId],
  )
  const svId = versionRes.rows[0].id
  const fields: Array<{ key: string; label: string }> = [
    { key: 'time', label: 'Time' },
    { key: 'recovery', label: 'Recovery' },
  ]
  const fieldIds: Record<string, string> = {}
  for (const [index, field] of fields.entries()) {
    const res = await migrator.query(
      `INSERT INTO api.dataset_schema_version_fields
        (schema_version_id,field_id,key,label,logical_type,display_order)
       VALUES ($1,gen_random_uuid(),$2,$3,'decimal',$4) RETURNING field_id`,
      [svId, field.key, field.label, index + 1],
    )
    fieldIds[field.key] = res.rows[0].field_id
  }
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle='active' WHERE id=$1`,
    [svId],
  )
  const dsRes = await migrator.query(
    `INSERT INTO api.datasets(workspace_id,schema_version_id,name)
     VALUES ($1,$2,$3) RETURNING id`,
    [WS_A, svId, name],
  )
  const dsId = dsRes.rows[0].id
  const rows: Array<[number, number]> = [
    [0, 1],
    [24, 3],
    [48, 5],
  ]
  for (const [time, recovery] of rows.slice(0, rowCount)) {
    const rowRes = await migrator.query(
      `INSERT INTO api.dataset_rows(dataset_id,workspace_id) VALUES ($1,$2) RETURNING id`,
      [dsId, WS_A],
    )
    const rowId = rowRes.rows[0].id
    for (const [fieldId, value] of [
      [fieldIds.time, time],
      [fieldIds.recovery, recovery],
    ] as Array<[string, number]>) {
      await migrator.query(
        `INSERT INTO api.dataset_row_values(row_id,field_id,numeric_value)
         VALUES ($1,$2,$3)`,
        [rowId, fieldId, value],
      )
    }
  }
  return dsId
}

async function insertDefinition(input: {
  name: string
  datasetRef: string
  outcomeField: string
  predictorField?: string
}) {
  const def = {
    definitionVersion: 1,
    kind: 'regression',
    datasets: [{ datasetId: input.datasetRef }],
    outcome: { fieldId: input.outcomeField },
    predictor: { fieldId: input.predictorField ?? input.outcomeField },
    degree: 1,
  }
  const res = await migrator.query(
    `INSERT INTO api.analysis_definitions(workspace_id,owner_user_id,name,definition,source_revisions)
     VALUES ($1,$2,$3,$4::jsonb,'[]'::jsonb) RETURNING id`,
    [WS_A, USER_A, input.name, JSON.stringify(def)],
  )
  return res.rows[0].id
}

let blockOrder = 0

async function insertAnalysisBlock(payloadOverrides: Record<string, unknown>) {
  const payload = {
    title: 'Recovery over time',
    definitionId,
    frozen: null,
    ...payloadOverrides,
  }
  const res = await migrator.query(
    `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
     VALUES ($1,'analysis',$2::jsonb,$4,$3) RETURNING *`,
    [experimentId, JSON.stringify(payload), USER_A, ++blockOrder],
  )
  return res.rows[0]
}

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
  await ensureSessions(migrator, [USER_A])
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
     ('${USER_B}','SCI 03 B','sci-03-b@sheetbase.test',true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role)
     VALUES ('${WS_A}','${USER_B}','member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id)
     VALUES ('${PROJECT_A}','${WS_A}','sci-03-a','SCI 03 A','${USER_A}')`,
  )
  await migrator.query(
    `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES ('sci-03-session','sci-03-session',$1,now()+interval '1 hour') ON CONFLICT (id) DO NOTHING`,
    [USER_A],
  )
  await migrator.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: USER_A,
      workspace_id: WS_A,
      session_id: 'sci-03-session',
    }),
  ])

  const rec = await migrator.query(
    `SELECT * FROM api.create_record(
       $1::uuid,'experiment','Analysis blocks','draft',ARRAY[]::text[],'{}'::jsonb)`,
    [PROJECT_A],
  )
  experimentId = rec.rows[0].id

  datasetId = await insertCanonicalDataset(`assay_readings_${Date.now()}`, 3)
  const fields = await migrator.query(
    `SELECT f.key, f.field_id FROM api.dataset_schema_version_fields f
      JOIN api.dataset_schema_versions sv ON sv.id=f.schema_version_id
      JOIN api.datasets d ON d.schema_version_id=sv.id
     WHERE d.id=$1`,
    [datasetId],
  )
  for (const row of fields.rows) {
    if (row.key === 'time') fieldTime = row.field_id
    if (row.key === 'recovery') fieldRecovery = row.field_id
  }
  definitionId = await insertDefinition({
    name: 'Recovery slope',
    datasetRef: datasetId,
    outcomeField: fieldRecovery,
    predictorField: fieldTime,
  })
  emptyDatasetId = await insertCanonicalDataset(
    `empty_readings_${Date.now()}`,
    0,
  )
})

afterAll(async () => {
  await migrator.query(
    `DELETE FROM api.analysis_definitions WHERE workspace_id=$1`,
    [WS_A],
  )
  await migrator.query(
    `DELETE FROM api.review_submissions WHERE workspace_id=$1`,
    [WS_A],
  )
  await migrator.query(
    `DELETE FROM api.revisions WHERE record_id IN
    (SELECT id FROM api.records WHERE project_id=$1)`,
    [PROJECT_A],
  )
  await migrator.query(
    `DELETE FROM api.blocks WHERE record_id IN
    (SELECT id FROM api.records WHERE project_id=$1)`,
    [PROJECT_A],
  )
  await migrator.query(`DELETE FROM api.records WHERE project_id=$1`, [
    PROJECT_A,
  ])
  await migrator.query(`DELETE FROM api.projects WHERE id=$1`, [PROJECT_A])
  await migrator.query(
    `DELETE FROM api.workspace_memberships WHERE workspace_id=$1`,
    [WS_A],
  )
  // Dataset Versions are immutable evidence: their created_by SET NULL
  // would fire the immutability trigger, so the fixture user is left in place.
})

describe('SCI-03 analysis blocks', () => {
  it('enforces definition-reference integrity and required fields', async () => {
    const block = await insertAnalysisBlock({})
    expect(block.id).toBeTruthy()

    await expect(
      insertAnalysisBlock({
        title: 'Bad',
        definitionId: '00000000-0000-4000-8000-0000000000ff',
      }),
    ).rejects.toMatchObject({ code: '23514' })

    // Title is required on non-draft payloads.
    await expect(
      insertAnalysisBlock({ title: '', definitionId }),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('freezes through the RPC, pinning an immutable Dataset Version — never rows', async () => {
    const block = await insertAnalysisBlock({})
    const res = await migrator.query(
      `SELECT * FROM api.freeze_analysis_block($1,$2)`,
      [block.id, block.version],
    )
    const frozenBlock = res.rows[0]
    const frozen = frozenBlock.payload.frozen
    expect(frozen).toBeTruthy()
    expect(frozen.definition.kind).toBe('regression')
    expect(frozen.definitionVersion).toBe(1)

    // Evidence references only: no embedded source rows.
    expect(frozen.data).toBeUndefined()

    expect(frozen.columns).toHaveLength(2)
    expect(
      frozen.columns.map((c: { fieldId: string }) => c.fieldId).sort(),
    ).toEqual([fieldRecovery, fieldTime].sort())

    const prov = frozen.datasetProvenance[0]
    expect(prov.datasetId).toBe(datasetId)
    expect(/^[0-9a-f]{8}-/.test(prov.datasetVersionId)).toBe(true)
    expect(prov.schemaVersionNumber).toBe(1)
    expect(prov.rowCount).toBe(3)
    expect(prov.checksum).toMatch(/^[0-9a-f]{32}$/)

    const counts = await migrator.query(
      `SELECT
         (SELECT count(*) FROM api.dataset_version_rows WHERE dataset_version_id=$1) AS rows,
         (SELECT count(*) FROM api.dataset_version_values WHERE dataset_version_id=$1) AS values`,
      [prov.datasetVersionId],
    )
    expect(Number(counts.rows[0].rows)).toBe(3)
    expect(Number(counts.rows[0].values)).toBe(6)
    expect(frozenBlock.version).toBe(block.version + 1)
  })

  it('refuses definitions that do not reference exactly one dataset', async () => {
    const other = await insertCanonicalDataset(`other_${Date.now()}`, 3)
    const twoDefRes = await migrator.query(
      `INSERT INTO api.analysis_definitions(workspace_id,owner_user_id,name,definition,source_revisions)
       VALUES ($1,$2,'Two dataset definition',$3::jsonb,'[]'::jsonb) RETURNING id`,
      [
        WS_A,
        USER_A,
        JSON.stringify({
          definitionVersion: 1,
          kind: 'regression',
          datasets: [{ datasetId: other }, { datasetId }],
          outcome: { fieldId: fieldRecovery },
          predictor: { fieldId: fieldTime },
          degree: 1,
        }),
      ],
    )
    const block = await insertAnalysisBlock({
      title: 'Two datasets',
      definitionId: twoDefRes.rows[0].id,
    })
    await expect(
      migrator.query(`SELECT * FROM api.freeze_analysis_block($1,$2)`, [
        block.id,
        block.version,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects freezing against an empty dataset', async () => {
    const emptyDef = await insertDefinition({
      name: `Empty dataset definition ${Date.now()}`,
      datasetRef: emptyDatasetId,
      outcomeField: fieldRecovery,
      predictorField: fieldTime,
    })
    const block = await insertAnalysisBlock({
      title: 'Empty',
      definitionId: emptyDef,
    })
    await expect(
      migrator.query(`SELECT * FROM api.freeze_analysis_block($1,$2)`, [
        block.id,
        block.version,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects authenticated attempts to fabricate or alter frozen payloads', async () => {
    const block = await insertAnalysisBlock({})
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
            columns: [],
            datasetProvenance: [],
          }),
        ],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('binds frozen evidence inside submission; snapshot, live state and digest agree', async () => {
    // Frozen analysis block.
    const analysisBlock = await insertAnalysisBlock({})
    await migrator.query(`SELECT * FROM api.freeze_analysis_block($1,$2)`, [
      analysisBlock.id,
      analysisBlock.version,
    ])

    // Frozen chart block over the same canonical dataset, same record.
    const chartSpec = {
      specVersion: 1,
      type: 'line',
      datasets: [{ datasetId: datasetId }],
      fields: {
        x: { fieldId: fieldTime },
        y: { fieldId: fieldRecovery },
        series: null,
        color: null,
        size: null,
        facet: null,
      },
      filters: [],
      transformations: [],
      typeParams: {},
      display: {
        axes: { x: { scale: 'linear' }, y: { scale: 'linear' } },
        series: [],
        legend: { visible: true },
      },
      overlays: { errorBars: null },
    }
    const chartBlockRes = await migrator.query(
      `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
       VALUES ($1,'chart',$2::jsonb,$4,$3) RETURNING *`,
      [
        experimentId,
        JSON.stringify({ title: 'Recovery', spec: chartSpec, frozen: null }),
        USER_A,
        ++blockOrder,
      ],
    )
    const chartBlock = chartBlockRes.rows[0]
    await migrator.query(`SELECT * FROM api.freeze_chart($1,$2)`, [
      chartBlock.id,
      chartBlock.version,
    ])

    // Preview → submit through the canonical RPC.
    const preview = await migrator.query(
      `SELECT * FROM api.preview_submission_digest($1) AS preview`,
      [experimentId],
    )
    const submitted = (
      await migrator.query(
        `select api.submit_record_revision($1,$2,'default-scientific-review',1,ARRAY[$3]::text[],true,$4) AS submit_record_revision`,
        [
          experimentId,
          preview.rows[0].preview.sourceDigest,
          USER_A,
          `sci-03-bind-${Date.now()}`,
        ],
      )
    ).rows[0].submit_record_revision
    const revisionId = submitted.revision.id

    // 1. Live frozen blocks carry the submitted revision id.
    for (const blockId of [analysisBlock.id, chartBlock.id]) {
      const live = await migrator.query(
        `SELECT payload->'frozen'->>'revisionId' AS rid, version FROM api.blocks WHERE id=$1`,
        [blockId],
      )
      expect(live.rows[0].rid).toBe(revisionId)
    }

    // 2. The stored revision snapshot carries the same bound ids.
    const revRow = await migrator.query(
      `SELECT block_snapshot, integrity_digest FROM api.revisions WHERE id=$1`,
      [revisionId],
    )
    const snapshotBlocks = revRow.rows[0].block_snapshot
    const snapAnalysis = snapshotBlocks.find(
      (b: { id: string }) => b.id === analysisBlock.id,
    )
    const snapChart = snapshotBlocks.find(
      (b: { id: string }) => b.id === chartBlock.id,
    )
    expect(snapAnalysis.payload.frozen.revisionId).toBe(revisionId)
    expect(snapChart.payload.frozen.revisionId).toBe(revisionId)

    // 3. Stored digest equals the preview taken on live state — the digest is
    // computed from the same bound evidence the snapshot pins.
    expect(revRow.rows[0].integrity_digest).toBe(
      preview.rows[0].preview.sourceDigest,
    )
    expect(submitted.submission.state).toBe('submitted')

    // 4. Unfreeze remains impossible once bound.
    const boundVersion = (
      await migrator.query(`SELECT version FROM api.blocks WHERE id=$1`, [
        analysisBlock.id,
      ])
    ).rows[0].version
    await expect(
      migrator.query(`SELECT * FROM api.unfreeze_analysis_block($1,$2)`, [
        analysisBlock.id,
        boundVersion,
      ]),
    ).rejects.toMatchObject({ code: '23514' })

    // 5. A second revision does not rebind already-bound evidence.
    const resubmitted = (
      await migrator.query(
        `select api.submit_record_revision($1,$2,'default-scientific-review',1,ARRAY[$3]::text[],true,$4) AS submit_record_revision`,
        [
          experimentId,
          preview.rows[0].preview.sourceDigest,
          USER_A,
          `sci-03-bind-2-${Date.now()}`,
        ],
      )
    ).rows[0].submit_record_revision
    expect(resubmitted.revision.id).not.toBe(revisionId)
    const stillBound = await migrator.query(
      `SELECT payload->'frozen'->>'revisionId' AS rid FROM api.blocks WHERE id=$1`,
      [analysisBlock.id],
    )
    expect(stillBound.rows[0].rid).toBe(revisionId)
  })
})

describe('SCI-03 submission idempotency recovery', () => {
  let baseRevisionId = ''
  let baseDigest = ''

  function freshPreview(): Promise<string> {
    return migrator
      .query(`SELECT * FROM api.preview_submission_digest($1) AS p`, [
        experimentId,
      ])
      .then(
        (r: { rows: Array<{ p: { sourceDigest: string } }> }) =>
          r.rows[0].p.sourceDigest,
      )
  }

  beforeAll(async () => {
    await migrator.query(
      `INSERT INTO internal.review_workflow_definitions(definition_key,"version",definition)
       VALUES ('default-scientific-review',2,'{"v":2}'::jsonb)
       ON CONFLICT DO NOTHING`,
    )
    baseDigest = await freshPreview()
    const s0 = (
      await migrator.query(
        `select api.submit_record_revision($1,$2,'default-scientific-review',1,ARRAY[$3]::text[],true,$4) AS submit_record_revision`,
        [experimentId, baseDigest, USER_A, `sci-03-idem-base-${Date.now()}`],
      )
    ).rows[0].submit_record_revision
    expect(s0.idempotent).toBe(false)
    baseRevisionId = s0.revision.id
  })

  /**
   * Deterministically reproduce the unique_violation race: a concurrent
   * winner holds the idempotency key in an uncommitted transaction while the
   * losing request passes its pre-check, then commits so the loser's INSERT
   * raises and the recovery branch re-reads the committed winner.
   */
  /**
   * Insert a controlled revision row so each race case can pin its own
   * `revision_id` (review_submissions enforces uniqueness on it) with an
   * exactly-known integrity digest.
   */
  async function insertRaceRevision(digest: string): Promise<string> {
    const id = crypto.randomUUID()
    await migrator.query(
      `INSERT INTO api.revisions(
         id,record_id,workspace_id,structure_version,metadata_version,
         metadata_snapshot,block_snapshot,integrity_algorithm,integrity_digest,
         reason,created_by_user_id)
       VALUES ($1,$2,$3,1,1,'{}'::jsonb,'[]'::jsonb,'sha256',$4,'submit',$5)`,
      [id, experimentId, WS_A, digest, USER_A],
    )
    return id
  }

  async function raceSubmission(
    key: string,
    winner: {
      reviewers?: string[]
      workflowVersion?: number
      digest?: string
    } = {},
    loserWorkflowVersion: 1 | 2 = 1,
  ): Promise<{
    result?: { idempotent: boolean; revision: { id: string } }
    error?: Error
  }> {
    // The RPC requires a live matching session for the losing request.
    await migrator.query(
      `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES ($1,$1,$2,now()+interval '1 hour') ON CONFLICT (id) DO NOTHING`,
      [`race-${key}`, USER_A],
    )
    const loser = await asRole('authenticator')
    clients.push(loser)
    await loser.query('SET ROLE authenticated')
    await loser.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({
        role: 'authenticated',
        sub: USER_A,
        workspace_id: WS_A,
        session_id: `race-${key}`,
      }),
    ])
    const loserDigest = await freshPreview()
    const expectedLoserDigest =
      winner.digest === undefined ? loserDigest : winner.digest
    const revisionId = await insertRaceRevision(expectedLoserDigest)
    void expectedLoserDigest

    await migrator.query('BEGIN')
    await migrator.query(
      `INSERT INTO api.review_submissions(
         workspace_id,record_id,revision_id,state,
         workflow_definition_key,workflow_definition_version,
         assigned_reviewer_user_ids,submitted_by_user_id,
         submitted_session_id,submitted_role,idempotency_key,submitted_at)
       VALUES ($1,$2,$3,'submitted','default-scientific-review',$4,$5,$6,'race','authenticated',$7,now())`,
      [
        WS_A,
        experimentId,
        revisionId,
        winner.workflowVersion ?? 1,
        winner.reviewers ?? [USER_A],
        USER_A,
        key,
      ],
    )

    const rpc = loser
      .query(
        `select api.submit_record_revision($1,$2,'default-scientific-review',$5,ARRAY[$3]::text[],true,$4) AS submit_record_revision`,
        [experimentId, loserDigest, USER_A, key, loserWorkflowVersion],
      )
      .then(
        (r: {
          rows: Array<{
            submit_record_revision: {
              idempotent: boolean
              revision: { id: string }
            }
          }>
        }) => ({ result: r.rows[0].submit_record_revision }),
      )
      .catch((e: Error) => ({ error: e }))

    await new Promise((resolve) => setTimeout(resolve, 150))
    await migrator.query('COMMIT')
    return rpc
  }

  const conflictCode = { code: '23505' }

  it('returns the committed winner as idempotent when the racing request matches exactly', async () => {
    const outcome = await raceSubmission(`race-match-${crypto.randomUUID()}`)
    expect(outcome.error).toBeUndefined()
    expect(outcome.result?.idempotent).toBe(true)
    expect(outcome.result?.idempotent).toBe(true)
    expect(outcome.result?.revision.id).toBeTruthy()
  })

  it('rejects a racing request whose reviewers differ', async () => {
    const outcome = await raceSubmission(`race-rev-${crypto.randomUUID()}`, {
      reviewers: [USER_B],
    })
    expect(outcome.error).toMatchObject(conflictCode)
    expect(outcome.error?.message).toMatch(/different submission/)
  })

  it('rejects a racing request whose workflow definition version differs', async () => {
    const outcome = await raceSubmission(`race-wf-${crypto.randomUUID()}`, {
      workflowVersion: 2,
    })
    expect(outcome.error).toMatchObject(conflictCode)
    expect(outcome.error?.message).toMatch(/different submission/)
  })

  it('rejects a racing request whose expected digest differs from the winner', async () => {
    const stale = 'a'.repeat(64)
    const outcome = await raceSubmission(`race-digest-${crypto.randomUUID()}`, {
      digest: stale,
    })
    expect(outcome.error).toMatchObject(conflictCode)
    expect(outcome.error?.message).toMatch(/different submission/)
  })

  it('rejects sequential reuse of a key with changed reviewers via the normal path', async () => {
    const key = `seq-${crypto.randomUUID()}`
    const first = (
      await migrator.query(
        `select api.submit_record_revision($1,$2,'default-scientific-review',1,ARRAY[$3]::text[],true,$4) AS submit_record_revision`,
        [experimentId, await freshPreview(), USER_A, key],
      )
    ).rows[0].submit_record_revision
    expect(first.idempotent).toBe(false)

    await expect(
      migrator.query(
        `select api.submit_record_revision($1,$2,'default-scientific-review',1,ARRAY[$3]::text[],true,$4) AS submit_record_revision`,
        [experimentId, await freshPreview(), USER_B, key],
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })
})
