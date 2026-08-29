/**
 * PLAT-05 — Dataset read / version-read / write / snapshot benchmarks and the
 * DB query-plan audit for the canonical Dataset paths.
 *
 * Reads and writes go through the canonical RPCs with the authenticated role,
 * RLS and workspace claims. Fixture setup is privileged (perf/fixtures.ts).
 */
import type { Client } from 'pg'

import {
  actorClient,
  adminClient,
  assertPerfEnvironment,
  elapsed,
  environmentSnapshot,
  measure,
  planSummary,
  recordScenario,
  statsFor,
  writeReport,
  scenarioId,
} from './lib/common'
import type { ScenarioReport } from './lib/common'
import { fieldsFor, FIXTURE, datasetFixtures } from './fixtures'

const PAGE_SIZE = 100
const ITERATIONS = {
  warm: 7,
  cold: 1,
}

interface BenchConnections {
  admin: Client
  actor: Client
  env: ReturnType<typeof assertPerfEnvironment>
}

async function connect(): Promise<BenchConnections> {
  const env = assertPerfEnvironment()
  const admin = await adminClient(env.migrationDatabaseUrl)
  const actor = await actorClient(
    env.pgrstDatabaseUrl,
    FIXTURE.user,
    FIXTURE.workspace,
  )
  return { admin, actor, env }
}

async function close(conn: BenchConnections): Promise<void> {
  await conn.actor.end().catch(() => {})
  await conn.admin.end().catch(() => {})
}

/** Run one RPC and return duration ms + result. */
async function timeRpc(
  actor: Client,
  sql: string,
  values: unknown[],
): Promise<{ ms: number; result: unknown }> {
  const startedAt = process.hrtime.bigint()
  const response = await actor.query(sql, values)
  return { ms: elapsed(startedAt), result: response.rows[0]?.result }
}

function datasetReadSql(): string {
  return `select api.query_dataset_rows($1,$2::jsonb,${PAGE_SIZE},0) result`
}

/**
 * Read benchmark with explicit iteration control — warm cache, page 100.
 */
async function readBenchmark(
  conn: BenchConnections,
  scenarios: ScenarioReport[],
): Promise<void> {
  const firstOfType = (
    fixture: ReturnType<typeof datasetFixtures>[number],
    type: string,
  ) => fieldsFor(fixture.shape).find((f) => f.logicalType === type)!.id
  const query = (fixture: ReturnType<typeof datasetFixtures>[number]) => ({
    filters: [
      {
        fieldId: firstOfType(fixture, 'decimal'),
        operator: 'gte',
        value: 500_000_000,
      },
    ],
    sort: {
      fieldId: firstOfType(fixture, 'date'),
      direction: 'desc',
    },
  })

  // Warm the filter/sort path once, then sample.
  for (const fixture of datasetFixtures()) {
    const q = query(fixture)
    await timeRpc(conn.actor, datasetReadSql(), [fixture.id, q])
  }
  for (const fixture of datasetFixtures()) {
    const q = query(fixture)
    const samples: number[] = []
    let errors = 0
    for (let i = 0; i < ITERATIONS.warm; i += 1) {
      try {
        const { ms, result } = await timeRpc(conn.actor, datasetReadSql(), [
          fixture.id,
          q,
        ])
        samples.push(ms)
        const total = (result as { totalCount?: number }).totalCount ?? 0
        if (total !== fixture.rows / 2) errors += 1
      } catch {
        errors += 1
      }
    }
    scenarios.push(
      recordScenario({
        scenario: scenarioId(
          'dataset-read',
          `${Math.round(fixture.rows / 1000)}k`,
        ),
        rows: fixture.rows,
        fields: fieldsFor(fixture.shape).length,
        concurrency: 1,
        iterations: samples.length,
        stats: statsFor(samples, errors),
      }),
    )
  }
}

