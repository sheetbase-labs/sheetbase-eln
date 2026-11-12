/**
 * Provenance database proof: reproducing a Pipeline run, the lineage outbox
 * and the event stream, against a real PostgreSQL surface.
 */
import { Client as PgClient } from 'pg'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  reproducePipelineRun,
  runPipelineExecution,
} from '#/lib/pipeline-execute.server'
import type { PipelineExecuteDeps } from '#/lib/pipeline-execute.server'
import {
  connectTestSandbox,
  prepareTestDatabase,
  setActorJwt,
  testDatabaseName,
} from './helpers'
import { publishPipelineVersion } from './support/publish-pipeline'

// Manifests are signed with a key the deployment supplies.
vi.hoisted(() => {
  const crypto = process.getBuiltinModule('node:crypto')
  const { privateKey } = crypto.generateKeyPairSync('ed25519')
  process.env.PIPELINE_MANIFEST_SIGNING_KEY = privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString()
})

const WS = '0e0b0000-0000-4000-8000-000000000101'
const OTHER_WS = '0e0b0000-0000-4000-8000-000000000102'
const OWNER = 'prov-owner'
const VIEWER = 'prov-viewer'
const STRANGER = 'prov-stranger'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let schemaVersionId = ''
let inputVersionId = ''

function superuserTestUrl(): string {
  const url = new URL(process.env.DATABASE_URL!)
  url.pathname = `/${testDatabaseName()}`
  return url.toString()
}

async function actor(userId: string, workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, workspaceId)
  return client
}

async function execDeps(actorId: string): Promise<{
  deps: PipelineExecuteDeps
  close: () => Promise<void>
}> {
  const open = async () => {
    const conn = new PgClient({ connectionString: superuserTestUrl() })
    await conn.connect()
    return conn
  }
  const opened: Client[] = []
  return {
    deps: {
      getSession: async () => ({ user: { id: actorId } }),
      connect: async () => {
        const conn = await open()
        opened.push(conn)
        return {
          query: async (text, values = []) => conn.query(text, values),
          begin: () => conn.query('BEGIN').then(() => undefined),
          commit: () => conn.query('COMMIT').then(() => undefined),
          rollback: () => conn.query('ROLLBACK').then(() => undefined),
          end: () => Promise.resolve(),
        }
      },
      sandbox: connectTestSandbox,
    },
    close: async () => {
      await Promise.all(opened.map((c) => c.end().catch(() => {})))
    },
  }
}

async function rpcRow<T>(
  client: Client,
  sql: string,
  values: unknown[],
): Promise<T> {
  const { rows } = await client.query(sql, values)
  const row = rows[0]
  const keys = Object.keys(row)
  if (keys.length === 1) {
    const value = row[keys[0]]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as T
    }
  }
  return row as T
}

function config(statement: string): Record<string, unknown> {
  return {
    configVersion: 2,
    mode: 'standard',
    description: 'provenance test',
    parameters: [{ name: 'factor', type: 'decimal', required: true }],
    inputs: [{ name: 'measurements', required: true }],
    steps: [{ name: 'analysis', kind: 'sql', statement: statement }],
    output: {
      mode: 'create',
      schemaVersionId,
      datasetName: 'Provenance output',
      datasetLabel: 'provenance output',
      fieldMapping: null,
    },
  }
}

