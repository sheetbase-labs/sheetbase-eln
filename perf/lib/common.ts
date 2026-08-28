/**
 * PLAT-05 — shared benchmark harness plumbing.
 *
 * Environment guard (refuses anything but a confirmed local development
 * loopback target), deterministic timing/percentile helpers and a JSON
 * report writer for the `perf/results/` output directory (gitignored).
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import type { QueryResult } from 'pg'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, platform, release, totalmem } from 'node:os'
import { join } from 'node:path'

config({ path: ['.env.local', '.env'] })

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
export const PERF_CONFIRMATION = 'local-destructive'

export interface PerfEnvironment {
  databaseUrl: string
  migrationDatabaseUrl: string
  pgrstDatabaseUrl: string
  postgrestUrl: string
  pgrstJwtSecret: string
  formulaDatabaseUrl?: string
}

function assertLoopbackUrl(
  name: string,
  value: string | undefined,
  required = true,
): string | undefined {
  if (!value) {
    if (required) throw new Error(`${name} is required for the perf harness`)
    return undefined
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid loopback PostgreSQL URL`)
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`${name} must be a valid loopback PostgreSQL URL`)
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`${name} must use a loopback host for the perf harness`)
  }
  return value
}

/** Refuse destructive fixture/benchmark work unless the full opt-in is present. */
export function assertPerfEnvironment(
  environment: Record<string, string | undefined> = process.env,
): PerfEnvironment {
  if (environment.SHEETBASE_ENV !== 'development') {
    throw new Error(
      'SHEETBASE_ENV must be development for the local perf harness',
    )
  }
  if (environment.PERF_CONFIRM !== PERF_CONFIRMATION) {
    throw new Error(
      `Set PERF_CONFIRM=${PERF_CONFIRMATION} to confirm the destructive local perf harness`,
    )
  }
  return {
    databaseUrl: assertLoopbackUrl('DATABASE_URL', environment.DATABASE_URL)!,
    migrationDatabaseUrl: assertLoopbackUrl(
      'MIGRATION_DATABASE_URL',
      environment.MIGRATION_DATABASE_URL,
    )!,
    pgrstDatabaseUrl: assertLoopbackUrl(
      'PGRST_DB_URI',
      environment.PGRST_DB_URI,
    )!,
    postgrestUrl: environment.POSTGREST_URL ?? 'http://localhost:3001',
    pgrstJwtSecret: environment.PGRST_JWT_SECRET ?? '',
    formulaDatabaseUrl: assertLoopbackUrl(
      'FORMULA_DATABASE_URL',
      environment.FORMULA_DATABASE_URL,
      false,
    ),
  }
}

/** Connect as the privileged local migrator login (fixture setup only). */
export async function adminClient(databaseUrl: string): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  return client
}

/** Connect as the authenticator login and switch to the request role. */
export async function actorClient(
  pgrstDatabaseUrl: string,
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = new Client({ connectionString: pgrstDatabaseUrl })
  await client.connect()
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: workspaceId }),
  ])
  return client
}

export function elapsed(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000
}

export function pct(sortedMs: number[], q: number): number {
  if (sortedMs.length === 0) return 0
  const index = Math.min(
    sortedMs.length - 1,
    Math.max(0, Math.ceil((q / 100) * sortedMs.length) - 1),
  )
  return sortedMs[index]
}

export interface SampleStats {
  iterations: number
  p50_ms: number
  p95_ms: number
  p99_ms: number
  min_ms: number
  max_ms: number
  mean_ms: number
  errors: number
}

export function statsFor(samplesMs: number[], errors = 0): SampleStats {
  const sorted = [...samplesMs].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  return {
    iterations: sorted.length,
    p50_ms: pct(sorted, 50),
    p95_ms: pct(sorted, 95),
    p99_ms: pct(sorted, 99),
    min_ms: sorted[0] ?? 0,
    max_ms: sorted[sorted.length - 1] ?? 0,
    mean_ms: sorted.length ? sum / sorted.length : 0,
    errors,
  }
}

/** Round-trip measure one operation; returns duration ms. */
export async function measure(fn: () => Promise<unknown>): Promise<number> {
  const startedAt = process.hrtime.bigint()
  await fn()
  return elapsed(startedAt)
}

