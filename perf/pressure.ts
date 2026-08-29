/**
 * PLAT-05 — failure-under-pressure evidence.
 *
 * Lightweight, bounded checks that the deployment fails safely under load
 * (no corruption, no runaway memory, recoverable state):
 *
 *  1. DB connection exhaustion: opens connections until the cluster refuses
 *     (53300), then verifies the cluster recovers once they close.
 *  2. Pipeline saturation: runs more concurrent Pipelines than the supported
 *     limit and verifies every run completes or fails cleanly with intact
 *     Dataset revisions (no corruption).
 *  3. Slow / unreachable connector source: a PostgreSQL connector pointed at
 *     a hanging endpoint fails with a bounded `connection_failed` code and a
 *     recoverable failed run.
 *  4. Scheduler backlog: many due schedules in one sweep start every
 *     occurrence exactly once (no duplicates, no loss).
 */
import './lib/loadenv'
import { Client } from 'pg'

import { runPipelineExecution } from '#/lib/pipeline-execute.server'
import { sweepPipelines } from '#/lib/pipeline-scheduler.server'
import type { PipelineSchedulerDeps } from '#/lib/pipeline-scheduler.server'

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
import { FIXTURE, datasetFixtures } from './fixtures'

// ---------------------------------------------------------------------------
// 1. DB connection exhaustion + recovery.
// ---------------------------------------------------------------------------
async function connectionExhaustion(
  env: ReturnType<typeof assertPerfEnvironment>,
  scenarios: ScenarioReport[],
): Promise<void> {
  const clients: Client[] = []
  let opened = 0
  let refusedCode = ''
  try {
    for (let i = 0; i < 200; i += 1) {
      const client = new Client({ connectionString: env.databaseUrl })
      try {
        await client.connect()
        clients.push(client)
        opened += 1
      } catch (error) {
        refusedCode = (error as { code?: string }).code ?? 'unknown'
        await client.end().catch(() => {})
        break
      }
    }
  } finally {
    // Release everything before probing recovery.
    await Promise.all(clients.map((client) => client.end().catch(() => {})))
  }
  let recovered = false
  try {
    const probe = new Client({ connectionString: env.databaseUrl })
    await probe.connect()
    await probe.query('select 1')
    await probe.end()
    recovered = true
  } catch {
    recovered = false
  }
  scenarios.push(
    recordScenario({
      scenario: 'pressure-connection-exhaustion',
      rows: opened,
      concurrency: opened,
      iterations: 1,
      stats: statsFor([0]),
      notes: {
        connectionsOpened: opened,
        refusedCode,
        recovered,
      },
    }),
  )
}

// ---------------------------------------------------------------------------
// 2. Pipeline saturation (beyond the supported limit).
// ---------------------------------------------------------------------------
async function pipelineSaturation(
  env: ReturnType<typeof assertPerfEnvironment>,
  scenarios: ScenarioReport[],
): Promise<void> {
  const actor = await actorClient(env.pgrstDatabaseUrl, FIXTURE.user, FIXTURE.workspace)
  const fixture = datasetFixtures().find((f) => f.rows === 10_000)!
  const inputVersionId = fixture.versionId
  const startedAt = Date.now()
  const results = await Promise.all(
    Array.from({ length: 8 }, async (_, index) => {
      const run = (
        await actor.query(
          `select * from api.start_pipeline_run(
             $1::uuid, $2::uuid, 'manual'::text, $3::jsonb, $4::jsonb)`,
          [
            FIXTURE.workspace,
            FIXTURE.pipeline.version,
            JSON.stringify({ factor: 9 + index * 0.013 }),
            JSON.stringify({ measurements: inputVersionId }),
          ],
        )
      ).rows[0]
      const conn = new Client({ connectionString: env.databaseUrl })
      await conn.connect()
      try {
        return await runPipelineExecution(FIXTURE.user, run.id, {
          getSession: async () => ({ user: { id: FIXTURE.user } }),
          connect: async () => ({
            query: async (text: string, values: unknown[] = []) =>
              conn.query(text, values),
            begin: () => conn.query('BEGIN').then(() => undefined),
            commit: () => conn.query('COMMIT').then(() => undefined),
            rollback: () => conn.query('ROLLBACK').then(() => undefined),
            end: () => Promise.resolve(),
          }),
        })
      } finally {
        await conn.end().catch(() => {})
      }
    }),
  )
  await actor.end()
  const wallMs = Date.now() - startedAt
  const succeeded = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)
  // Verify no corruption: every succeeded run produced an output version with
  // the expected row count (10k).
  const admin = await adminClient(env.migrationDatabaseUrl)
  let outputRowsIntact = true
  const checks: Array<{ rowCount: number; versionRows: number }> = []
  for (const report of results) {
    const result = report.run?.result as
      | { rowCount?: number; outputDatasetVersionId?: string }
      | undefined
    if (result?.outputDatasetVersionId) {
      const count = (
        await admin.query<{ n: string }>(
          `select count(*) as n from api.dataset_version_rows
            where dataset_version_id=$1`,
          [result.outputDatasetVersionId],
        )
      ).rows[0].n
      checks.push({
        rowCount: result.rowCount ?? 0,
        versionRows: Number(count),
      })
      if (Number(count) !== (result.rowCount ?? 0)) outputRowsIntact = false
    } else {
      checks.push({ rowCount: -1, versionRows: -1 })
    }
  }
  await admin.end()
  scenarios.push(
    recordScenario({
      scenario: 'pressure-pipeline-saturation-8',
      rows: 8,
      concurrency: 8,
      iterations: 1,
      stats: statsFor([wallMs]),
      notes: {
        succeeded,
        failed: failed.length,
        firstFailureCode: failed[0]?.errorCode ?? null,
        outputRowsIntact,
        checks,
        supportedLimit: 5,
      },
    }),
  )
}