/** Version read — fixed 100-row window over immutable version values. */
async function versionReadBenchmark(
  conn: BenchConnections,
  scenarios: ScenarioReport[],
): Promise<void> {
  for (const fixture of datasetFixtures()) {
    for (let i = 0; i < 2; i += 1) {
      await conn.actor.query(
        `select api.query_dataset_version_rows($1,100,0)`,
        [fixture.versionId],
      )
    }
    const samples: number[] = []
    let errors = 0
    for (let i = 0; i < ITERATIONS.warm; i += 1) {
      try {
        const startedAt = process.hrtime.bigint()
        const { rows } = await conn.actor.query(
          `select api.query_dataset_version_rows($1,100,0) result`,
          [fixture.versionId],
        )
        const ms = elapsed(startedAt)
        samples.push(ms)
        const result = rows[0]?.result as { totalCount?: number }
        if (result.totalCount !== fixture.rows) errors += 1
      } catch {
        errors += 1
      }
    }
    scenarios.push(
      recordScenario({
        scenario: scenarioId(
          'dataset-version-read',
          `${Math.round(fixture.rows / 1000)}k`,
        ),
        rows: fixture.rows,
        fields: fieldsFor(fixture.shape).length,
        concurrency: 1,
        iterations: samples.length,
        stats: statsFor(samples, errors),
      }),
    )
  }
}

/** Write benchmark — create batches of 1 / 100 / 1000 rows. */
async function writeBenchmark(
  conn: BenchConnections,
  scenarios: ScenarioReport[],
): Promise<void> {
  const fixture = datasetFixtures().find((f) => f.rows === 10_000)!
  const fields = fieldsFor('medium')
  const sampleField = fields[0].id
  const titreField = fields[1].id
  const dateField = fields[2].id
  const categoryField = fields[3].id
  let serial = 0

  for (const batchSize of [1, 100, 1000]) {
    // Each batch gets unique row ids in the reserved `0f05d000` prefix.
    const rowIds = Array.from({ length: batchSize }, () => {
      serial += 1
      return `0f05d000-0000-4000-8000-${String(serial).padStart(12, '0')}`
    })
    const rows = rowIds.map((rowId, index) => ({
      operation: 'create',
      rowId,
      values: {
        [sampleField]: `0f051000-0000-4000-8000-${String((index % 20_000) + 1).padStart(12, '0')}`,
        [titreField]: 400_000_000 + index,
        [dateField]: '2026-01-01',
        [categoryField]: '0f05c000-0000-4000-8000-000000000100',
      },
    }))
    const idempotencyKey = `plat05-write-${batchSize}-${serial}`
    // Validation pass (reuses the commit RPC's internal validation but measured
    // separately through the canonical validate RPC).
    const validateSamples: number[] = []
    for (let i = 0; i < 3; i += 1) {
      const ms = await measure(() =>
        conn.actor.query(
          `select api.validate_dataset_row_batch($1,1,$2::jsonb) result`,
          [fixture.id, JSON.stringify(rows)],
        ),
      )
      validateSamples.push(ms)
    }
    const commitSamples: number[] = []
    for (let i = 0; i < 3; i += 1) {
      const ms = await measure(() =>
        conn.actor.query(
          `select api.commit_dataset_row_batch($1,1,$2::jsonb,$3) result`,
          [fixture.id, JSON.stringify(rows), idempotencyKey],
        ),
      )
      commitSamples.push(ms)
    }
    scenarios.push(
      recordScenario({
        scenario: scenarioId('dataset-write-validate', batchSize),
        rows: batchSize,
        fields: 4,
        concurrency: 1,
        iterations: validateSamples.length,
        stats: statsFor(validateSamples),
      }),
      recordScenario({
        scenario: scenarioId('dataset-write-commit', batchSize),
        rows: batchSize,
        fields: 4,
        concurrency: 1,
        iterations: commitSamples.length,
        stats: statsFor(commitSamples),
      }),
    )
  }
}

