/**
 * The merged analysis block (migration 0473): one block holds a chart, a
 * statistic or both. Proves the block trigger still accepts every definition
 * in the workspace, that freezing pins one Dataset Version whose column
 * metadata and checksum cover the chart's fields too, that a chart on another
 * dataset or a chart-only definition without its chart is refused, that a
 * statistic-only block freezes exactly as before, and that frozen evidence
 * stays valid and immutable when the live definition and dataset move on.
 */
import pg from 'pg'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, ensureSessions } from './helpers'
import { ANALYSIS_METHOD_VERSION, runAnalysis } from '#/lib/analysis-definition'
import type { FrozenAnalysis } from '#/lib/analysis-block'
import type { DatasetValueFlag } from '#/lib/dataset-flags'
import { fetchFrozenAnalysisRows } from '#/lib/chart-data'
import type { DataClient } from '#/lib/data-client'

const WS_A = crypto.randomUUID()
const PROJECT_A = crypto.randomUUID()
const USER_A = `mab-owner-${crypto.randomUUID().slice(0, 8)}`
const USER_B = `mab-member-${crypto.randomUUID().slice(0, 8)}`

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

// Fixture state shared by tests.
let experimentId = ''
let datasetId = ''
let fieldTime = ''
let fieldRecovery = ''
let fieldBatch = ''
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
      `mab_${name}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
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
    { key: 'batch', label: 'Batch' },
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
      [fieldIds.batch, time + 1],
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
     ('${USER_A}','MAB A','mab-a@sheetbase.test',true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ('${WS_A}','mab-a','MAB A')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role)
     VALUES ('${WS_A}','${USER_A}','owner')`,
  )
  await ensureSessions(migrator, [USER_A])
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
     ('${USER_B}','MAB B','mab-b@sheetbase.test',true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role)
     VALUES ('${WS_A}','${USER_B}','member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id)
     VALUES ('${PROJECT_A}','${WS_A}','mab-a','MAB A','${USER_A}')`,
  )
  await migrator.query(
    `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES ('mab-session','mab-session',$1,now()+interval '1 hour') ON CONFLICT (id) DO NOTHING`,
    [USER_A],
  )
  await migrator.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: USER_A,
      workspace_id: WS_A,
      session_id: 'mab-session',
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
    if (row.key === 'batch') fieldBatch = row.field_id
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

function chartSpec(over: Record<string, unknown> = {}) {
  return {
    specVersion: 1,
    type: 'scatter',
    datasets: [{ datasetId }],
    fields: {
      x: { fieldId: fieldTime },
      y: { fieldId: fieldRecovery },
      series: { fieldId: fieldBatch },
      color: null,
      size: null,
      facet: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
    display: {},
    overlays: { errorBars: null },
    ...over,
  }
}

async function definitionWith(name: string, extra: Record<string, unknown>) {
  const res = await migrator.query(
    `INSERT INTO api.analysis_definitions(workspace_id,owner_user_id,name,definition,source_revisions)
     VALUES ($1,$2,$3,$4::jsonb,'[]'::jsonb) RETURNING id`,
    [
      WS_A,
      USER_A,
      `${name} ${Date.now()}`,
      JSON.stringify({
        definitionVersion: 1,
        datasets: [{ datasetId }],
        ...extra,
      }),
    ],
  )
  return res.rows[0].id as string
}

const statistic = () => ({
  kind: 'regression',
  outcome: { fieldId: fieldRecovery },
  predictor: { fieldId: fieldTime },
  degree: 1,
})

async function freeze(block: { id: string; version: number }) {
  const res = await migrator.query(
    `SELECT * FROM api.freeze_analysis_block($1,$2)`,
    [block.id, block.version],
  )
  return res.rows[0]
}

describe('merged analysis block', () => {
  it('freezes and reconstructs the full 100000-row import envelope through canonical paging', async () => {
    await migrator.query('BEGIN')
    try {
      const large = await insertCanonicalDataset('large_assay', 0)
      const fields = await migrator.query(
        `SELECT f.key,f.field_id FROM api.dataset_schema_version_fields f JOIN api.datasets d ON d.schema_version_id=f.schema_version_id WHERE d.id=$1`,
        [large],
      )
      const valueField = fields.rows.find((f) => f.key === 'recovery').field_id
      await migrator.query(
        `INSERT INTO api.dataset_rows(id,dataset_id,workspace_id)
        SELECT md5($1::text || ':' || n)::uuid,$1::uuid,$2::uuid FROM generate_series(1,100000) n`,
        [large, WS_A],
      )
      await migrator.query(
        `INSERT INTO api.dataset_row_values(row_id,field_id,numeric_value)
        SELECT md5($1::text || ':' || n)::uuid,$2,3*n+7 FROM generate_series(1,100000) n`,
        [large, valueField],
      )
      const definition = await definitionWith('Large assay', {
        kind: 'descriptive',
        datasets: [{ datasetId: large }],
        value: { fieldId: valueField },
      })
      const frozen: FrozenAnalysis = (
        await freeze(await insertAnalysisBlock({ definitionId: definition }))
      ).payload.frozen
      const pin = frozen.datasetProvenance[0]
      expect(pin.rowCount).toBe(100000)
      // This adapter executes the real canonical RPCs, not generated fixture pages.
      const client = {
        rpc: async (name: string, args: Record<string, unknown>) => {
          if (name === 'query_dataset_version_rows')
            return (
              await migrator.query(
                `SELECT api.query_dataset_version_rows($1,$2,$3) AS result`,
                [args.p_dataset_version_id, args.p_limit, args.p_offset],
              )
            ).rows[0].result
          if (name === 'analysis_dataset_version_flags')
            return (
              await migrator.query(
                `SELECT api.analysis_dataset_version_flags($1) AS result`,
                [args.p_dataset_version_id],
              )
            ).rows[0].result
          throw new Error(`Unexpected RPC ${name}`)
        },
      } as DataClient
      const rebuilt = await fetchFrozenAnalysisRows(
        client,
        pin.datasetVersionId,
        pin.rowCount,
        frozen.exclusionPolicy,
      )
      expect(rebuilt.matchesProvenance).toBe(true)
      const result = runAnalysis(
        frozen.definition,
        frozen.columns.map((c) => ({
          id: c.fieldId,
          label: c.label,
          logicalType: c.logicalType,
        })),
        rebuilt.rows,
        rebuilt.flags,
      )
      expect(
        result.ok &&
          result.result.kind === 'descriptive' &&
          result.result.rows[0].stats.n,
      ).toBe(100000)
      expect(
        result.ok &&
          result.result.kind === 'descriptive' &&
          result.result.rows[0].stats.mean,
      ).toBe(150008.5)
    } finally {
      await migrator.query('ROLLBACK')
    }
  }, 120_000)

  it('pins the examined snapshot and schema, and replays the explicit flag policy after live changes', async () => {
    await migrator.query('BEGIN')
    try {
      const row = await migrator.query(
        `SELECT row_id FROM api.dataset_row_values WHERE field_id=$1 AND numeric_value=5`,
        [fieldRecovery],
      )
      const outlier = row.rows[0].row_id
      await migrator.query(
        `UPDATE api.dataset_row_values SET numeric_value=100 WHERE row_id=$1 AND field_id=$2`,
        [outlier, fieldRecovery],
      )
      await migrator.query(
        `SELECT api.flag_dataset_value($1,$2,$3,'out_of_range','Rejected outlier',NULL)`,
        [datasetId, outlier, fieldRecovery],
      )
      const other = await migrator.query(
        `SELECT row_id FROM api.dataset_row_values WHERE field_id=$1 AND numeric_value=1`,
        [fieldRecovery],
      )
      await migrator.query(
        `SELECT api.flag_dataset_value($1,$2,$3,'out_of_range','Unrelated field',NULL)`,
        [datasetId, other.rows[0].row_id, fieldBatch],
      )
      const id = await definitionWith('Flag policy', {
        kind: 'descriptive',
        value: { fieldId: fieldRecovery },
      })
      const live: FrozenAnalysis = (
        await freeze(await insertAnalysisBlock({ definitionId: id }))
      ).payload.frozen
      expect(live.exclusionPolicy).toBe('exclude_bound_fields')
      const pin = live.datasetProvenance[0]
      const selected = [{ datasetId, datasetVersionId: pin.datasetVersionId }]
      const selectedId = await definitionWith('Selected snapshot', {
        kind: 'descriptive',
        value: { fieldId: fieldRecovery },
        datasets: selected,
        chart: chartSpec({ datasets: selected }),
      })

      // Advance the live schema instead of mutating immutable historical fields.
      const next = await migrator.query(
        `INSERT INTO api.dataset_schema_versions(schema_id,version,lifecycle)
        SELECT sv.schema_id,2,'draft' FROM api.datasets d JOIN api.dataset_schema_versions sv ON sv.id=d.schema_version_id WHERE d.id=$1 RETURNING id`,
        [datasetId],
      )
      const nextSchema = next.rows[0].id
      await migrator.query(
        `INSERT INTO api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,display_order,quantity)
        SELECT $2,field_id,key,'Changed ' || label,logical_type,display_order,'{"kind":"concentration","dimension":"mass/volume","storageUnit":"mg/L"}'::jsonb
        FROM api.dataset_schema_version_fields WHERE schema_version_id=(SELECT schema_version_id FROM api.datasets WHERE id=$1)`,
        [datasetId, nextSchema],
      )
      await migrator.query(
        `UPDATE api.dataset_schema_versions SET lifecycle='active' WHERE id=$1`,
        [nextSchema],
      )
      await migrator.query(
        `UPDATE api.datasets SET schema_version_id=$2 WHERE id=$1`,
        [datasetId, nextSchema],
      )
      await migrator.query(
        `UPDATE api.dataset_row_values SET numeric_value=numeric_value*10 WHERE field_id=$1`,
        [fieldRecovery],
      )
      await migrator.query(
        `UPDATE api.dataset_value_flags SET cleared_at=now() WHERE dataset_id=$1`,
        [datasetId],
      )

      const snapshot: FrozenAnalysis = (
        await freeze(await insertAnalysisBlock({ definitionId: selectedId }))
      ).payload.frozen
      expect(snapshot.exclusionPolicy).toBe('include_flagged')
      expect(snapshot.datasetProvenance[0]).toMatchObject({
        datasetVersionId: pin.datasetVersionId,
        schemaVersionNumber: pin.schemaVersionNumber,
        sourceDatasetRevision: pin.sourceDatasetRevision,
        rowCount: 3,
      })
      expect(
        snapshot.columns.find((c) => c.fieldId === fieldRecovery),
      ).toMatchObject({ label: 'Recovery', unit: null })
      const page = (
        await migrator.query(
          `SELECT api.query_dataset_version_rows($1,1000,0) AS page`,
          [pin.datasetVersionId],
        )
      ).rows[0].page
      const rows = page.rows.map(
        (r: { rowId: string; values: Record<string, unknown> }) => ({
          ...r.values,
          __sheetbaseRowId: r.rowId,
        }),
      )
      const flags: DatasetValueFlag[] = (
        await migrator.query(
          `SELECT api.analysis_dataset_version_flags($1) AS flags`,
          [pin.datasetVersionId],
        )
      ).rows[0].flags
      expect(flags.find((f) => f.rowId === outlier)?.reason).toBe(
        'Rejected outlier',
      )
      const columns = snapshot.columns.map((c) => ({
        id: c.fieldId,
        label: c.label,
        logicalType: c.logicalType,
        unit: c.unit,
      }))
      const excluded = runAnalysis(live.definition, columns, rows, flags)
      const included = runAnalysis(snapshot.definition, columns, rows)
      expect(
        excluded.ok &&
          excluded.result.kind === 'descriptive' &&
          excluded.result.rows[0].stats.mean,
      ).toBe(2)
      expect(
        included.ok &&
          included.result.kind === 'descriptive' &&
          included.result.rows[0].stats.mean,
      ).toBeCloseTo(104 / 3)

      const chartBlock = (
        await migrator.query(
          `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
        VALUES ($1,'chart',$2,$3,$4) RETURNING *`,
          [
            experimentId,
            {
              title: 'Selected snapshot',
              spec: chartSpec({ datasets: selected }),
            },
            ++blockOrder,
            USER_A,
          ],
        )
      ).rows[0]
      const chart = (
        await migrator.query(`SELECT * FROM api.freeze_chart($1,$2)`, [
          chartBlock.id,
          chartBlock.version,
        ])
      ).rows[0].payload.frozen
      expect(chart.datasetProvenance[0].datasetVersionId).toBe(
        pin.datasetVersionId,
      )
      expect(
        chart.data.columns.find(
          (c: { fieldId: string }) => c.fieldId === fieldRecovery,
        ).label,
      ).toBe('Recovery')
      expect(chart.exclusionPolicy).toBe('include_flagged')

      const denied = await asRole('authenticator')
      clients.push(denied)
      await denied.query('SET ROLE authenticated')
      await denied.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
        JSON.stringify({
          sub: USER_A,
          workspace_id: crypto.randomUUID(),
          role: 'authenticated',
        }),
      ])
      await expect(
        denied.query(`SELECT api.analysis_dataset_version_flags($1)`, [
          pin.datasetVersionId,
        ]),
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await migrator.query('ROLLBACK')
    }
  })

  it('freezes a statistic alone exactly as before', async () => {
    const block = await insertAnalysisBlock({})
    const frozen = (await freeze(block)).payload.frozen
    expect(frozen.definition.kind).toBe('regression')
    expect(
      frozen.columns.map((c: { fieldId: string }) => c.fieldId).sort(),
    ).toEqual([fieldRecovery, fieldTime].sort())
    expect(frozen.methodVersion).toBe(ANALYSIS_METHOD_VERSION)
    expect(frozen.datasetProvenance[0].rowCount).toBe(3)
  })

  it('freezes a statistic with a chart, covering the chart fields too', async () => {
    const id = await definitionWith('Statistic with chart', {
      ...statistic(),
      chart: chartSpec(),
    })
    const block = await insertAnalysisBlock({ definitionId: id })
    const frozen = (await freeze(block)).payload.frozen
    expect(frozen.definition.chart.type).toBe('scatter')
    expect(
      frozen.columns.map((c: { fieldId: string }) => c.fieldId).sort(),
    ).toEqual([fieldBatch, fieldRecovery, fieldTime].sort())
    const counts = await migrator.query(
      `SELECT count(*) AS n FROM api.dataset_version_values WHERE dataset_version_id=$1`,
      [frozen.datasetProvenance[0].datasetVersionId],
    )
    expect(Number(counts.rows[0].n)).toBe(9)
  })

  it('freezes a chart on its own', async () => {
    const id = await definitionWith('Chart only', {
      kind: 'chart',
      chart: chartSpec({
        fields: {
          x: { fieldId: fieldTime },
          y: { fieldId: fieldRecovery },
          series: null,
          color: null,
          size: null,
          facet: null,
        },
      }),
    })
    const block = await insertAnalysisBlock({ definitionId: id })
    const frozen = (await freeze(block)).payload.frozen
    expect(frozen.definition.kind).toBe('chart')
    expect(
      frozen.columns.map((c: { fieldId: string }) => c.fieldId).sort(),
    ).toEqual([fieldRecovery, fieldTime].sort())
    expect(frozen.datasetProvenance).toHaveLength(1)
  })

  it('changes the checksum when only a chart field changes', async () => {
    const withBatch = await definitionWith('Checksum with batch', {
      ...statistic(),
      chart: chartSpec(),
    })
    const without = await definitionWith('Checksum without batch', statistic())
    const a = (
      await freeze(await insertAnalysisBlock({ definitionId: withBatch }))
    ).payload.frozen
    const b = (
      await freeze(await insertAnalysisBlock({ definitionId: without }))
    ).payload.frozen
    expect(a.datasetProvenance[0].checksum).not.toBe(
      b.datasetProvenance[0].checksum,
    )
  })

  it('refuses a chart that reads another dataset or version than the analysis', async () => {
    const other = await insertCanonicalDataset(`other_${Date.now()}`, 3)
    const id = await definitionWith('Chart elsewhere', {
      ...statistic(),
      chart: chartSpec({ datasets: [{ datasetId: other }] }),
    })
    const block = await insertAnalysisBlock({ definitionId: id })
    await expect(freeze(block)).rejects.toMatchObject({ code: '23514' })
    const mismatchedVersion = await definitionWith('Chart version elsewhere', {
      ...statistic(),
      chart: chartSpec({
        datasets: [{ datasetId, datasetVersionId: crypto.randomUUID() }],
      }),
    })
    await expect(
      freeze(await insertAnalysisBlock({ definitionId: mismatchedVersion })),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('refuses a chart-only analysis that carries no chart', async () => {
    const id = await definitionWith('Chart missing', { kind: 'chart' })
    const block = await insertAnalysisBlock({ definitionId: id })
    await expect(freeze(block)).rejects.toMatchObject({ code: '23514' })
  })

  it('keeps frozen evidence valid and immutable when the live definition and dataset move on', async () => {
    const id = await definitionWith('Moves on', {
      ...statistic(),
      chart: chartSpec(),
    })
    const block = await insertAnalysisBlock({ definitionId: id })
    const frozenBlock = await freeze(block)
    const pinned = frozenBlock.payload.frozen

    // The saved definition is edited and the dataset gains a row afterwards.
    await migrator.query(
      `UPDATE api.analysis_definitions SET definition=jsonb_set(definition,'{chart,type}','"line"') WHERE id=$1`,
      [id],
    )
    const row = await migrator.query(
      `INSERT INTO api.dataset_rows(dataset_id,workspace_id) VALUES ($1,$2) RETURNING id`,
      [datasetId, WS_A],
    )
    await migrator.query(
      `INSERT INTO api.dataset_row_values(row_id,field_id,numeric_value) VALUES ($1,$2,72)`,
      [row.rows[0].id, fieldTime],
    )

    const reread = await migrator.query(
      `SELECT payload FROM api.blocks WHERE id=$1`,
      [block.id],
    )
    expect(reread.rows[0].payload.frozen).toEqual(pinned)
    expect(reread.rows[0].payload.frozen.definition.chart.type).toBe('scatter')
    const version = await migrator.query(
      `SELECT count(*) AS n FROM api.dataset_version_rows WHERE dataset_version_id=$1`,
      [pinned.datasetProvenance[0].datasetVersionId],
    )
    expect(Number(version.rows[0].n)).toBe(pinned.datasetProvenance[0].rowCount)

    // A direct edit of a frozen block's payload is refused.
    await expect(
      migrator.query(
        `UPDATE api.blocks SET payload=jsonb_set(payload,'{title}','"Edited"') WHERE id=$1`,
        [block.id],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('leaves existing chart blocks valid and freezable', async () => {
    const res = await migrator.query(
      `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
       VALUES ($1,'chart',$2::jsonb,$4,$3) RETURNING *`,
      [
        experimentId,
        JSON.stringify({
          title: 'Legacy chart',
          spec: chartSpec({
            type: 'line',
            fields: {
              x: { fieldId: fieldTime },
              y: { fieldId: fieldRecovery },
              series: null,
              color: null,
              size: null,
              facet: null,
            },
            display: {
              axes: { x: { scale: 'linear' }, y: { scale: 'linear' } },
              series: [],
              legend: { visible: true },
            },
          }),
          frozen: null,
        }),
        USER_A,
        ++blockOrder,
      ],
    )
    const frozen = await migrator.query(
      `SELECT * FROM api.freeze_chart($1,$2)`,
      [res.rows[0].id, res.rows[0].version],
    )
    expect(frozen.rows[0].payload.frozen).toBeTruthy()
  })
})

describe('compose_analysis_definition', () => {
  async function member(user: string) {
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('SET ROLE authenticated')
    await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: user, workspace_id: WS_A, role: 'authenticated' }),
    ])
    return client
  }

  async function viewWith(name: string, spec: unknown) {
    const res = await migrator.query(
      `INSERT INTO api.analysis_views(workspace_id,owner_user_id,name,spec,source_revisions)
       VALUES ($1,$2,$3,$4::jsonb,'[]'::jsonb) RETURNING id`,
      [WS_A, USER_A, `${name} ${Date.now()}`, JSON.stringify(spec)],
    )
    return res.rows[0].id as string
  }

  it('makes a chart-only definition from a saved chart view, owned by the caller', async () => {
    const viewId = await viewWith('Compose view', chartSpec())
    const owner = await member(USER_A)
    const res = await owner.query(
      `SELECT * FROM api.compose_analysis_definition($1,NULL,$2)`,
      [viewId, `Composed chart ${Date.now()}`],
    )
    const row = res.rows[0]
    expect(row.owner_user_id).toBe(USER_A)
    expect(row.definition.kind).toBe('chart')
    expect(row.definition.datasets).toEqual([{ datasetId }])
    expect(row.definition.chart.type).toBe('scatter')
  })

  it('keeps the snapshot a chart is pinned to (migration 0554)', async () => {
    const versionId = crypto.randomUUID()
    const spec = chartSpec() as { datasets: Array<Record<string, unknown>> }
    spec.datasets[0] = { ...spec.datasets[0], datasetVersionId: versionId }
    const viewId = await viewWith('Compose pinned', spec)
    const owner = await member(USER_A)
    const res = await owner.query(
      `SELECT * FROM api.compose_analysis_definition($1,NULL,$2)`,
      [viewId, `Composed pinned ${Date.now()}`],
    )
    expect(res.rows[0].definition.datasets).toEqual([
      { datasetId, datasetVersionId: versionId },
    ])
    // A statistic that reads the live dataset cannot take a snapshot chart.
    const statisticId = await definitionWith('Compose live', statistic())
    await expect(
      owner.query(`SELECT * FROM api.compose_analysis_definition($1,$2,$3)`, [
        viewId,
        statisticId,
        `Composed mixed ${Date.now()}`,
      ]),
    ).rejects.toThrow(/must read the dataset/)
  })

  it('puts the chart beside a statistic and leaves the statistic untouched', async () => {
    const viewId = await viewWith('Compose both', chartSpec())
    const statisticId = await definitionWith('Compose statistic', statistic())
    const owner = await member(USER_A)
    const res = await owner.query(
      `SELECT * FROM api.compose_analysis_definition($1,$2,$3)`,
      [viewId, statisticId, `Composed both ${Date.now()}`],
    )
    expect(res.rows[0].definition.kind).toBe('regression')
    expect(res.rows[0].definition.chart.type).toBe('scatter')
    const original = await migrator.query(
      `SELECT definition FROM api.analysis_definitions WHERE id=$1`,
      [statisticId],
    )
    expect(original.rows[0].definition.chart).toBeUndefined()
  })

  it('refuses a chart on another dataset, a multi-dataset chart and a missing name', async () => {
    const other = await insertCanonicalDataset(`compose_other_${Date.now()}`, 3)
    const elsewhere = await viewWith(
      'Compose elsewhere',
      chartSpec({ datasets: [{ datasetId: other }] }),
    )
    const two = await viewWith(
      'Compose two',
      chartSpec({ datasets: [{ datasetId }, { datasetId: other }] }),
    )
    const statisticId = await definitionWith('Compose mismatch', statistic())
    const owner = await member(USER_A)
    await expect(
      owner.query(`SELECT * FROM api.compose_analysis_definition($1,$2,$3)`, [
        elsewhere,
        statisticId,
        `Never saved ${Date.now()}`,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      owner.query(`SELECT * FROM api.compose_analysis_definition($1,NULL,$2)`, [
        two,
        `Never saved two ${Date.now()}`,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      owner.query(
        `SELECT * FROM api.compose_analysis_definition($1,NULL,'  ')`,
        [elsewhere],
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('refuses a view or an analysis the caller cannot see', async () => {
    const outsider = `mab-outsider-${crypto.randomUUID().slice(0, 8)}`
    await migrator.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,'Outsider',$2,true)`,
      [outsider, `${outsider}@sheetbase.test`],
    )
    const viewId = await viewWith('Compose hidden', chartSpec())
    const stranger = await asRole('authenticator')
    clients.push(stranger)
    await stranger.query('SET ROLE authenticated')
    await stranger.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({
        sub: outsider,
        workspace_id: crypto.randomUUID(),
        role: 'authenticated',
      }),
    ])
    await expect(
      stranger.query(
        `SELECT * FROM api.compose_analysis_definition($1,NULL,$2)`,
        [viewId, `Hidden ${Date.now()}`],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