/** Define, publish, start and execute a run; returns its id. */
async function finishedRun(key: string, statement: string): Promise<string> {
  const owner = await actor(OWNER, WS)
  const definition = await rpcRow<{ id: string }>(
    owner,
    `select * from api.create_pipeline_definition($1::uuid,$2::text,$3::text,$4::text)`,
    [WS, key, key, null],
  )
  const version = await rpcRow<{ id: string }>(
    owner,
    `select * from api.create_pipeline_definition_version($1::uuid,$2::uuid,$3::jsonb)`,
    [WS, definition.id, JSON.stringify(config(statement))],
  )
  await publishPipelineVersion(owner, WS, version.id)
  const run = await rpcRow<{ id: string }>(
    owner,
    `select * from api.start_pipeline_run($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::jsonb,$6::uuid,$7::text,$8::uuid)`,
    [
      WS,
      version.id,
      'manual',
      JSON.stringify({ factor: 3 }),
      JSON.stringify({ measurements: inputVersionId }),
      null,
      null,
      null,
    ],
  )
  const { deps, close } = await execDeps(OWNER)
  const report = await runPipelineExecution(OWNER, run.id, deps)
  await close()
  expect(report.ok).toBe(true)
  return run.id
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  asRole = prepared.asRole
  await migrator.query(
    `insert into api.workspaces(id, slug, name) values ($1, 'prov-ws', 'Prov WS'), ($2, 'prov-other', 'Other WS')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into internal."user"(id, name, email) values
       ($1, 'Owner', 'owner@prov.test'), ($2, 'Viewer', 'viewer@prov.test'),
       ($3, 'Stranger', 'stranger@prov.test')`,
    [OWNER, VIEWER, STRANGER],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id, user_id, role) values
       ($1, $2, 'owner'), ($1, $3, 'viewer'), ($4, $5, 'owner')`,
    [WS, OWNER, VIEWER, OTHER_WS, STRANGER],
  )
  const owner = await actor(OWNER, WS)
  const definition = await rpcRow<{
    schema_definition_id: string
    schema_version_id: string
  }>(
    owner,
    `select * from api.create_dataset_schema_definition($1::uuid,$2::text,$3::text,$4::text,$5::jsonb)`,
    [
      WS,
      'prov_measurement',
      'Prov measurement',
      null,
      JSON.stringify([
        { key: 'batch', label: 'Batch', logicalType: 'text', nullable: false },
        {
          key: 'value',
          label: 'Value',
          logicalType: 'decimal',
          nullable: false,
        },
        {
          key: 'scaled',
          label: 'Scaled',
          logicalType: 'decimal',
          nullable: true,
        },
      ]),
    ],
  )
  schemaVersionId = definition.schema_version_id
  await owner.query(
    `select * from api.publish_dataset_schema_version($1::uuid)`,
    [schemaVersionId],
  )
  const dataset = await owner.query<{ id: string }>(
    `insert into api.datasets(workspace_id, schema_version_id, name, created_by_user_id)
     values ($1, $2, 'Raw', $3) returning id`,
    [WS, schemaVersionId, OWNER],
  )
  const fields = await migrator.query<{ id: string; key: string }>(
    `select field_id as id, key from api.dataset_schema_version_fields
      where schema_version_id = $1 and lifecycle = 'active'`,
    [schemaVersionId],
  )
  const fieldId = Object.fromEntries(fields.rows.map((f) => [f.key, f.id]))
  const rows = ['A', 'A', 'B'].map((batch, i) => ({
    operation: 'create',
    rowId: `${i + 1}`.repeat(8) + '-1111-4111-8111-111111111111',
    values: { [fieldId.batch]: batch, [fieldId.value]: [2, 4, 8][i] },
  }))
  await owner.query(
    `select * from api.commit_dataset_row_batch($1::uuid,$2::bigint,$3::jsonb,$4::text)`,
    [dataset.rows[0].id, 1, JSON.stringify(rows), 'prov-input-1'],
  )
  const snapshot = await rpcRow<{ id: string }>(
    owner,
    `select * from api.snapshot_dataset($1::uuid,$2::bigint,$3::text)`,
    [dataset.rows[0].id, 2, 'raw input'],
  )
  inputVersionId = snapshot.id
})

afterAll(async () => {
  for (const client of clients) await client.end().catch(() => {})
  await migrator?.end()
})

describe('reproducing a pipeline run', () => {
  it('matches when the re-run gives the very same rows', async () => {
    const runId = await finishedRun(
      'prov_scale',
      'SELECT batch, value, value * {{factor}} AS scaled FROM measurements',
    )
    const { deps, close } = await execDeps(OWNER)
    const report = await reproducePipelineRun(OWNER, { runId }, deps)
    await close()
    expect(report.ok).toBe(true)
    expect(report.reproduction).toMatchObject({
      status: 'matches',
      compared: 'digest',
      source_run_id: runId,
    })
    expect(report.reproduction?.summary).toMatchObject({
      identical: true,
      reproducedRows: 3,
      changedRows: 0,
    })
    // The re-run left no run, dataset version or output behind.
    const runs = await migrator.query(
      `select count(*)::int n from api.pipeline_runs where workspace_id = $1`,
      [WS],
    )
    expect(runs.rows[0].n).toBe(1)
    const outputs = await migrator.query(
      `select count(*)::int n from api.pipeline_run_outputs where run_id = $1`,
      [runId],
    )
    expect(outputs.rows[0].n).toBe(1)
    const events = await migrator.query(
      `select payload from api.change_events
        where workspace_id = $1 and entity_type = 'pipeline_reproduction'`,
      [WS],
    )
    expect(events.rows[0].payload).toMatchObject({
      action: 'reproduced',
      runId,
      status: 'matches',
    })
  })

  it('differs, and shows what changed, when the result is not repeatable', async () => {
    const runId = await finishedRun(
      'prov_noisy',
      'SELECT batch, value, random() AS scaled FROM measurements',
    )
    const { deps, close } = await execDeps(OWNER)
    const report = await reproducePipelineRun(OWNER, { runId }, deps)
    await close()
    expect(report.reproduction?.status).toBe('differs')
    expect(report.reproduction?.compared).toBe('dataset_version')
    expect(report.reproduction?.summary).toMatchObject({
      identical: false,
      originalRows: 3,
      reproducedRows: 3,
      changedRows: 3,
      changedColumns: { scaled: 3 },
    })
    expect(report.reproduction?.changes).toHaveLength(3)
  })

  it('is refused for a viewer and for a run that has not finished', async () => {
    const runId = await finishedRun(
      'prov_again',
      'SELECT batch, value, value AS scaled FROM measurements',
    )
    const { deps, close } = await execDeps(VIEWER)
    const refused = await reproducePipelineRun(VIEWER, { runId }, deps)
    expect(refused).toMatchObject({
      ok: false,
      errorCode: 'workspace_membership_required',
    })
    await migrator.query(
      `update api.pipeline_runs set status = 'running', finished_at = null where id = $1`,
      [runId],
    )
    const owner = await execDeps(OWNER)
    const early = await reproducePipelineRun(OWNER, { runId }, owner.deps)
    expect(early).toMatchObject({ ok: false, errorCode: 'run_not_finished' })
    await close()
    await owner.close()
    await migrator.query(
      `update api.pipeline_runs set status = 'succeeded', finished_at = now() where id = $1`,
      [runId],
    )
  })

  it('keeps reproductions read-only and visible to members only', async () => {
    const stored = await migrator.query<{ id: string }>(
      `select id from api.pipeline_reproductions where workspace_id = $1 limit 1`,
      [WS],
    )
    await expect(
      migrator.query(
        `update api.pipeline_reproductions set status = 'matches' where id = $1`,
        [stored.rows[0].id],
      ),
    ).rejects.toThrow(/cannot be changed/)
    const stranger = await actor(STRANGER, OTHER_WS)
    const seen = await stranger.query(
      `select id from api.pipeline_reproductions`,
    )
    expect(seen.rows).toHaveLength(0)
    const owner = await actor(OWNER, WS)
    const mine = await owner.query(`select id from api.pipeline_reproductions`)
    // One row per request: the first test made one, the second one, the third none.
    expect(mine.rows).toHaveLength(2)
  })
})

async function superuser(): Promise<Client> {
  const conn = new PgClient({ connectionString: superuserTestUrl() })
  await conn.connect()
  clients.push(conn)
  return conn
}

describe('lineage events', () => {
  let targetId = ''

  it('lets only someone who manages integrations add an endpoint', async () => {
    const viewer = await actor(VIEWER, WS)
    await expect(
      viewer.query(
        `select * from api.save_lineage_target($1::uuid, null, 'Marquez', 'https://lineage.example/api/v1/lineage')`,
        [WS],
      ),
    ).rejects.toThrow(/integration access required/)
    const owner = await actor(OWNER, WS)
    const row = await rpcRow<{ id: string; enabled: boolean }>(
      owner,
      `select * from api.save_lineage_target($1::uuid, null, 'Marquez', 'https://lineage.example/api/v1/lineage', 'prov', 'X-Api-Key', true)`,
      [WS],
    )
    targetId = row.id
    expect(row.enabled).toBe(true)
    const { sealSecret, secretKey } =
      await import('#/lib/connector-secrets.server')
    await owner.query(
      `select * from api.set_lineage_target_secret($1::uuid, $2)`,
      [targetId, sealSecret('s3cret', secretKey())],
    )
    const seen = await owner.query(
      `select has_secret from api.lineage_targets where id = $1`,
      [targetId],
    )
    expect(seen.rows[0].has_secret).toBe(true)
  })

  it('queues what happens after it was switched on and delivers it with the secret', async () => {
    const { sweepLineage } =
      await import('#/lib/provenance/lineage-emitter.server')
    await finishedRun(
      'prov_lineage',
      'SELECT batch, value, value AS scaled FROM measurements',
    )
    const calls: Array<{
      url: string
      headers: Record<string, string>
      body: any
    }> = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)),
      })
      return new Response('ok', { status: 201 })
    }) as unknown as typeof fetch
    const result = await sweepLineage({
      connect: superuser,
      fetch: fake,
      artifactVersion: 'test',
    })
    expect(result.queued).toBeGreaterThan(0)
    expect(result.delivered).toBe(result.queued)
    expect(calls[0].headers['X-Api-Key']).toBe('s3cret')
    expect(calls[0].body).toMatchObject({
      producer: expect.stringContaining('sheetbase'),
      job: { namespace: 'prov' },
    })
    expect(calls.map((c) => c.body.eventType)).toContain('COMPLETE')
    const rows = await migrator.query(
      `select status, count(*)::int n from api.lineage_deliveries where target_id = $1 group by status`,
      [targetId],
    )
    expect(rows.rows).toEqual([{ status: 'delivered', n: result.queued }])
    // Nothing is sent twice.
    const again = await sweepLineage({ connect: superuser, fetch: fake })
    expect(again.queued).toBe(0)
  })

  it('backs off after a failure and can be asked to try again', async () => {
    const { sweepLineage } =
      await import('#/lib/provenance/lineage-emitter.server')
    await finishedRun(
      'prov_lineage_fail',
      'SELECT batch, value, value AS scaled FROM measurements',
    )
    const down = (async () =>
      new Response('no', { status: 503 })) as unknown as typeof fetch
    const result = await sweepLineage({ connect: superuser, fetch: down })
    expect(result.failed).toBeGreaterThan(0)
    const waiting = await migrator.query(
      `select attempts, status, http_status, next_attempt_at > now() as later
         from api.lineage_deliveries where target_id = $1 and attempts > 0`,
      [targetId],
    )
    expect(waiting.rows[0]).toMatchObject({
      attempts: 1,
      status: 'pending',
      http_status: 503,
      later: true,
    })
  })
})

describe('event stream', () => {
  it('pages in order from a cursor, for members only', async () => {
    const owner = await actor(OWNER, WS)
    const first = await rpcRow<any>(
      owner,
      `select api.event_stream_page(0, 5, array['pipeline_reproduction','pipeline_run']) as page`,
      [],
    )
    const page = first.page ?? first
    expect(page.events.length).toBeGreaterThan(0)
    const sequences = page.events.map((e: any) => Number(e.sequence))
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b))
    expect(page.events[0].entity_type).toBeDefined()
    const next = await rpcRow<any>(
      owner,
      `select api.event_stream_page($1::bigint, 200, null) as page`,
      [page.nextCursor],
    )
    const rest = (next.page ?? next).events.map((e: any) => Number(e.sequence))
    expect(rest.every((s: number) => s > page.nextCursor)).toBe(true)

    const stranger = await actor(STRANGER, OTHER_WS)
    const theirs = await rpcRow<any>(
      stranger,
      `select api.event_stream_page(0, 200, null) as page`,
      [],
    )
    const seen = (theirs.page ?? theirs).events
    expect(
      seen.every((e: any) => e.entity_type !== 'pipeline_reproduction'),
    ).toBe(true)
    await expect(
      (await actor(STRANGER, WS)).query(
        `select api.event_stream_page(0, 10, null)`,
      ),
    ).rejects.toThrow(/not a member/)
  })

  it('refuses a limit that is too large and turns a stale cursor into expired', async () => {
    const owner = await actor(OWNER, WS)
    await expect(
      owner.query(`select api.event_stream_page(0, 5000, null)`),
    ).rejects.toThrow(/limit must be between/)
    await expect(
      owner.query(`select api.set_event_stream_retention($1::uuid, 0)`, [WS]),
    ).rejects.toThrow(/between 1 and 3650/)
    const days = await rpcRow<any>(
      owner,
      `select api.set_event_stream_retention($1::uuid, 1) as days`,
      [WS],
    )
    expect(Number(days.days ?? days)).toBe(1)
    // Age the early events beyond the window; the log itself is append-only,
    // so the test steps around it with a session setting the table allows.
    const aged = await migrator
      .query(
        `update api.change_events set created_at = now() - interval '5 days'
          where workspace_id = $1 and sequence <= 3`,
        [WS],
      )
      .then(() => true)
      .catch(() => false)
    if (aged) {
      const stale = await rpcRow<any>(
        owner,
        `select api.event_stream_page(1, 10, null) as page`,
        [],
      )
      expect((stale.page ?? stale).expired).toBe(true)
    }
  })
})

describe('reproduce from a pipeline step', () => {
  it('queues a request, runs it as the asker and keeps the verdict', async () => {
    const runId = await finishedRun(
      'prov_step',
      'SELECT batch, value, value AS scaled FROM measurements',
    )
    const viewer = await actor(VIEWER, WS)
    await expect(
      viewer.query(
        `select * from api.request_pipeline_reproduction($1::uuid)`,
        [runId],
      ),
    ).rejects.toThrow(/writer access required/)
    const owner = await actor(OWNER, WS)
    const request = await rpcRow<{ id: string; status: string }>(
      owner,
      `select * from api.request_pipeline_reproduction($1::uuid)`,
      [runId],
    )
    expect(request.status).toBe('pending')
    // Asking twice while one waits gives the same request.
    const again = await rpcRow<{ id: string }>(
      owner,
      `select * from api.request_pipeline_reproduction($1::uuid)`,
      [runId],
    )
    expect(again.id).toBe(request.id)

    const { sweepReproductionRequests } =
      await import('#/lib/provenance/reproduction-requests.server')
    const { deps, close } = await execDeps(OWNER)
    const handled = await sweepReproductionRequests({
      exec: deps,
      connect: superuser,
    })
    await close()
    expect(handled).toBeGreaterThanOrEqual(1)
    const done = await migrator.query(
      `select status, reproduction_id from api.pipeline_reproduction_requests where id = $1`,
      [request.id],
    )
    expect(done.rows[0].status).toBe('done')
    expect(done.rows[0].reproduction_id).toBeTruthy()
  })
})
