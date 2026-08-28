/**
 * API-006: health probes. Liveness proves the process is running; readiness
 * proves the application AND its dependencies (database, PostgREST) can serve.
 *
 * Both probes accept x-request-id and stamp it back on the response so an
 * operator can correlate a probe hit with logs.
 */
import { Client } from 'pg'

import { env, getDeploymentConfig } from '#/env.server'
import { logger } from '#/lib/logger'
import { resolveRequestId, stampRequestId } from '#/lib/request-id'
import { stampSecurityHeaders } from '#/lib/security-headers'

export interface ProbeResult {
  ok: boolean
  latencyMs: number
  error?: string
  migration?: MigrationCompatibility
}

export interface MigrationCompatibility {
  status: 'compatible' | 'incompatible' | 'not_checked'
  expected: string
  applied: string | null
}

export function evaluateMigrationCompatibility(
  expected: string,
  applied: string | null,
): MigrationCompatibility {
  if (expected === 'untracked') {
    return { status: 'not_checked', expected, applied }
  }
  return {
    status: expected === applied ? 'compatible' : 'incompatible',
    expected,
    applied,
  }
}

async function probeDatabase(expectedMigration: string): Promise<ProbeResult> {
  const start = Date.now()
  // Bounded: a hanging database must fail readiness within the probe window
  // (parity with the 2s PostgREST timeout), not stall the endpoint.
  const client = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 2000,
    statement_timeout: 2000,
  })
  try {
    // A short-lived connection keeps the probe independent of application
    // pools and is always closed, including migration-query failure paths.
    await client.connect()
    await client.query('SELECT 1')
    let appliedMigration: string | null = null
    if (expectedMigration !== 'untracked') {
      const result = await client.query<{ created_at: string }>(
        'SELECT created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1',
      )
      appliedMigration = result.rows[0]?.created_at ?? null
    }
    const migration = evaluateMigrationCompatibility(
      expectedMigration,
      appliedMigration,
    )
    if (migration.status === 'incompatible') {
      logger.error('database migration compatibility check failed', {
        expected_migration: migration.expected,
        applied_migration: migration.applied,
      })
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error:
          'database migration is incompatible with the application artifact',
        migration,
      }
    }
    return { ok: true, latencyMs: Date.now() - start, migration }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('database readiness probe failed', { error: message })
    return { ok: false, latencyMs: Date.now() - start, error: message }
  } finally {
    await client.end().catch(() => undefined)
  }
}

async function probePostgrest(): Promise<ProbeResult> {
  const start = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2000)
  try {
    // PostgREST admin server exposes /ready (and /live). We probe /ready
    // because that is what tells us PostgREST can actually serve requests,
    // not merely that the process is up.
    const response = await fetch(`${env.POSTGREST_ADMIN_URL}/ready`, {
      signal: controller.signal,
    })
    return {
      ok: response.ok,
      latencyMs: Date.now() - start,
      error: response.ok
        ? undefined
        : `postgrest /ready returned ${response.status}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('postgrest readiness probe failed', { error: message })
    return { ok: false, latencyMs: Date.now() - start, error: message }
  } finally {
    clearTimeout(timeout)
  }
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready'
  artifact: { version: string; digest: string }
  database: ProbeResult
  postgrest: ProbeResult
}

/**
 * Runs the readiness probes. Probes run in parallel so a slow PostgREST does
 * not delay the database signal. A failure on either dependency marks the
 * whole report not_ready; the body still reports both results so an operator
 * can see which dependency is broken.
 */
export async function runReadiness(): Promise<ReadinessReport> {
  const deployment = getDeploymentConfig()
  const [database, postgrest] = await Promise.all([
    probeDatabase(deployment.expectedMigration),
    probePostgrest(),
  ])
  return {
    status: database.ok && postgrest.ok ? 'ready' : 'not_ready',
    artifact: deployment.artifact,
    database: stripErrorForBody(database),
    postgrest: stripErrorForBody(postgrest),
  }
}

/**
 * Keeps the detailed error message out of the public response body (it can
 * leak connection strings or hostnames); operators read it in logs instead.
 */
function stripErrorForBody(probe: ProbeResult): ProbeResult {
  if (probe.ok) return probe
  return {
    ok: false,
    latencyMs: probe.latencyMs,
    migration: probe.migration,
  }
}

/** Builds the liveness response — process is up, no dependency checks. */
export function livenessResponse(request: Request): Response {
  const requestId = resolveRequestId(request.headers)
  return stampSecurityHeaders(
    stampRequestId(
      Response.json({ status: 'live' }, { status: 200 }),
      requestId,
    ),
  )
}

/** Builds the readiness response from the probe report. */
export function readinessResponse(
  request: Request,
  report: ReadinessReport,
): Response {
  const requestId = resolveRequestId(request.headers)
  return stampSecurityHeaders(
    stampRequestId(
      Response.json(report, { status: report.status === 'ready' ? 200 : 503 }),
      requestId,
    ),
  )
}