/** Snapshot benchmark at 1k / 10k (50k/100k optional via --large). */
async function snapshotBenchmark(
  conn: BenchConnections,
  scenarios: ScenarioReport[],
  includeLarge: boolean,
): Promise<void> {
  const fixtures = datasetFixtures().filter(
    (f) => f.shape === 'medium' && (includeLarge || f.rows <= 10_000),
  )
  for (const fixture of fixtures) {
    const label = `${Math.round(fixture.rows / 1000)}k`
    const samples: number[] = []
    let errors = 0
    // One snapshot per sample — snapshots are durable objects, so clean up
    // between samples by deleting the created version (privileged cleanup).
    for (let i = 0; i < 3; i += 1) {
      try {
        const startedAt = process.hrtime.bigint()
        const { rows } = await conn.actor.query(
          `select (api.snapshot_dataset($1,$2,$3)).id as id`,
          [
            fixture.id,
            await currentRevision(conn.admin, fixture.id),
            `perf snapshot ${label}`,
          ],
        )
        const ms = elapsed(startedAt)
        samples.push(ms)
        const versionId = rows[0]?.id as string | undefined
        if (!versionId) throw new Error('snapshot returned no version')
        await conn.admin.query(
          `alter table api.dataset_versions disable trigger prevent_dataset_version_mutation`,
        )
        await conn.admin.query(
          `alter table api.dataset_version_rows disable trigger prevent_dataset_version_row_mutation`,
        )
        await conn.admin.query(
          `alter table api.dataset_version_values disable trigger prevent_dataset_version_value_mutation`,
        )
        try {
          await conn.admin.query(
            `delete from api.dataset_version_values where dataset_version_id=$1`,
            [versionId],
          )
          await conn.admin.query(
            `delete from api.dataset_version_rows where dataset_version_id=$1`,
            [versionId],
          )
          await conn.admin.query(
            `delete from api.dataset_versions where id=$1`,
            [versionId],
          )
        } finally {
          await conn.admin.query(
            `alter table api.dataset_version_values enable trigger prevent_dataset_version_value_mutation`,
          )
          await conn.admin.query(
            `alter table api.dataset_version_rows enable trigger prevent_dataset_version_row_mutation`,
          )
          await conn.admin.query(
            `alter table api.dataset_versions enable trigger prevent_dataset_version_mutation`,
          )
        }
      } catch {
        errors += 1
      }
    }
    scenarios.push(
      recordScenario({
        scenario: scenarioId('dataset-snapshot', label),
        rows: fixture.rows,
        fields: fieldsFor('medium').length,
        concurrency: 1,
        iterations: samples.length,
        stats: statsFor(samples, errors),
      }),
    )
  }
}

async function currentRevision(
  admin: Client,
  datasetId: string,
): Promise<number> {
  const { rows } = await admin.query<{ revision: number }>(
    `select revision from api.datasets where id=$1`,
    [datasetId],
  )
  return rows[0]?.revision ?? 1
}

