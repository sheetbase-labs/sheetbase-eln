/**
 * API-006: health probes. Liveness proves the process is running; readiness
 * proves the application AND its dependencies (database, PostgREST) can serve.
 *
 * Both probes accept x-request-id and stamp it back on the response so an
 * operator can correlate a probe hit with logs.
 */
import { drizzle } from 'drizzle-orm/node-postgres'

import { env } from '#/env.server'
import { logger } from '#/lib/logger'
import { resolveRequestId, stampRequestId } from '#/lib/request-id'

export interface ProbeResult {
  ok: boolean
  latencyMs: number
  error?: string
}

async function probeDatabase(): Promise<ProbeResult> {
  const start = Date.now()
  try {
    // A short-lived client per probe keeps the health endpoint independent
    // of the app's pooled client and avoids leaking connections on failure.
    const db = drizzle(env.DATABASE_URL)
    await db.execute('SELECT 1')
    await db.$client.end()
    return { ok: true, latencyMs: Date.now() - start }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('database readiness probe failed', { error: message })
    return { ok: false, latencyMs: Date.now() - start, error: message }
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
  const [database, postgrest] = await Promise.all([
    probeDatabase(),
    probePostgrest(),
  ])
  return {
    status: database.ok && postgrest.ok ? 'ready' : 'not_ready',
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
  return { ok: false, latencyMs: probe.latencyMs }
}

/** Builds the liveness response — process is up, no dependency checks. */
export function livenessResponse(request: Request): Response {
  const requestId = resolveRequestId(request.headers)
  return stampRequestId(
    Response.json({ status: 'live' }, { status: 200 }),
    requestId,
  )
}

/** Builds the readiness response from the probe report. */
export function readinessResponse(
  request: Request,
  report: ReadinessReport,
): Response {
  const requestId = resolveRequestId(request.headers)
  return stampRequestId(
    Response.json(report, { status: report.status === 'ready' ? 200 : 503 }),
    requestId,
  )
}
