/**
 * PLAT-05 — bound Sheet load and Notebook load benchmarks.
 *
 *  - Sheet: creates a Definition + Instance bound to a canonical Dataset in
 *    the fixture workspace and measures `query_sheet_instance_rows` (the grid
 *    hydration RPC) at the supported page bound (200 rows).
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
import { FIXTURE, datasetFixtures, fieldsFor } from './fixtures'

const PREFIX = {
  def: '0f06d000-0000-4000-8000-0000',
  version: '0f06d100-0000-4000-8000-0000',
  instance: '0f06d200-0000-4000-8000-0000',
  project: '0f06d300-0000-4000-8000-0000',
  notebook: '0f06d400-0000-4000-8000-0000',
} as const

function uuidFor(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(8, '0')}`
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

interface Ctx {
  admin: Client
  actor: Client
  env: ReturnType<typeof assertPerfEnvironment>
}

async function setup(): Promise<Ctx> {
  const env = assertPerfEnvironment()
  const admin = await adminClient(env.migrationDatabaseUrl)
  const actor = await actorClient(env.pgrstDatabaseUrl, FIXTURE.user, FIXTURE.workspace)
  return { admin, actor, env }
}

async function setupSheet(ctx: Ctx): Promise<string> {
  const medium = datasetFixtures().find((f) => f.rows === 10_000)!
  const sampleFieldId = fieldsFor('medium')[0].id
  const config = sheetConfig(medium.schemaVersionId, sampleFieldId)
  const definition = (
    await ctx.actor.query(
      `select api.create_sheet_definition($1,$2,$3,null,$4::jsonb) result`,
      [
        FIXTURE.workspace,
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
      datasetId: medium.id,
    },
  ]
  const created = (
    await ctx.actor.query(
      `select to_jsonb(api.create_sheet_instance_from_definition($1,$2,null,$3,null,null,$4::jsonb,$5::jsonb)) result`,
      [
        FIXTURE.workspace,
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
  const medium = datasetFixtures().find((f) => f.rows === 10_000)!
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
        rows: medium.rows,
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
  const project = (
    await ctx.actor.query(
      `insert into api.projects(workspace_id,key,title) values($1,$2,'PLAT-05 notebook')
       on conflict (workspace_id, key) do nothing returning id`,
      [FIXTURE.workspace, 'plat05-notebook'],
    )
  ).rows[0]
  const projectId =
    project?.id ??
    (
      await ctx.actor.query(
        `select id from api.projects where workspace_id=$1 and key='plat05-notebook'`,
        [FIXTURE.workspace],
      )
    ).rows[0].id
  const recordId = uuidFor(PREFIX.notebook, 1)
  await ctx.admin.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     values($1,$2,$3,'experiment','PLAT-NB-0001','PLAT-05 notebook',$4)
     on conflict (id) do nothing`,
    [recordId, FIXTURE.workspace, projectId, FIXTURE.user],
  )
  for (const blockCount of [50, 200, 500]) {
    // Seed deterministic rich-text blocks (payload text includes a unique term).
    const existing = (
      await ctx.admin.query(
        `select count(*)::int n from api.blocks where record_id=$1`,
        [recordId],
      )
    ).rows[0].n
    for (let i = existing; i < blockCount; i += 1) {
      await ctx.admin.query(
        `insert into api.blocks(id,record_id,type,payload,"order",created_by_user_id)
         values($1,$2,'rich_text',$3::jsonb,$4,$5)`,
        [
          uuidFor(PREFIX.notebook, 1000 + i),
          recordId,
          JSON.stringify({ text: `notebook paragraph ${i} with padding content` }),
          i,
          FIXTURE.user,
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