/** Query-plan audit for the canonical Dataset hot paths. */
async function explainAudit(
  conn: BenchConnections,
): Promise<Record<string, unknown>> {
  const fixture = datasetFixtures().find((f) => f.rows === 100_000)!
  const fields = fieldsFor('medium')
  const filterField = fields[1].id
  const sortField = fields[2].id
  const plans: Record<string, unknown> = {}
  const explain = async (name: string, sql: string, params: unknown[]) => {
    const result = await conn.admin.query(
      `explain (analyze,buffers,format json) ${sql}`,
      params,
    )
    plans[name] = planSummary(result)
  }
  // Canonical read shape (what query_dataset_rows builds) at 100k.
  const projectionSql = `
    with selected as materialized (
      select r.id,sort.date_value
      from api.dataset_rows r
      join api.dataset_row_values filter on filter.row_id=r.id and filter.field_id=$2 and filter.numeric_value>=500000000
      join api.dataset_row_values sort on sort.row_id=r.id and sort.field_id=$3
      where r.dataset_id=$1 order by sort.date_value desc,r.id limit 100
    )
    select s.id,jsonb_object_agg(v.field_id,v.value order by v.field_id) values
    from selected s join lateral (
      select field_id,coalesce(to_jsonb(text_value),to_jsonb(integer_value),to_jsonb(numeric_value),
        to_jsonb(boolean_value),to_jsonb(date_value),to_jsonb(timestamp_value),
        to_jsonb(category_option_id),to_jsonb(reference_id)) value
      from api.dataset_row_values where row_id=s.id and field_id=any($4::uuid[])
    ) v on true group by s.id,s.date_value order by s.date_value desc,s.id`
  await explain('dataset_read_100k_page', projectionSql, [
    fixture.id,
    filterField,
    sortField,
    fields.slice(0, 12).map((f) => f.id),
  ])
  // Count-only (per-page totalCount).
  await explain(
    'dataset_count_100k',
    `select count(*) from api.dataset_rows r
     join api.dataset_row_values filter on filter.row_id=r.id and filter.field_id=$2 and filter.numeric_value>=500000000
     where r.dataset_id=$1`,
    [fixture.id, filterField],
  )
  // Version read window.
  await explain(
    'dataset_version_read_100k',
    `select * from api.dataset_version_rows where dataset_version_id=$1 order by row_id limit 100 offset 0`,
    [fixture.versionId],
  )
  // Snapshot copy (against a throwaway version id so the INSERT itself runs).
  const probeVersionId = crypto.randomUUID()
  await conn.admin.query(
    `insert into api.dataset_versions(
       id,dataset_id,workspace_id,schema_version_id,source_dataset_revision,label,created_by_user_id
     ) values ($1,$2,$3,$4,1,'perf explain probe', $5)`,
    [
      probeVersionId,
      fixture.id,
      FIXTURE.workspace,
      fixture.shape === 'medium'
        ? FIXTURE.schemas.mediumVersion
        : FIXTURE.schemas.narrowVersion,
      FIXTURE.user,
    ],
  )
  await conn.admin.query(
    `insert into api.dataset_version_rows(dataset_version_id,row_id,revision)
     select $1,id,revision from api.dataset_rows where dataset_id=$2`,
    [probeVersionId, fixture.id],
  )
  await explain(
    'dataset_snapshot_copy_100k',
    `insert into api.dataset_version_values(
       dataset_version_id,row_id,field_id,ordinal,text_value,integer_value,numeric_value,
       boolean_value,date_value,timestamp_value,category_option_id,reference_id
     )
     select $1,v.row_id,v.field_id,v.ordinal,v.text_value,v.integer_value,v.numeric_value,
       v.boolean_value,v.date_value,v.timestamp_value,v.category_option_id,v.reference_id
     from api.dataset_row_values v join api.dataset_rows r on r.id=v.row_id
     where r.dataset_id=$2`,
    [probeVersionId, fixture.id],
  )
  await conn.admin.query(
    `alter table api.dataset_versions disable trigger prevent_dataset_version_mutation`,
  )
  await conn.admin.query(
    `alter table api.dataset_version_rows disable trigger prevent_dataset_version_row_mutation`,
  )
  await conn.admin.query(
    `alter table api.dataset_version_values disable trigger prevent_dataset_version_value_mutation`,
  )
  try {
    await conn.admin.query(
      `delete from api.dataset_version_values where dataset_version_id=$1`,
      [probeVersionId],
    )
    await conn.admin.query(
      `delete from api.dataset_version_rows where dataset_version_id=$1`,
      [probeVersionId],
    )
    await conn.admin.query(`delete from api.dataset_versions where id=$1`, [
      probeVersionId,
    ])
  } finally {
    await conn.admin.query(
      `alter table api.dataset_version_values enable trigger prevent_dataset_version_value_mutation`,
    )
    await conn.admin.query(
      `alter table api.dataset_version_rows enable trigger prevent_dataset_version_row_mutation`,
    )
    await conn.admin.query(
      `alter table api.dataset_versions enable trigger prevent_dataset_version_mutation`,
    )
  }
  return plans
}

export async function runDatasetBenchmarks(
  includeLargeSnapshots = false,
): Promise<ScenarioReport[]> {
  const conn = await connect()
  const scenarios: ScenarioReport[] = []
  try {
    await readBenchmark(conn, scenarios)
    await versionReadBenchmark(conn, scenarios)
    await writeBenchmark(conn, scenarios)
    await snapshotBenchmark(conn, scenarios, includeLargeSnapshots)
    const environment = await environmentSnapshot(conn.admin)
    const plans = await explainAudit(conn)
    writeReport('dataset', scenarios, environment, { plans })
    return scenarios
  } finally {
    await close(conn)
  }
}

async function main(): Promise<void> {
  const includeLarge = process.argv.includes('--large')
  await runDatasetBenchmarks(includeLarge)
}

if (process.argv[1]?.endsWith('perf/dataset.ts')) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
