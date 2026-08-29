/**
 * PLAT-05 — Pipeline stage, concurrency, scheduler-scale and event-burst
 * benchmarks. Exercises the real server executor (`runPipelineExecution`) and
 * the real scheduler sweep (`sweepPipelines`) against the seeded fixture
 * workspace, with stage durations read back from each run's result.
 */
import './lib/loadenv'
import { Client } from 'pg'
import type { QueryResultRow } from 'pg'

import { runPipelineExecution } from '#/lib/pipeline-execute.server'
import { sweepPipelines } from '#/lib/pipeline-scheduler.server'
import type {
  PipelineExecuteDeps,
  ExecConnection,
} from '#/lib/pipeline-execute.server'
import type {
  PipelineSchedulerDeps,
  SchedulerConnection,
} from '#/lib/pipeline-scheduler.server'

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
import { FIXTURE, datasetFixtures, seedSchedules } from './fixtures'

const RPC_ARG_TYPES: Record<string, string[]> = {
  start_pipeline_run: [
    'uuid',
    'uuid',
    'text',
    'jsonb',
    'jsonb',
    'uuid',
    'text',
    'uuid',
  ],
}

async function rpc<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const types = RPC_ARG_TYPES[name]
  const values = Object.values(args).map((value, index) =>
    value !== null && types[index] === 'jsonb' ? JSON.stringify(value) : value,
  )
  while (values.length < types.length) values.push(null)
  const placeholders = types
    .map((type, index) => `$${index + 1}::${type}`)
    .join(',')
  const { rows } = await client.query(
    `select * from api.${name}(${placeholders})`,
    values,
  )
  const row = rows[0]
  if (!row) return undefined as T
  const keys = Object.keys(row)
  if (keys.length === 1) {
    const value = row[keys[0]]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as T
    }
  }
  return row as T
}

function execDeps(conn: Client): {
  deps: PipelineExecuteDeps
  close: () => Promise<void>
} {
  return {
    deps: {
      getSession: async () => ({ user: { id: FIXTURE.user } }),
      connect: async (): Promise<ExecConnection> => ({
        query: async <T extends QueryResultRow>(
          text: string,
          values: unknown[] = [],
        ) => conn.query<T>(text, values),
        begin: () => conn.query('BEGIN').then(() => undefined),
        commit: () => conn.query('COMMIT').then(() => undefined),
        rollback: () => conn.query('ROLLBACK').then(() => undefined),
        // The caller owns the connection lifecycle.
        end: () => Promise.resolve(),
      }),
    },
    close: async () => undefined,
  }
}

function schedulerDeps(
  conn: Client,
  runStub: (actor: string, runId: string) => Promise<unknown> = async () =>
    undefined,
): PipelineSchedulerDeps {
  return {
    connect: async (): Promise<SchedulerConnection> => ({
      query: async <T extends QueryResultRow>(
        text: string,
        values: unknown[] = [],
      ) => conn.query<T>(text, values),
      begin: () => conn.query('BEGIN').then(() => undefined),
      commit: () => conn.query('COMMIT').then(() => undefined),
      rollback: () => conn.query('ROLLBACK').then(() => undefined),
      end: () => Promise.resolve(),
    }),
    run: runStub,
  }
}

/** Start + execute one manual run; returns the finished report + stage ms. */
async function runOne(
  actor: Client,
  databaseUrl: string,
  factor: number,
  inputVersionId: string,
): Promise<{
  ok: boolean
  totalMs: number
  stages?: Record<string, number>
  rowCount?: number
  errorMessage?: string
}> {
  const run = await rpc<{ id: string; status: string }>(
    actor,
    'start_pipeline_run',
    {
      p_workspace_id: FIXTURE.workspace,
      p_definition_version_id: FIXTURE.pipeline.version,
      p_trigger_kind: 'manual',
      p_parameters: { factor },
      p_input_versions: { measurements: inputVersionId },
    },
  )
  if (run.status !== 'running') {
    // Digest replay of a prior identical run: not a fresh execution.
    return { ok: true, totalMs: 0 }
  }
  const conn = new Client({ connectionString: databaseUrl })
  await conn.connect()
  try {
    const startedAt = Date.now()
    const { deps, close } = execDeps(conn)
    const report = await runPipelineExecution(FIXTURE.user, run.id, deps)
    await close()
    const result = report.run?.result as
      | { stageDurationsMs?: Record<string, number>; rowCount?: number }
      | undefined
    return {
      ok: report.ok,
      totalMs: Date.now() - startedAt,
      stages: result?.stageDurationsMs,
      rowCount: result?.rowCount,
      errorMessage: report.errorMessage,
    }
  } finally {
    await conn.end().catch(() => {})
  }
}

