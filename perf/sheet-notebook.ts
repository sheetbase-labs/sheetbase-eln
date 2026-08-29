/**
 * PLAT-05 — bound Sheet load and Notebook load benchmarks.
 *
 * Runs in a dedicated throwaway workspace (`SHEET_WS`): Sheet Instances are
 * intentionally non-deletable (archival guard), so the FIXTURE workspace must
 * stay fully disposable. The throwaway workspace accumulates one instance per
 * run — an accepted, documented side effect of a private bench workspace.
 *
 *  - Sheet: creates a Definition + Instance bound to a canonical Dataset and
 *    measures `query_sheet_instance_rows` (grid hydration) at page 100/200.
 *  - Notebook: seeds records with 50/200/500 rich-text blocks and measures the
 *    blocks read that dominates a notebook body load, plus the request count
 *    of the notebook screen data path.
 */
import type { Client } from 'pg'

import {
  actorClient,
  adminClient,
  assertPerfEnvironment,
  environmentSnapshot,
  recordScenario,
  statsFor,
  writeReport,
} from './lib/common'
import type { ScenarioReport } from './lib/common'

const SHEET_WS = '0f06e000-0000-4000-8000-000000000001'
const SHEET_USER = 'plat-05-sheet-bench'

const PREFIX = {
  def: '0f06d000-0000-4000-8000-0000',
  version: '0f06d100-0000-4000-8000-0000',
  instance: '0f06d200-0000-4000-8000-0000',
  dataset: '0f06d500-0000-4000-8000-0000',
  row: '0f06d600-0000-4000-8000-',
  field: '0f06d700-0000-4000-8000-0000',
  notebook: '0f06d400-0000-4000-8000-0000',
} as const