export interface ScenarioReport {
  scenario: string
  rows?: number
  fields?: number
  concurrency: number
  iterations: number
  throughput?: number
  p50_ms: number
  p95_ms: number
  p99_ms: number
  errors: number
  notes?: Record<string, unknown>
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Sortable stable scenario id: scenario + size so results compare across runs. */
export function scenarioId(name: string, size?: number | string): string {
  return size === undefined ? name : `${name}-${size}`
}

/** Build a scenario report from sampled durations. */
export function recordScenario(
  input: Omit<ScenarioReport, 'p50_ms' | 'p95_ms' | 'p99_ms' | 'errors'> & {
    stats: SampleStats
  },
): ScenarioReport {
  return {
    scenario: input.scenario,
    rows: input.rows,
    fields: input.fields,
    concurrency: input.concurrency,
    iterations: input.iterations,
    throughput: input.throughput,
    p50_ms: round(input.stats.p50_ms),
    p95_ms: round(input.stats.p95_ms),
    p99_ms: round(input.stats.p99_ms),
    errors: input.stats.errors,
    notes: input.notes,
  }
}

/**
 * A run-scoped report accumulator. One JSON file per `perf` invocation (or
 * per orchestrated section), so before/after comparisons are simple and no
 * giant generated files are committed.
 */
export interface PerfRunReport {
  environment: {
    cpu: string
    ramGb: string
    platform: string
    postgresVersion: string
    nodeVersion: string
    commitSha: string
    date: string
  }
  scenarios: ScenarioReport[]
  notes: Record<string, unknown>
}

export function writeReport(
  name: string,
  scenarios: ScenarioReport[],
  environment: PerfRunReport['environment'],
  notes: Record<string, unknown> = {},
): string {
  const dir = join(process.cwd(), 'perf', 'results')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const payload: PerfRunReport = { environment, scenarios, notes }
  const file = join(dir, `${stamp}-${name}.json`)
  writeFileSync(file, JSON.stringify(payload, null, 2) + '\n')
  console.log(`report_written=${file}`)
  return file
}

/** Execute a query and return a summary of the plan. */
export function planSummary(result: QueryResult): Record<string, unknown> {
  const envelope = result.rows[0]['QUERY PLAN'][0]
  const indexes = new Set<string>()
  let hitBlocks = 0
  let readBlocks = 0
  const visit = (node: Record<string, unknown>) => {
    if (typeof node['Index Name'] === 'string')
      indexes.add(String(node['Index Name']))
    hitBlocks += Number(node['Shared Hit Blocks'] ?? 0)
    readBlocks += Number(node['Shared Read Blocks'] ?? 0)
    const children = node.Plans
    if (Array.isArray(children)) children.forEach((c) => visit(c))
  }
  visit(envelope.Plan as Record<string, unknown>)
  return {
    executionMs: envelope['Execution Time'],
    planningMs: envelope['Planning Time'],
    root: (envelope.Plan as Record<string, unknown>)['Node Type'],
    indexes: [...indexes].sort(),
    sharedHitBlocks: hitBlocks,
    sharedReadBlocks: readBlocks,
  }
}

/** Human-readable number formatting for reports. */
export function fmtNumber(value: number): string {
  return value.toLocaleString('en-GB')
}

/** Snapshot the benchmark environment (CPU/RAM/OS/Postgres/Node/commit). */
export async function environmentSnapshot(
  admin: Client,
): Promise<PerfRunReport['environment']> {
  const version = (
    await admin.query<{ server_version: string }>('show server_version')
  ).rows[0].server_version
  const cpu = cpus()[0]?.model ?? 'unknown'
  const ramGb = Math.round(totalmem() / 1024 ** 3)
  let commitSha = 'unknown'
  try {
    commitSha = execSync('git rev-parse HEAD', { cwd: process.cwd() })
      .toString()
      .trim()
  } catch {
    // not a git checkout; keep 'unknown'
  }
  return {
    cpu,
    ramGb: `${ramGb} GiB`,
    platform: `${platform()} (${release()})`,
    postgresVersion: version,
    nodeVersion: process.version,
    commitSha,
    date: new Date().toISOString(),
  }
}
