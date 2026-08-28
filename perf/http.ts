/**
 * PLAT-05 — API-layer concurrency benchmark against PostgREST.
 *
 * Mimics the same-origin proxy's request pattern: each request mints a fresh
 * short-lived JWT (as the proxy does per proxied request) and calls a mixed
 * product workload (read Dataset page, list Records, global search, commit
 * Dataset rows) directly against the local PostgREST endpoint. This measures
 * the authoritative DB + REST API layer; the app proxy adds one thin hop.
 */
import './lib/loadenv'
import type { Client } from 'pg'

import {
  adminClient,
  assertPerfEnvironment,
  environmentSnapshot,
  recordScenario,
  statsFor,
  writeReport,
} from './lib/common'
import type { ScenarioReport } from './lib/common'
import { FIXTURE, datasetFixtures, fieldsFor } from './fixtures'

interface WorkloadOp {
  kind: 'read_dataset' | 'list_records' | 'search' | 'write_rows'
  weight: number
}

const WORKLOAD: WorkloadOp[] = [
  { kind: 'read_dataset', weight: 40 },
  { kind: 'list_records', weight: 20 },
  { kind: 'search', weight: 20 },
  { kind: 'write_rows', weight: 20 },
]

function pickKind(): WorkloadOp['kind'] {
  const total = WORKLOAD.reduce((acc, op) => acc + op.weight, 0)
  let roll = Math.random() * total
  for (const op of WORKLOAD) {
    roll -= op.weight
    if (roll <= 0) return op.kind
  }
  return WORKLOAD[0].kind
}

interface HttpContext {
  admin: Client
  env: ReturnType<typeof assertPerfEnvironment>
  datasetId: string
  datasetVersionId: string
  recordFieldId: string
  titreFieldId: string
  dateFieldId: string
  categoryFieldId: string
  postgrestUrl: string
  workspaceId: string
  userId: string
}

async function context(): Promise<HttpContext> {
  const env = assertPerfEnvironment()
  const admin = await adminClient(env.migrationDatabaseUrl)
  const medium = datasetFixtures().find((f) => f.rows === 10_000)!
  const fields = fieldsFor('medium')
  return {
    admin,
    env,
    datasetId: medium.id,
    datasetVersionId: medium.versionId,
    recordFieldId: fields[0].id,
    titreFieldId: fields[1].id,
    dateFieldId: fields[2].id,
    categoryFieldId: fields[3].id,
    // Force the loopback IPv4 literal: the dev Vite server also binds
    // localhost (IPv6) on the same ports and must not be measured.
    postgrestUrl: env.postgrestUrl.replace('localhost', '127.0.0.1'),
    workspaceId: FIXTURE.workspace,
    userId: FIXTURE.user,
  }
}

async function closeContext(ctx: HttpContext): Promise<void> {
  await ctx.admin.end().catch(() => {})
}