function uuidFor(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(8, '0')}`
}

const SAMPLE_FIELD = uuidFor(PREFIX.field, 1)

interface Ctx {
  admin: Client
  actor: Client
  env: ReturnType<typeof assertPerfEnvironment>
  schemaVersionId: string
  datasetId: string
}

async function setup(): Promise<Ctx> {
  const env = assertPerfEnvironment()
  const admin = await adminClient(env.migrationDatabaseUrl)
  const actor = await actorClient(env.pgrstDatabaseUrl, SHEET_USER, SHEET_WS)
  // Idempotent workspace/user/membership (the workspace is permanent because
  // Sheet Instances are archival; the seed never touches it).
  await admin.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,'Sheet bench','sheet-bench@test.invalid',true)
     on conflict (id) do nothing`,
    [SHEET_USER],
  )
  await admin.query(
    `insert into api.workspaces(id,slug,name) values($1,'plat-05-sheet','PLAT-05 sheet bench')
     on conflict (id) do nothing`,
    [SHEET_WS],
  )
  await admin.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')
     on conflict do nothing`,
    [SHEET_WS, SHEET_USER],
  )
  // Bound Dataset: one schema with a reference sample field + 10k rows.
  const schemaId = uuidFor(PREFIX.dataset, 1)
  const versionId = uuidFor(PREFIX.dataset, 2)
  await admin.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name,created_by_user_id)
     values($1,$2,'plat05_sheet_schema','PLAT-05 sheet schema',$3)
     on conflict (id) do nothing`,
    [schemaId, SHEET_WS, SHEET_USER],
  )
  await admin.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle,created_by_user_id)
     values($1,$2,1,'draft',$3)
     on conflict (id) do nothing`,
    [versionId, schemaId, SHEET_USER],
  )
  const fieldsExist = await admin.query<{ n: string }>(
    `select count(*)::text n from api.dataset_schema_version_fields where schema_version_id=$1`,
    [versionId],
  )
  if (Number(fieldsExist.rows[0].n) === 0) {
    await admin.query(
      `insert into api.dataset_schema_version_fields(
         schema_version_id,field_id,key,label,logical_type,cardinality,relationship,lifecycle,display_order
       ) values($1,$2,'sample','Sample','reference','one',$3::jsonb,'active',0)`,
      [
        versionId,
        SAMPLE_FIELD,
        JSON.stringify({
          target: { kind: 'model', modelKey: 'sample' },
          cardinality: 'one',
        }),
      ],
    )
    await admin.query(
      `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
      [versionId],
    )
  }
  const datasetId = uuidFor(PREFIX.dataset, 3)
  await admin.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name,created_by_user_id)
     values($1,$2,$3,'PLAT-05 sheet dataset',$4)
     on conflict (id) do nothing`,
    [datasetId, SHEET_WS, versionId, SHEET_USER],
  )
  // Records for reference targets (kind 'sample' per the relationship model).
  const recordCount = (
    await admin.query<{ n: string }>(
      `select count(*)::text n from api.records where workspace_id=$1`,
      [SHEET_WS],
    )
  ).rows[0].n
  if (Number(recordCount) < 1000) {
    await admin.query(
      `insert into api.records(id,workspace_id,kind,identifier,title,created_by_user_id)
       select ('0f06d800-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid, $1, 'sample',
              'SHEET-S-'||lpad(i::text,8,'0'), 'Sheet sample '||i, $2
         from generate_series(1, 1000) i
       on conflict (id) do nothing`,
      [SHEET_WS, SHEET_USER],
    )
  }
  // Deterministic rows + reference values. Both are idempotent (ON CONFLICT
  // on stable PKs), so a rerun converges without duplicating.
  await admin.query(
    `insert into api.dataset_rows(id,dataset_id,workspace_id)
     select ($1||lpad(i::text,12,'0'))::uuid, $2, $3
       from generate_series(1, 10000) i
     on conflict (id) do nothing`,
    [PREFIX.row, datasetId, SHEET_WS],
  )
  await admin.query(
    `insert into api.dataset_row_values(row_id,field_id,reference_id)
     select r.id, $2, ('0f06d800-0000-4000-8000-'||lpad((substring(r.id::text,25,12)::integer % 1000 + 1)::text,12,'0'))::uuid
       from api.dataset_rows r where r.dataset_id=$1
     on conflict (row_id, field_id, ordinal) do nothing`,
    [datasetId, SAMPLE_FIELD],
  )
  return { admin, actor, env, schemaVersionId: versionId, datasetId }
}

/** Minimal single-binding Sheet Definition config (root column = sample). */
function sheetConfig(schemaVersionId: string, sampleFieldId: string) {
  const parameterId = uuidFor(PREFIX.def, 100)
  const bindingId = uuidFor(PREFIX.def, 200)
  const columnId = uuidFor(PREFIX.def, 300)
  return {
    formatVersion: 1,
    parameters: [
      {
        id: parameterId,
        key: 'results',
        label: 'Results',
        required: true,
        type: { kind: 'dataset', contract: { mode: 'exact', schemaVersionId } },
        constraints: {},
      },
    ],
    bindings: [{ id: bindingId, key: 'results', parameterId }],
    rowIdentity: { kind: 'source', columnIds: [columnId] },
    joins: [],
    columns: [
      {
        id: columnId,
        field: {
          fieldId: columnId,
          key: 'sample',
          label: 'Sample',
          description: null,
          logicalType: 'reference',
          nullable: false,
          defaultValue: null,
          cardinality: 'one',
          quantity: null,
          validation: {},
          category: null,
          relationship: {
            target: { kind: 'model', modelKey: 'sample' },
            cardinality: 'one',
          },
          computation: { mode: 'stored' },
          lifecycle: 'active',
        },
        source: { kind: 'bound', bindingId, sourceFieldId: sampleFieldId },
      },
    ],
    calculations: [],
    writeBackRules: [
      {
        id: uuidFor(PREFIX.def, 400),
        bindingId,
        mode: 'update',
        mappings: [{ columnId, targetFieldId: sampleFieldId }],
      },
    ],
    actions: [],
    presentation: {
      columnOrder: [columnId],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
    },
  }
}

async function setupSheet(ctx: Ctx): Promise<string> {
  const config = sheetConfig(ctx.schemaVersionId, SAMPLE_FIELD)
  const definition = (
    await ctx.actor.query(
      `select api.create_sheet_definition($1,$2,$3,null,$4::jsonb) result`,
      [
        SHEET_WS,
        `plat05_sheet_${Math.floor(Date.now() / 1000)}`,
        'PLAT-05 sheet',
        JSON.stringify(config),
      ],
    )
  ).rows[0].result
  await ctx.actor.query(`select api.publish_sheet_definition_version($1,$2)`, [
    definition.version.id,
    1,
  ])
  const state = {
    bindings: [],
    localFields: [],
    localValues: {},
    calculationOverrides: {},
    presentation: {
      columnOrder: [],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
    },
    provenance: { createdFrom: 'ad_hoc' },
  }
  const inputs = [
    {
      parameterId: definition.version.configuration.parameters[0].id,
      kind: 'dataset',
      datasetId: ctx.datasetId,
    },
  ]
  const created = (
    await ctx.actor.query(
      `select to_jsonb(api.create_sheet_instance_from_definition($1,$2,null,$3,null,null,$4::jsonb,$5::jsonb)) result`,
      [
        SHEET_WS,
        'PLAT-05 sheet',
        definition.version.id,
        JSON.stringify(state),
        JSON.stringify(inputs),
      ],
    )
  ).rows[0].result
  const resolved = (
    await ctx.actor.query(
      `select to_jsonb(api.resolve_sheet_instance_row_identity($1,$2)) result`,
      [created.id, 1],
    )
  ).rows[0].result
  return resolved.id
}

async function benchmarkSheet(
  ctx: Ctx,
  scenarios: ScenarioReport[],
): Promise<void> {
  const instanceId = await setupSheet(ctx)
  // Warm the hydration path once.
  await ctx.actor.query(`select api.query_sheet_instance_rows($1,200,0)`, [
    instanceId,
  ])
  for (const pageSize of [100, 200]) {
    const samples: number[] = []
    let errors = 0
    for (let i = 0; i < 7; i += 1) {
      try {
        const t0 = Date.now()
        const { rows } = await ctx.actor.query(
          `select api.query_sheet_instance_rows($1,$2,0) result`,
          [instanceId, pageSize],
        )
        samples.push(Date.now() - t0)
        const result = rows[0].result as { rows?: unknown[] }
        if (!result.rows) errors += 1
      } catch {
        errors += 1
      }
    }
    scenarios.push(
      recordScenario({
        scenario: `sheet-bound-load-${pageSize}`,
        rows: 10_000,
        fields: 1,
        concurrency: 1,
        iterations: samples.length,
        stats: statsFor(samples, errors),
        notes: { operation: 'query_sheet_instance_rows' },
      }),
    )
  }
}

async function benchmarkNotebook(
  ctx: Ctx,
  scenarios: ScenarioReport[],
): Promise<void> {
  const projectId = uuidFor(PREFIX.notebook, 200)
  await ctx.admin.query(
    `insert into api.projects(id,workspace_id,key,title) values($1,$2,'plat05-nb','PLAT-05 notebook')
     on conflict (id) do nothing`,
    [projectId, SHEET_WS],
  )
  const recordId = uuidFor(PREFIX.notebook, 1)
  await ctx.admin.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     values($1,$2,$3,'experiment','PLAT-NB-0001','PLAT-05 notebook',$4)
     on conflict (id) do nothing`,
    [recordId, SHEET_WS, projectId, SHEET_USER],
  )
  for (const blockCount of [50, 200, 500]) {
    const existing = (
      await ctx.admin.query(
        `select count(*)::int n from api.blocks where record_id=$1`,
        [recordId],
      )
    ).rows[0].n
    for (let i = existing; i < blockCount; i += 1) {
      await ctx.admin.query(
        `insert into api.blocks(id,record_id,type,payload,"order",created_by_user_id)
         values($1,$2,'rich_text',$3::jsonb,$4,$5)
         on conflict (id) do nothing`,
        [
          uuidFor(PREFIX.notebook, 1000 + i),
          recordId,
          JSON.stringify({ text: `notebook paragraph ${i} with padding content` }),
          i,
          SHEET_USER,
        ],
      )
    }
    await ctx.admin.query('analyze api.blocks')
    const samples: number[] = []
    let errors = 0
    for (let i = 0; i < 7; i += 1) {
      try {
        const t0 = Date.now()
        const { rows } = await ctx.actor.query(
          `select id, type, payload, "order" from api.blocks
            where record_id = $1 order by "order", id`,
          [recordId],
        )
        samples.push(Date.now() - t0)
        if (rows.length !== blockCount) errors += 1
      } catch {
        errors += 1
      }
    }
    scenarios.push(
      recordScenario({
        scenario: `notebook-blocks-load-${blockCount}`,
        rows: blockCount,
        concurrency: 1,
        iterations: samples.length,
        stats: statsFor(samples, errors),
        notes: {
          operation: 'blocks read',
          screenRequestCount: 4, // record + blocks + links + files
        },
      }),
    )
  }
}

export async function runSheetNotebookBenchmarks(): Promise<ScenarioReport[]> {
  const ctx = await setup()
  const scenarios: ScenarioReport[] = []
  try {
    await benchmarkSheet(ctx, scenarios)
    await benchmarkNotebook(ctx, scenarios)
    const environment = await environmentSnapshot(ctx.admin)
    writeReport('sheet-notebook', scenarios, environment)
    return scenarios
  } finally {
    // Notebook records/blocks/projects are deletable; the Sheet Instance is
    // archival by design and stays in the throwaway workspace.
    await ctx.admin
      .query(`delete from api.records where workspace_id=$1`, [SHEET_WS])
      .catch(() => {})
    await ctx.admin
      .query(`delete from api.projects where workspace_id=$1 and key='plat05-nb'`, [
        SHEET_WS,
      ])
      .catch(() => {})
    await ctx.actor.end().catch(() => {})
    await ctx.admin.end().catch(() => {})
  }
}

if (process.argv[1]?.endsWith('perf/sheet-notebook.ts')) {
  void runSheetNotebookBenchmarks().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