interface PipelineContext {
  admin: Client
  actor: Client
  inputVersionId: string
  env: ReturnType<typeof assertPerfEnvironment>
}

async function context(): Promise<PipelineContext> {
  const env = assertPerfEnvironment()
  const admin = await adminClient(env.migrationDatabaseUrl)
  const actor = await actorClient(
    env.pgrstDatabaseUrl,
    FIXTURE.user,
    FIXTURE.workspace,
  )
  const fixture = datasetFixtures().find((f) => f.rows === 10_000)!
  return { admin, actor, inputVersionId: fixture.versionId, env }
}

async function closeContext(ctx: PipelineContext): Promise<void> {
  await ctx.actor.end().catch(() => {})
  await ctx.admin.end().catch(() => {})
}

/** Single-run stage profile at a given input size. */
async function stageBenchmark(
  ctx: PipelineContext,
  scenarios: ScenarioReport[],
  inputRows: number,
): Promise<void> {
  const fixture = datasetFixtures().find((f) => f.rows === inputRows)
  if (!fixture) return
  const inputVersionId = fixture.versionId
  const runs: Array<{
    total: number
    materialize: number
    transform: number
    output: number
    commit: number
    snapshot: number
    overhead: number
    rows: number
  }> = []
  // Warm run first (creates + populates the output schema path).
  await runOne(ctx.actor, ctx.env.databaseUrl, 1.001, inputVersionId)
  for (let index = 0; index < 3; index += 1) {
    const factor = 1.1 + index * 0.1
    const result = await runOne(
      ctx.actor,
      ctx.env.databaseUrl,
      factor,
      inputVersionId,
    )
    if (!result.ok) {
      throw new Error(
        `pipeline run failed: ${result.errorMessage ?? 'unknown'}`,
      )
    }
    if (!result.stages) {
      // Digest replay (same input+params as an earlier run): skip.
      continue
    }
    runs.push({
      total: result.totalMs,
      materialize: result.stages.materializeInputs,
      transform: result.stages.transform,
      output: result.stages.outputCommit,
      commit: result.stages.datasetCommit,
      snapshot: result.stages.datasetSnapshot,
      overhead: result.stages.outputOverhead ?? 0,
      rows: result.rowCount ?? 0,
    })
  }
  if (runs.length === 0) return
  const pick = (
    key:
      | 'materialize'
      | 'transform'
      | 'output'
      | 'commit'
      | 'snapshot'
      | 'overhead'
      | 'total',
  ) => runs.map((r) => r[key])
  const label = `${Math.round(inputRows / 1000)}k`
  for (const [stage, values] of Object.entries({
    materialize_inputs: pick('materialize'),
    transform: pick('transform'),
    output_commit: pick('output'),
    dataset_commit: pick('commit'),
    dataset_snapshot: pick('snapshot'),
    output_overhead: pick('overhead'),
    total: pick('total'),
  })) {
    scenarios.push(
      recordScenario({
        scenario: `pipeline-stage-${stage}-${label}`,
        rows: inputRows,
        concurrency: 1,
        iterations: values.length,
        stats: statsFor(values),
        notes: { stage },
      }),
    )
  }
}

/** Parallel manual runs at a given concurrency; reports wall-clock + tail. */
let concurrencySerial = 0
async function concurrencyBenchmark(
  ctx: PipelineContext,
  scenarios: ScenarioReport[],
  concurrency: number,
): Promise<void> {
  const inputVersionId = ctx.inputVersionId
  const workers = await Promise.all(
    Array.from({ length: concurrency }, () =>
      actorClient(ctx.env.pgrstDatabaseUrl, FIXTURE.user, FIXTURE.workspace),
    ),
  )
  try {
    const runOneBatch = async () => {
      const factors = Array.from({ length: concurrency }, () => {
        concurrencySerial += 1
        return 5 + concurrencySerial * 0.019
      })
      const startedAt = Date.now()
      const results = await Promise.all(
        factors.map((factor, index) =>
          runOne(workers[index], ctx.env.databaseUrl, factor, inputVersionId),
        ),
      )
      const wallMs = Date.now() - startedAt
      const failed = results.filter((r) => !r.ok)
      return { wallMs, failed: failed.length }
    }
    // Warm pass.
    await runOneBatch()
    const samples: number[] = []
    let errors = 0
    for (let i = 0; i < 3; i += 1) {
      const { wallMs, failed } = await runOneBatch()
      samples.push(wallMs)
      errors += failed
    }
    scenarios.push(
      recordScenario({
        scenario: `pipeline-concurrency-${concurrency}`,
        rows: 10_000,
        concurrency,
        iterations: samples.length,
        stats: statsFor(samples, errors),
      }),
    )
  } finally {
    await Promise.all(workers.map((w) => w.end().catch(() => {})))
  }
}