async function mintToken(secret: string, ctx: HttpContext): Promise<string> {
  // PostgREST rejects JWTs with `iat` in the future and its default clock
  // safety is 0s, so a container clock a few minutes behind the host makes
  // fresh tokens look future-dated. Backdate `iat` to absorb local clock
  // skew; the benchmark measures the API layer, not host/container clock
  // sync. TTL stays short.
  return new (await import('jose')).SignJWT({
    sub: ctx.userId,
    workspace_id: ctx.workspaceId,
    session_id: 'perf-bench-session',
    role: 'authenticated',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
    .setExpirationTime('120s')
    .sign(new TextEncoder().encode(secret))
}
// Unique per process so a rerun never collides with a prior run's rows.
let writeSerial = Math.floor(Math.random() * 1_000_000) + 1

/** Execute one mixed-workload request; returns duration ms or throws. */
async function oneRequest(ctx: HttpContext, secret: string): Promise<number> {
  const token = await mintToken(secret, ctx)
  const kind = pickKind()
  const startedAt = Date.now()
  const url = ctx.postgrestUrl
  if (kind === 'read_dataset') {
    const q = {
      filters: [
        {
          fieldId: ctx.titreFieldId,
          operator: 'gte',
          value: 500_000_000,
        },
      ],
    }
    const res = await fetch(`${url}/rpc/query_dataset_rows`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        p_dataset_id: ctx.datasetId,
        p_query: q,
        p_limit: 100,
        p_offset: 0,
      }),
    })
    if (!res.ok) throw new Error(`read_dataset ${res.status}`)
    await res.arrayBuffer()
  } else if (kind === 'list_records') {
    const res = await fetch(
      `${url}/records?select=id,title,kind&limit=50&offset=0`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
        },
      },
    )
    if (!res.ok) throw new Error(`list_records ${res.status}`)
    await res.arrayBuffer()
  } else if (kind === 'search') {
    const res = await fetch(`${url}/rpc/search`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        p_query: 'Plat sample',
        p_limit: 20,
        p_offset: 0,
      }),
    })
    if (!res.ok) throw new Error(`search ${res.status}`)
    await res.arrayBuffer()
  } else {
    writeSerial += 1
    // The canonical commit RPC requires the expected Dataset revision; read it
    // fresh so concurrent writers exercise real optimistic-concurrency
    // behaviour (a stale reader conflicts, exactly like the product).
    const revRes = await fetch(
      `${url}/datasets?id=eq.${ctx.datasetId}&select=revision`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
        },
      },
    )
    if (!revRes.ok) throw new Error(`read_revision ${revRes.status}`)
    const revJson = (await revRes.json()) as Array<{ revision: number }>
    const expectedRevision = revJson[0]?.revision ?? 1
    const rowId = `0f05f000-0000-4000-8000-${String(writeSerial).padStart(12, '0')}`
    const rows = [
      {
        operation: 'create',
        rowId,
        values: {
          [ctx.recordFieldId]: `0f051000-0000-4000-8000-${String((writeSerial % 20_000) + 1).padStart(12, '0')}`,
          [ctx.titreFieldId]: 300_000_000 + writeSerial,
          [ctx.dateFieldId]: '2026-01-01',
          [ctx.categoryFieldId]: '0f05c000-0000-4000-8000-000000000100',
        },
      },
    ]
    const res = await fetch(`${url}/rpc/commit_dataset_row_batch`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        p_dataset_id: ctx.datasetId,
        p_expected_dataset_revision: expectedRevision,
        p_rows: rows,
        p_idempotency_key: `perf-http-${writeSerial}`,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`write_rows ${res.status} ${body.slice(0, 200)}`)
    }
    await res.arrayBuffer()
  }
  return Date.now() - startedAt
}

async function concurrencyLevel(
  ctx: HttpContext,
  secret: string,
  concurrency: number,
  durationSeconds: number,
): Promise<ScenarioReport> {
  const startedAt = Date.now()
  const samples: number[] = []
  let errors = 0
  let completed = 0
  const deadline = startedAt + durationSeconds * 1000
  const workers = Array.from({ length: concurrency }, () => 0)
  const runWorker = async (workerIndex: number) => {
    while (Date.now() < deadline) {
      workers[workerIndex] += 1
      try {
        samples.push(await oneRequest(ctx, secret))
        completed += 1
      } catch {
        errors += 1
      }
    }
  }
  const startWorkers = async () => {
    await Promise.all(workers.map((_, i) => runWorker(i)))
  }
  await startWorkers()
  const wallMs = Date.now() - startedAt
  const elapsedSec = wallMs / 1000
  const stats = statsFor(samples, errors)
  return recordScenario({
    scenario: `api-concurrency-${concurrency}`,
    rows: undefined,
    concurrency,
    iterations: samples.length,
    throughput: Math.round(completed / elapsedSec),
    stats,
    notes: { durationSeconds: elapsedSec },
  })
}

export async function runHttpBenchmarks(): Promise<ScenarioReport[]> {
  const ctx = await context()
  const scenarios: ScenarioReport[] = []
  try {
    const secret = ctx.env.pgrstJwtSecret
    // Warm the filter/sort paths + search once.
    await oneRequest(ctx, secret).catch(() => {})
    for (const concurrency of [1, 5, 20]) {
      scenarios.push(await concurrencyLevel(ctx, secret, concurrency, 10))
    }
    const environment = await environmentSnapshot(ctx.admin)
    writeReport('http', scenarios, environment, {
      target: ctx.postgrestUrl,
      workload: WORKLOAD.map((op) => `${op.kind}:${op.weight}`).join(','),
    })
    return scenarios
  } finally {
    await closeContext(ctx)
  }
}

async function main(): Promise<void> {
  await runHttpBenchmarks()
}

if (process.argv[1]?.endsWith('perf/http.ts')) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