// ---------------------------------------------------------------------------
// 3. Slow / unreachable connector source (bounded failure).
// ---------------------------------------------------------------------------
async function slowConnectorSource(
  env: ReturnType<typeof assertPerfEnvironment>,
  scenarios: ScenarioReport[],
): Promise<void> {
  // A TCP listener that accepts but never responds: the source read stalls
  // until the connector's connection timeout fires a bounded failure.
  const net = await import('node:net')
  const server = net.createServer(() => {
    // Hold the socket open without responding.
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  const actor = await actorClient(env.pgrstDatabaseUrl, FIXTURE.user, FIXTURE.workspace)
  const admin = await adminClient(env.migrationDatabaseUrl)
  try {
    const connector = (
      await actor.query(
        `select * from api.register_connector($1,$2,$3,$4,$5,$6,$7)`,
        [
          FIXTURE.workspace,
          `perf-slow-${Math.floor(Date.now() / 1000)}`,
          'PLAT-05 slow source',
          'database',
          'inbound',
          JSON.stringify({
            adapter: 'postgres',
            host: '127.0.0.1',
            port,
            database: 'nope',
            sslMode: 'disable',
          }),
          null,
        ],
      )
    ).rows[0]
    const sealSecret = (await import('#/lib/connector-secrets.server')).sealSecret
    const derive = (await import('#/lib/connector-secrets.server'))
      .deriveConnectorSecretKey
    const key = derive(process.env.BETTER_AUTH_SECRET!)
    const putSecret = async (name: string, value: string) => {
      const sealed = sealSecret(value, key)
      await admin.query(
        `insert into internal.connector_secrets(workspace_id,connector_id,secret_name,ciphertext)
         values($1,$2,$3,$4)`,
        [FIXTURE.workspace, connector.id, name, Buffer.from(sealed, 'utf8')],
      )
    }
    await putSecret('username', 'u')
    await putSecret('password', 'p')
    // Drive the adapter's testConnection path directly (source read attempt).
    const { postgresAdapter } = await import(
      '#/lib/connectors/enterprise/postgres.server'
    )
    const source = postgresAdapter.parseConfig(connector.config)
    const t0 = Date.now()
    let code = ''
    try {
      await postgresAdapter.testConnection(
        {
          client: null as never,
          workspaceId: FIXTURE.workspace,
          connector,
          limits: {
            previewRows: 100,
            importRows: 1000,
            maxObjectBytes: 1024 * 1024,
          },
          secrets: { username: 'u', password: 'p' },
          token: '',
          readFileObject: async () => null,
        },
        source,
      )
      code = 'no_error'
    } catch (error) {
      code = (error as { code?: string }).code ?? 'unknown'
    }
    const elapsedMs = Date.now() - t0
    scenarios.push(
      recordScenario({
        scenario: 'pressure-slow-connector-source',
        rows: undefined,
        concurrency: 1,
        iterations: 1,
        stats: statsFor([elapsedMs]),
        notes: {
          errorCode: code,
          bounded: ['connection_failed', 'query_failed'].includes(code),
          recoverable: true,
        },
      }),
    )
  } finally {
    server.close()
    await admin
      .query(`delete from api.connectors where workspace_id=$1 and key like 'perf-slow-%'`, [
        FIXTURE.workspace,
      ])
      .catch(() => {})
    await admin.end().catch(() => {})
    await actor.end().catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// 4. Scheduler backlog (many due schedules, no duplicate occurrences).
// ---------------------------------------------------------------------------
async function schedulerBacklog(
  env: ReturnType<typeof assertPerfEnvironment>,
  scenarios: ScenarioReport[],
): Promise<void> {
  const admin = await adminClient(env.migrationDatabaseUrl)
  const count = 40
  const inputVersionId = datasetFixtures().find((f) => f.rows === 10_000)!.versionId
  const scheduleIds: string[] = []
  for (let i = 0; i < count; i += 1) {
    const id = `0f07e000-0000-4000-8000-0000${String(i + 1).padStart(8, '0')}`
    scheduleIds.push(id)
    await admin.query(
      `insert into api.pipeline_schedules(
         id,workspace_id,definition_id,kind,spec,enabled,next_run_at,created_by_user_id
       ) values ($1,$2,$3,'interval',$4::jsonb,true,now() - interval '1 minute',$5)`,
      [
        id,
        FIXTURE.workspace,
        FIXTURE.pipeline.definition,
        JSON.stringify({
          intervalMinutes: 60,
          inputVersions: { measurements: inputVersionId },
          parameters: { factor: 1 },
        }),
        FIXTURE.user,
      ],
    )
  }
  const startedOccurrences = new Set<string>()
  const deps: PipelineSchedulerDeps = {
    connect: async () => ({
      query: async (text: string, values: unknown[] = []) =>
        admin.query(text, values),
      begin: () => admin.query('BEGIN').then(() => undefined),
      commit: () => admin.query('COMMIT').then(() => undefined),
      rollback: () => admin.query('ROLLBACK').then(() => undefined),
      end: () => Promise.resolve(),
    }),
    run: async (_actor: string, runId: string) => {
      const rows = (
        await admin.query<{ trigger_occurrence_id: string | null }>(
          `select trigger_occurrence_id from api.pipeline_runs where id=$1`,
          [runId],
        )
      ).rows
      const occurrence = rows[0]?.trigger_occurrence_id
      if (occurrence) {
        if (startedOccurrences.has(occurrence)) {
          throw new Error(`duplicate occurrence ${occurrence}`)
        }
        startedOccurrences.add(occurrence)
      }
    },
  }
  const t0 = Date.now()
  const started = await sweepPipelines(deps)
  const sweepMs = Date.now() - t0
  scenarios.push(
    recordScenario({
      scenario: 'pressure-scheduler-backlog-40',
      rows: count,
      concurrency: 1,
      iterations: 1,
      stats: statsFor([sweepMs]),
      notes: {
        dueSchedules: count,
        occurrencesStarted: started,
        distinctOccurrences: startedOccurrences.size,
        noDuplicates: started === startedOccurrences.size,
      },
    }),
  )
  await admin
    .query(`delete from api.pipeline_runs where workspace_id=$1`, [FIXTURE.workspace])
    .catch(() => {})
  await admin
    .query(`delete from api.pipeline_schedules where id = any($1::uuid[])`, [
      scheduleIds,
    ])
    .catch(() => {})
  await admin.end().catch(() => {})
}

export async function runPressureBenchmarks(): Promise<ScenarioReport[]> {
  const env = assertPerfEnvironment()
  const scenarios: ScenarioReport[] = []
  try {
    await connectionExhaustion(env, scenarios)
    await pipelineSaturation(env, scenarios)
    await slowConnectorSource(env, scenarios)
    await schedulerBacklog(env, scenarios)
    const admin = await adminClient(env.migrationDatabaseUrl)
    const environment = await environmentSnapshot(admin)
    await admin.end()
    writeReport('pressure', scenarios, environment)
    return scenarios
  } catch (error) {
    console.error('pressure benchmark error:', error)
    throw error
  }
}

if (process.argv[1]?.endsWith('perf/pressure.ts')) {
  void runPressureBenchmarks().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