/** Sweep decision cost at 10/100/1000 schedules (interval, not due). */
async function schedulerScaleBenchmark(
  ctx: PipelineContext,
  scenarios: ScenarioReport[],
): Promise<void> {
  for (const count of [10, 100, 1000]) {
    const population = await seedSchedules(ctx.admin, count, 0)
    const deps = schedulerDeps(ctx.admin)
    // Warm once.
    await sweepPipelines(deps)
    const samples: number[] = []
    const errors = 0
    for (let i = 0; i < 3; i += 1) {
      const startedAt = Date.now()
      await sweepPipelines(deps)
      samples.push(Date.now() - startedAt)
    }
    scenarios.push(
      recordScenario({
        scenario: `scheduler-sweep-${count}`,
        rows: count,
        concurrency: 1,
        iterations: samples.length,
        stats: statsFor(samples, errors),
      }),
    )
    await ctx.admin.query(
      `delete from api.pipeline_schedules where id = any($1::uuid[])`,
      [population.scheduleIds],
    )
  }
}

/** Event-trigger drain at 10/100/1000 seeded change_events. */
async function eventBurstBenchmark(
  ctx: PipelineContext,
  scenarios: ScenarioReport[],
): Promise<void> {
  for (const eventCount of [10, 100, 1000]) {
    const population = await seedSchedules(ctx.admin, 0, 1)
    const scheduleId = population.eventScheduleIds[0]
    // Clear previously-consumed dataset_version events so the burst measures
    // exactly the seeded events (the bench workspace's own snapshots also emit
    // dataset_version events and would otherwise be drained too).
    await ctx.admin.query(
      `delete from api.change_events where workspace_id = $1 and entity_type = 'dataset_version'`,
      [FIXTURE.workspace],
    )
    // Seed deterministic change_events with fresh per-workspace sequences,
    // then re-sync the workspace_change_seq allocator so the product's next
    // legitimate emit does not collide with the seeded rows.
    const nextSeq = await ctx.admin.query<{ n: string }>(
      `select coalesce(max(sequence), 0) + 1 as n from api.change_events where workspace_id = $1`,
      [FIXTURE.workspace],
    )
    let seq = Number(nextSeq.rows[0]?.n ?? 1)
    for (let index = 0; index < eventCount; index += 1) {
      await ctx.admin.query(
        `insert into api.change_events(
           id, workspace_id, sequence, entity_type, entity_uuid, operation,
           actor_user_id, payload
         ) values ($1, $2, $3, 'dataset_version', $4, 'create', $5, '{}'::jsonb)`,
        [
          `0f05e000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
          FIXTURE.workspace,
          seq,
          ctx.inputVersionId,
          FIXTURE.user,
        ],
      )
      seq += 1
    }
    await ctx.admin.query(
      `insert into api.workspace_change_seq(workspace_id, last_seq)
       values ($1, $2)
       on conflict (workspace_id)
       do update set last_seq = greatest(api.workspace_change_seq.last_seq, excluded.last_seq)`,
      [FIXTURE.workspace, seq - 1],
    )
    // Drain: each sweep consumes up to MAX_EVENTS_PER_SWEEP (20) per schedule.
    const deps = schedulerDeps(ctx.admin)
    const startedAt = Date.now()
    let consumed = 0
    let sweeps = 0
    let guard = 0
    while (guard < 200) {
      guard += 1
      const started = await sweepPipelines(deps)
      consumed += started
      sweeps += 1
      if (started === 0) break
    }
    const totalMs = Date.now() - startedAt
    scenarios.push(
      recordScenario({
        scenario: `scheduler-event-burst-${eventCount}`,
        rows: eventCount,
        concurrency: 1,
        iterations: sweeps,
        stats: statsFor([totalMs]),
        notes: { eventsConsumed: consumed, sweeps },
      }),
    )
    // Cleanup: schedule, runs created by the stubbed drain, events.
    await ctx.admin.query(
      `delete from api.pipeline_runs where workspace_id=$1`,
      [FIXTURE.workspace],
    )
    await ctx.admin.query(
      `delete from api.change_events where workspace_id = $1 and id::text like '0f05e000-%'`,
      [FIXTURE.workspace],
    )
    await ctx.admin.query(`delete from api.pipeline_schedules where id=$1`, [
      scheduleId,
    ])
  }
}

/** Clean up output datasets created by benchmark runs (immutable versions
 * require the mutation trigger to be temporarily disabled — privileged local
 * cleanup of disposable benchmark objects only). */
async function cleanupBenchmarkOutputs(ctx: PipelineContext): Promise<void> {
  await ctx.admin.query(
    `delete from api.pipeline_run_logs where run_id in (
     select id from api.pipeline_runs where workspace_id = $1)`,
    [FIXTURE.workspace],
  )
  await ctx.admin.query(
    `delete from api.pipeline_runs where workspace_id = $1`,
    [FIXTURE.workspace],
  )
  await ctx.admin.query(
    `alter table api.dataset_versions disable trigger prevent_dataset_version_mutation`,
  )
  await ctx.admin.query(
    `alter table api.dataset_version_rows disable trigger prevent_dataset_version_row_mutation`,
  )
  await ctx.admin.query(
    `alter table api.dataset_version_values disable trigger prevent_dataset_version_value_mutation`,
  )
  try {
    await ctx.admin.query(
      `delete from api.dataset_version_values where dataset_version_id in (
         select id from api.dataset_versions where workspace_id = $1
           and (label = 'pipeline output' or label like 'plat-05%'))`,
      [FIXTURE.workspace],
    )
    await ctx.admin.query(
      `delete from api.dataset_version_rows where dataset_version_id in (
         select id from api.dataset_versions where workspace_id = $1
           and (label = 'pipeline output' or label like 'plat-05%'))`,
      [FIXTURE.workspace],
    )
    await ctx.admin.query(
      `delete from api.dataset_versions where workspace_id = $1
         and (label = 'pipeline output' or label like 'plat-05%')`,
      [FIXTURE.workspace],
    )
  } finally {
    await ctx.admin.query(
      `alter table api.dataset_version_values enable trigger prevent_dataset_version_value_mutation`,
    )
    await ctx.admin.query(
      `alter table api.dataset_version_rows enable trigger prevent_dataset_version_row_mutation`,
    )
    await ctx.admin.query(
      `alter table api.dataset_versions enable trigger prevent_dataset_version_mutation`,
    )
  }
  await ctx.admin.query(
    `delete from api.datasets where workspace_id = $1
     and name = 'PLAT-05 pipeline output'`,
    [FIXTURE.workspace],
  )
  await ctx.admin.query(
    `delete from api.dataset_bulk_commits where workspace_id = $1
       and idempotency_key like 'pipeline:%'`,
    [FIXTURE.workspace],
  )
}

export async function runPipelineBenchmarks(
  includeLarge = false,
): Promise<ScenarioReport[]> {
  const ctx = await context()
  const scenarios: ScenarioReport[] = []
  try {
    // Start clean: replay of a prior benchmark's successful digest would
    // short-circuit manual runs instead of executing fresh work.
    await cleanupBenchmarkOutputs(ctx)
    await stageBenchmark(ctx, scenarios, 10_000)
    if (includeLarge) await stageBenchmark(ctx, scenarios, 100_000)
    for (const concurrency of [1, 2, 5]) {
      await concurrencyBenchmark(ctx, scenarios, concurrency)
    }
    await schedulerScaleBenchmark(ctx, scenarios)
    await eventBurstBenchmark(ctx, scenarios)
    const environment = await environmentSnapshot(ctx.admin)
    writeReport('pipelines', scenarios, environment)
    return scenarios
  } finally {
    await cleanupBenchmarkOutputs(ctx).catch(() => {})
    await closeContext(ctx)
  }
}

async function main(): Promise<void> {
  await runPipelineBenchmarks(process.argv.includes('--large'))
}

if (process.argv[1]?.endsWith('perf/pipelines.ts')) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
