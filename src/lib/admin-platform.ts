/**
 * PLAT-04 — Platform Administration server functions.
 *
 * Server-only data for the admin surface: diagnostics, usage/storage counts,
 * run-health overview, attention indicators, connector diagnostics, and
 * deployment/version info. Every function loads the session and verifies
 * workspace membership; mutations additionally check capabilities.
 *
 * No raw DB access from the client — all data flows through these server
 * functions which use the application database connection with workspace
 * filtering. Secret values are never returned.
 */
import { createServerFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'

import { env, getDeploymentConfig } from '#/env.server'
import {
  INPUT_ROW_LIMIT,
  EXECUTION_TIMEOUT_SECONDS,
} from '#/lib/pipeline-limits'

// Scheduler configuration — mirrors the env check in
// src/lib/pipeline-scheduler.server.ts startPipelineScheduler().
function schedulerEnabled(): boolean {
  return process.env.SHEETBASE_SCHEDULER_ENABLED !== 'false'
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiagnosticsResult {
  health: {
    status: 'ready' | 'not_ready' | 'degraded'
    database: { ok: boolean; latencyMs: number }
    postgrest: { ok: boolean; latencyMs: number }
  }
  deployment: {
    environment: string
    artifactVersion: string
    artifactDigest: string
    expectedMigration: string
    secretSource: string
  }
  migration: {
    status: 'compatible' | 'incompatible' | 'not_checked'
    expected: string
    applied: string | null
  }
  scheduler: {
    enabled: boolean
    lastSweepAt: string | null
    sweepIntervalSeconds: number
    enabledScheduleCount: number
    recoveredStaleCount: number
  }
  pipelineExecutor: {
    activeRuns: number
    recentFailures: number
    executionTimeoutSeconds: number
    rowCap: number
    inputCap: number
  }
  config: {
    fileBackend: string
    authMode: string
    externalApiEnabled: boolean
    connectorSecretEncryptionConfigured: boolean
    metricsEnabled: boolean
    collaborationEnabled: boolean
  }
}

export interface CapacityWarning {
  level: 'info' | 'warning'
  message: string
  category: string
}

export interface UsageResult {
  members: number
  records: number
  datasets: number
  datasetVersions: number
  files: number
  fileBytes: number
  connectors: number
  pipelineDefinitions: number
  pipelineRuns: number
  connectorRuns: number
  capacityWarnings: CapacityWarning[]
}

export interface StorageFileWire {
  id: string
  displayName: string
  mediaType: string
  byteSize: string
  status: string
  storageBackend: string
  createdAt: string
  recordId: string | null
}

export interface StorageOverviewResult {
  fileCount: number
  fileBytes: number
  datasetCount: number
  datasetVersionCount: number
  largestFiles: StorageFileWire[]
  recentFiles: StorageFileWire[]
}

export interface RunHealthItem {
  id: string
  kind: 'pipeline' | 'connector'
  status: string
  startedAt: string
  finishedAt: string | null
  error_code: string | null
  error_message: string | null
  connectorId: string | null
  definitionVersionId: string | null
}

export interface RunHealthResult {
  running: RunHealthItem[]
  failed: RunHealthItem[]
  recentlySucceeded: RunHealthItem[]
  counts: {
    running: number
    failed: number
    recentlySucceeded: number
  }
}

export interface AttentionItem {
  level: 'warning' | 'info'
  category: string
  message: string
  link?: string
}

export interface ConnectorDiagnosticsResult {
  activeConnectors: number
  pausedConnectors: number
  recentFailures: number
  missingSecrets: number
  repeatedFailures: number
  connectors: Array<{
    id: string
    name: string
    connectorType: string
    status: string
    lastRunStatus: string | null
    lastRunAt: string | null
    lastErrorCode: string | null
    hasSecrets: boolean
    recentFailureCount: number
  }>
}

// ---------------------------------------------------------------------------
// Session / capability helpers
// ---------------------------------------------------------------------------

/** Context returned by loadAdminSession for read-only admin functions. */
interface AdminSession {
  context: {
    user: { id: string; name: string; email: string }
    workspace: { id: string; slug: string; name: string; role: string } | null
    collaborationEnabled: boolean
  }
}

/** Context returned by requireCapability for privileged admin functions. */
interface ScopedAdminSession {
  /** A raw pg client with JWT claims stamped (SET ROLE authenticated +
   * request.jwt.claims). Use .query() for all SQL so RLS and capability
   * checks see the correct user/workspace. Release in a finally block. */
  client: PoolClient
  release: () => Promise<void>
}

async function loadAdminSession(workspaceId: string): Promise<AdminSession> {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const { getCurrentContext } = await import('#/lib/current-user')
  const { db } = await import('#/db/client.server')
  const { isWorkspaceMember } = await import('#/lib/api-credentials')

  const context = await getCurrentContext(getRequestHeaders())
  if (!context) throw new Error('You must be signed in.')
  if (!context.workspace || context.workspace.id !== workspaceId) {
    throw new Error('You do not have access to this workspace.')
  }
  if (!(await isWorkspaceMember(db, context.user.id, workspaceId))) {
    throw new Error('You do not have access to this workspace.')
  }
  return { context }
}

/**
 * Acquire a scoped DB connection with JWT claims stamped so that
 * `api.has_capability()`, RLS policies, and SECURITY DEFINER RPCs see the
 * correct authenticated user and workspace.
 *
 * This is the same pattern used by pipeline-scheduler.server.ts and
 * sheet-calculation.server.ts: SET LOCAL ROLE authenticated +
 * set_config('request.jwt.claims', ..., true) inside a transaction.
 *
 * @param pool Optional pg Pool override (for testing with a test database).
 *             When omitted, uses the application's default pool.
 *
 * Exported for direct testing.
 */
export async function getScopedClient(
  workspaceId: string,
  userId: string,
  pool?: Pool,
): Promise<ScopedAdminSession> {
  if (!pool) {
    const { db } = await import('#/db/client.server')
    pool = db.$client
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE authenticated')
    await client.query(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: userId, workspace_id: workspaceId })],
    )
  } catch (err) {
    client.release()
    throw err
  }
  return {
    client,
    release: async () => {
      try {
        await client.query('COMMIT')
      } catch {
        await client.query('ROLLBACK').catch(() => {})
      } finally {
        await client.query('SET ROLE NONE').catch(() => {})
        client.release()
      }
    },
  }
}

/**
 * Require a workspace capability. Acquires a scoped DB connection with JWT
 * claims stamped so `api.has_capability()` sees the correct authenticated
 * user/workspace — the same canonical mechanism used by SECURITY DEFINER RPCs.
 *
 * The caller must call `session.release()` in a finally block.
 */
export async function requireCapability(
  workspaceId: string,
  capability: string,
): Promise<ScopedAdminSession> {
  const session = await loadAdminSession(workspaceId)
  const scoped = await getScopedClient(workspaceId, session.context.user.id)
  try {
    const { rows } = await scoped.client.query(
      'SELECT api.has_capability($1::uuid, $2) AS ok',
      [workspaceId, capability],
    )
    if (!rows[0]?.ok) {
      await scoped.release()
      throw new Error(
        `permission_denied: ${capability} required for this operation.`,
      )
    }
  } catch (err) {
    // If the error is our permission_denied, re-throw; otherwise release
    if (err instanceof Error && err.message.startsWith('permission_denied')) {
      throw err
    }
    await scoped.release()
    throw err
  }
  return scoped
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function num(value: unknown): number {
  return Number(value ?? 0)
}

function str(value: unknown): string | null {
  return value != null ? String(value) : null
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs = 2_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// fetchDiagnosticsFn
// ---------------------------------------------------------------------------

export const fetchDiagnosticsFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<DiagnosticsResult> => {
    await loadAdminSession(data.workspaceId)
    const deployment = getDeploymentConfig()

    // Database probe
    const dbStart = Date.now()
    let dbOk = false
    try {
      const { db } = await import('#/db/client.server')
      await withTimeout(db.execute(sql`SELECT 1`))
      dbOk = true
    } catch {
      dbOk = false
    }
    const database = { ok: dbOk, latencyMs: Date.now() - dbStart }

    // PostgREST probe
    const pgrStart = Date.now()
    let pgrOk = false
    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), 2_000)
    try {
      const response = await fetch(`${env.POSTGREST_ADMIN_URL}/ready`, {
        signal: controller.signal,
      })
      pgrOk = response.ok
    } catch {
      pgrOk = false
    } finally {
      clearTimeout(abortTimer)
    }
    const postgrest = { ok: pgrOk, latencyMs: Date.now() - pgrStart }

    // Scheduler / pipeline run stats
    const { db } = await import('#/db/client.server')
    const [schedRes, runRes] = await Promise.all([
      db.execute(sql`
        SELECT count(*) FILTER (WHERE enabled)::int AS enabled_count,
               max(last_evaluated_at)::text AS last_sweep
        FROM api.pipeline_schedules
        WHERE workspace_id = ${data.workspaceId}::uuid
      `),
      db.execute(sql`
        SELECT count(*) FILTER (WHERE status = 'running')::int AS active_runs,
               count(*) FILTER (WHERE status = 'failed' AND started_at > now() - interval '24 hours')::int AS recent_failures,
               count(*) FILTER (WHERE status = 'failed' AND error_code = 'stale_run_reconciled' AND started_at > now() - interval '24 hours')::int AS recovered_stale
        FROM api.pipeline_runs
        WHERE workspace_id = ${data.workspaceId}::uuid
      `),
    ])

    const schedRow = schedRes.rows[0] as Record<string, unknown> | undefined
    const runRow = runRes.rows[0] as Record<string, unknown> | undefined

    // Migration state
    let applied: string | null = null
    let migrationStatus: 'compatible' | 'incompatible' | 'not_checked' =
      'not_checked'
    if (deployment.expectedMigration !== 'untracked') {
      try {
        const migRes = await db.execute(sql`
          SELECT created_at::text AS created_at
          FROM drizzle.__drizzle_migrations
          ORDER BY created_at DESC LIMIT 1
        `)
        applied = str(migRes.rows[0]?.created_at)
        migrationStatus =
          applied === deployment.expectedMigration
            ? 'compatible'
            : 'incompatible'
      } catch {
        migrationStatus = 'not_checked'
      }
    }

    const healthStatus = !dbOk || !pgrOk ? 'not_ready' : migrationStatus === 'incompatible' ? 'degraded' : 'ready'

    // Scheduler state: report the actual env-driven enabled flag and use
    // last_evaluated_at only as a best-effort signal, not a heartbeat.
    // When there are no enabled schedules, last_evaluated_at may be NULL even
    // if the scheduler is running perfectly — report status accordingly.
    const schedEnabled = schedulerEnabled()
    const schedLastSweep = str(schedRow?.last_sweep ?? null)
    const enabledScheduleCount = num(schedRow?.enabled_count ?? 0)

    return {
      health: { status: healthStatus, database, postgrest },
      deployment: {
        environment: deployment.environment,
        artifactVersion: deployment.artifact.version,
        artifactDigest: deployment.artifact.digest,
        expectedMigration: deployment.expectedMigration,
        secretSource: deployment.secretSource,
      },
      migration: {
        status: migrationStatus,
        expected: deployment.expectedMigration,
        applied,
      },
      scheduler: {
        enabled: schedEnabled,
        lastSweepAt: schedLastSweep,
        sweepIntervalSeconds: 60,
        enabledScheduleCount,
        recoveredStaleCount: num(runRow?.recovered_stale ?? 0),
      },
      pipelineExecutor: {
        activeRuns: num(runRow?.active_runs ?? 0),
        recentFailures: num(runRow?.recent_failures ?? 0),
        executionTimeoutSeconds: EXECUTION_TIMEOUT_SECONDS,
        rowCap: INPUT_ROW_LIMIT,
        inputCap: INPUT_ROW_LIMIT,
      },
      config: {
        fileBackend: env.FILE_STORAGE_BACKEND,
        authMode: env.GITHUB_CLIENT_ID ? 'github_oauth' : 'dev_auth_free',
        externalApiEnabled: true,
        connectorSecretEncryptionConfigured: Boolean(env.PGRST_JWT_SECRET),
        metricsEnabled: Boolean(env.SHEETBASE_METRICS_TOKEN),
        collaborationEnabled: Boolean(env.LIVEBLOCKS_SECRET_KEY),
      },
    }
  })

// ---------------------------------------------------------------------------
// fetchUsageFn
// ---------------------------------------------------------------------------

export const fetchUsageFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<UsageResult> => {
    await loadAdminSession(data.workspaceId)
    const { db } = await import('#/db/client.server')
    const res = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM api.workspace_memberships WHERE workspace_id = ${data.workspaceId}::uuid)::int AS members,
        (SELECT count(*) FROM api.records WHERE workspace_id = ${data.workspaceId}::uuid)::int AS records,
        (SELECT count(*) FROM api.datasets WHERE workspace_id = ${data.workspaceId}::uuid)::int AS datasets,
        (SELECT count(*) FROM api.dataset_versions WHERE workspace_id = ${data.workspaceId}::uuid)::int AS dataset_versions,
        (SELECT count(*) FROM api.file_objects WHERE workspace_id = ${data.workspaceId}::uuid AND deleted_at IS NULL)::int AS files,
        (SELECT coalesce(sum(byte_size), 0)::text FROM api.file_objects WHERE workspace_id = ${data.workspaceId}::uuid AND deleted_at IS NULL) AS file_bytes,
        (SELECT count(*) FROM api.connectors WHERE workspace_id = ${data.workspaceId}::uuid)::int AS connectors,
        (SELECT count(*) FROM api.pipeline_definitions WHERE workspace_id = ${data.workspaceId}::uuid)::int AS pipeline_definitions,
        (SELECT count(*) FROM api.pipeline_runs WHERE workspace_id = ${data.workspaceId}::uuid)::int AS pipeline_runs,
        (SELECT count(*) FROM api.connector_runs WHERE workspace_id = ${data.workspaceId}::uuid)::int AS connector_runs,
        (SELECT count(*) FROM api.pipeline_schedules WHERE workspace_id = ${data.workspaceId}::uuid AND enabled)::int AS enabled_schedules
    `)
    const row = res.rows[0] as Record<string, unknown> | undefined
    const fileBytes = num(row?.file_bytes)
    const enabledSchedules = num(row?.enabled_schedules)
    const capacityWarnings: CapacityWarning[] = []
    if (enabledSchedules > 100) {
      capacityWarnings.push({
        level: 'warning',
        category: 'schedules',
        message: `${enabledSchedules} enabled pipeline schedules — above validated scale.`,
      })
    }
    if (fileBytes > 10_000_000_000) {
      capacityWarnings.push({
        level: 'warning',
        category: 'file_storage',
        message: 'Workspace file storage exceeds 10 GB.',
      })
    }
    return {
      members: num(row?.members),
      records: num(row?.records),
      datasets: num(row?.datasets),
      datasetVersions: num(row?.dataset_versions),
      files: num(row?.files),
      fileBytes,
      connectors: num(row?.connectors),
      pipelineDefinitions: num(row?.pipeline_definitions),
      pipelineRuns: num(row?.pipeline_runs),
      connectorRuns: num(row?.connector_runs),
      capacityWarnings,
    }
  })

// ---------------------------------------------------------------------------
// fetchStorageOverviewFn
// ---------------------------------------------------------------------------

export const fetchStorageOverviewFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<StorageOverviewResult> => {
    await loadAdminSession(data.workspaceId)
    const { db } = await import('#/db/client.server')
    const [countRes, largestRes, recentRes] = await Promise.all([
      db.execute(sql`
        SELECT
          count(*)::int AS file_count,
          coalesce(sum(byte_size), 0)::text AS file_bytes,
          (SELECT count(*)::int FROM api.datasets WHERE workspace_id = ${data.workspaceId}::uuid) AS dataset_count,
          (SELECT count(*)::int FROM api.dataset_versions WHERE workspace_id = ${data.workspaceId}::uuid) AS dataset_version_count
        FROM api.file_objects
        WHERE workspace_id = ${data.workspaceId}::uuid AND deleted_at IS NULL
      `),
      db.execute(sql`
        SELECT id, display_name, media_type, byte_size::text, status, storage_backend, created_at::text, record_id::text
        FROM api.file_objects
        WHERE workspace_id = ${data.workspaceId}::uuid AND deleted_at IS NULL
        ORDER BY byte_size DESC
        LIMIT 10
      `),
      db.execute(sql`
        SELECT id, display_name, media_type, byte_size::text, status, storage_backend, created_at::text, record_id::text
        FROM api.file_objects
        WHERE workspace_id = ${data.workspaceId}::uuid AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 10
      `),
    ])
    const countRow = countRes.rows[0] as Record<string, unknown> | undefined
    const mapFiles = (rows: typeof largestRes.rows) =>
      rows.map((r) => ({
        id: String(r.id),
        displayName: String(r.display_name),
        mediaType: String(r.media_type),
        byteSize: String(r.byte_size),
        status: String(r.status),
        storageBackend: String(r.storage_backend),
        createdAt: String(r.created_at),
        recordId: str(r.record_id),
      }))
    return {
      fileCount: num(countRow?.file_count),
      fileBytes: num(countRow?.file_bytes),
      datasetCount: num(countRow?.dataset_count),
      datasetVersionCount: num(countRow?.dataset_version_count),
      largestFiles: mapFiles(largestRes.rows),
      recentFiles: mapFiles(recentRes.rows),
    }
  })

// ---------------------------------------------------------------------------
// fetchRunHealthFn
// ---------------------------------------------------------------------------

export const fetchRunHealthFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<RunHealthResult> => {
    await loadAdminSession(data.workspaceId)
    const { db } = await import('#/db/client.server')
    const [pipeRes, connRes] = await Promise.all([
      db.execute(sql`
        SELECT id, 'pipeline' AS kind, status, started_at::text, finished_at::text,
               error_code, error_message, NULL::text AS connector_id, definition_version_id::text
        FROM api.pipeline_runs
        WHERE workspace_id = ${data.workspaceId}::uuid
        ORDER BY started_at DESC
        LIMIT 50
      `),
      db.execute(sql`
        SELECT id, 'connector' AS kind, status, started_at::text, finished_at::text,
               error_code, error_message, connector_id::text, NULL::text AS definition_version_id
        FROM api.connector_runs
        WHERE workspace_id = ${data.workspaceId}::uuid
        ORDER BY started_at DESC
        LIMIT 50
      `),
    ])
    const all: RunHealthItem[] = [...pipeRes.rows, ...connRes.rows].map((r) => ({
      id: String(r.id),
      kind: r.kind as 'pipeline' | 'connector',
      status: String(r.status),
      startedAt: String(r.started_at),
      finishedAt: str(r.finished_at),
      error_code: str(r.error_code),
      error_message: str(r.error_message),
      connectorId: str(r.connector_id),
      definitionVersionId: str(r.definition_version_id),
    }))
    const running = all.filter((r) => r.status === 'running')
    const failed = all
      .filter((r) => r.status === 'failed')
      .slice(0, 20)
    const recentlySucceeded = all
      .filter((r) => r.status === 'succeeded')
      .slice(0, 10)
    return {
      running,
      failed,
      recentlySucceeded,
      counts: {
        running: running.length,
        failed: failed.length,
        recentlySucceeded: recentlySucceeded.length,
      },
    }
  })

// ---------------------------------------------------------------------------
// fetchAttentionFn
// ---------------------------------------------------------------------------

export const fetchAttentionFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<AttentionItem[]> => {
    await loadAdminSession(data.workspaceId)
    const { db } = await import('#/db/client.server')
    const res = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM api.pipeline_runs WHERE workspace_id = ${data.workspaceId}::uuid AND status = 'failed' AND started_at > now() - interval '24 hours') AS failed_pipeline_runs,
        (SELECT count(*)::int FROM api.connector_runs WHERE workspace_id = ${data.workspaceId}::uuid AND status = 'failed' AND started_at > now() - interval '24 hours') AS failed_connector_runs,
        (SELECT count(*)::int FROM api.pipeline_runs WHERE workspace_id = ${data.workspaceId}::uuid AND status = 'running' AND started_at < now() - interval '15 minutes') AS stale_running_runs,
        (SELECT count(*)::int FROM api.connectors WHERE workspace_id = ${data.workspaceId}::uuid AND status = 'paused') AS disabled_connectors,
        (SELECT count(*)::int FROM api.connectors c WHERE workspace_id = ${data.workspaceId}::uuid AND c.status = 'active' AND NOT EXISTS (SELECT 1 FROM internal.connector_secrets cs WHERE cs.connector_id = c.id)) AS connectors_missing_secrets,
        (SELECT count(*)::int FROM api.pipeline_schedules WHERE workspace_id = ${data.workspaceId}::uuid AND enabled AND next_run_at IS NOT NULL AND next_run_at < now()) AS overdue_schedules
    `)
    const row = res.rows[0] as Record<string, unknown> | undefined
    const items: AttentionItem[] = []
    const failedPipeline = num(row?.failed_pipeline_runs)
    const failedConnector = num(row?.failed_connector_runs)
    const staleRunning = num(row?.stale_running_runs)
    const disabledConn = num(row?.disabled_connectors)
    const missingSecrets = num(row?.connectors_missing_secrets)
    const overdueSched = num(row?.overdue_schedules)
    if (failedPipeline > 0) {
      items.push({
        level: 'warning',
        category: 'pipeline_runs',
        message: `${failedPipeline} failed pipeline run${failedPipeline === 1 ? '' : 's'} in the last 24 hours.`,
        link: '/admin/pipelines',
      })
    }
    if (failedConnector > 0) {
      items.push({
        level: 'warning',
        category: 'connector_runs',
        message: `${failedConnector} failed connector run${failedConnector === 1 ? '' : 's'} in the last 24 hours.`,
        link: '/admin/connectors',
      })
    }
    if (staleRunning > 0) {
      items.push({
        level: 'warning',
        category: 'stale_runs',
        message: `${staleRunning} run${staleRunning === 1 ? '' : 's'} have been running longer than 15 minutes.`,
        link: '/admin/pipelines',
      })
    }
    if (missingSecrets > 0) {
      items.push({
        level: 'warning',
        category: 'connector_secrets',
        message: `${missingSecrets} active connector${missingSecrets === 1 ? '' : 's'} missing required secrets.`,
        link: '/admin/connectors',
      })
    }
    if (overdueSched > 0) {
      items.push({
        level: 'warning',
        category: 'schedules',
        message: `${overdueSched} schedule${overdueSched === 1 ? '' : 's'} are overdue.`,
        link: '/admin/pipelines',
      })
    }
    if (disabledConn > 0) {
      items.push({
        level: 'info',
        category: 'connectors',
        message: `${disabledConn} connector${disabledConn === 1 ? '' : 's'} disabled.`,
        link: '/admin/connectors',
      })
    }
    return items
  })

// ---------------------------------------------------------------------------
// fetchConnectorDiagnosticsFn
// ---------------------------------------------------------------------------

export const fetchConnectorDiagnosticsFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<ConnectorDiagnosticsResult> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )
    try {
      const { rows } = await session.client.query(
        `SELECT
          c.id, c.name, c.connector_type, c.status,
          cr.status AS last_run_status,
          cr.started_at::text AS last_run_at,
          cr.error_code AS last_error_code,
          EXISTS (SELECT 1 FROM internal.connector_secrets cs WHERE cs.connector_id = c.id) AS has_secrets,
          (SELECT count(*)::int FROM api.connector_runs cr2
           WHERE cr2.connector_id = c.id AND cr2.status = 'failed'
             AND cr2.started_at > now() - interval '7 days') AS recent_failure_count
        FROM api.connectors c
        LEFT JOIN LATERAL (
          SELECT * FROM api.connector_runs cr
          WHERE cr.connector_id = c.id
          ORDER BY cr.started_at DESC LIMIT 1
        ) cr ON true
        WHERE c.workspace_id = $1::uuid
        ORDER BY c.name ASC`,
        [data.workspaceId],
      )
      const connectors: ConnectorDiagnosticsResult['connectors'] = rows.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        name: String(r.name),
        connectorType: String(r.connector_type),
        status: String(r.status),
        lastRunStatus: str(r.last_run_status),
        lastRunAt: str(r.last_run_at),
        lastErrorCode: str(r.last_error_code),
        hasSecrets: Boolean(r.has_secrets),
        recentFailureCount: num(r.recent_failure_count),
      }))
      const activeConnectors = connectors.filter((c) => c.status === 'active').length
      const pausedConnectors = connectors.filter((c) => c.status === 'paused').length
      const recentFailures = connectors.reduce((sum, c) => sum + c.recentFailureCount, 0)
      const missingSecrets = connectors.filter((c) => c.status === 'active' && !c.hasSecrets).length
      const repeatedFailures = connectors.filter((c) => c.recentFailureCount >= 3).length
      return {
        activeConnectors,
        pausedConnectors,
        recentFailures,
        missingSecrets,
        repeatedFailures,
        connectors,
      }
    } finally {
      await session.release()
    }
  })

// ---------------------------------------------------------------------------
// togglePipelineScheduleFn — enable/disable a schedule (pipelines.manage)
// ---------------------------------------------------------------------------

export const togglePipelineScheduleFn = createServerFn({ method: 'POST' })
  .validator(
    (input: { workspaceId: string; scheduleId: string; enabled: boolean }) =>
      input,
  )
  .handler(async ({ data }) => {
    const session = await requireCapability(
      data.workspaceId,
      'pipelines.manage',
    )
    try {
      // Call the canonical RPC exactly once. Project both fields from the
      // single returned composite row to avoid double mutation.
      const { rows } = await session.client.query(
        `SELECT id, enabled
         FROM api.update_pipeline_schedule(
           $1::uuid,
           $2::uuid,
           NULL,
           NULL,
           $3
         )`,
        [data.workspaceId, data.scheduleId, data.enabled],
      )
      const row = rows[0] as Record<string, unknown> | undefined
      if (!row?.id) {
        throw new Error('Schedule not found or update failed.')
      }
      return {
        scheduleId: String(row.id),
        enabled: Boolean(row.enabled),
      }
    } finally {
      await session.release()
    }
  })

// ---------------------------------------------------------------------------
// retryConnectorRunFn — retry a failed connector run (integrations.manage)
// ---------------------------------------------------------------------------

export const retryConnectorRunFn = createServerFn({ method: 'POST' })
  .validator(
    (input: { workspaceId: string; runId: string }) => input,
  )
  .handler(async ({ data }) => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )
    try {
      // Look up the failed run to get its connector_id and retry lineage.
      const { rows: runRows } = await session.client.query(
        `SELECT connector_id, retry_of_run_id
         FROM api.connector_runs
         WHERE id = $1::uuid
           AND workspace_id = $2::uuid
           AND status = 'failed'`,
        [data.runId, data.workspaceId],
      )
      const runRow = runRows[0] as Record<string, unknown> | undefined
      if (!runRow) {
        throw new Error('Failed run not found or not in a failed state.')
      }
      const connectorId = String(runRow.connector_id)
      // Start a retry run through the canonical RPC.
      const { rows } = await session.client.query(
        `SELECT (api.start_connector_run(
           $1::uuid,
           $2::uuid,
           'manual',
           NULL,
           $3::uuid,
           NULL
         )).id AS id`,
        [data.workspaceId, connectorId, data.runId],
      )
      const row = rows[0] as Record<string, unknown> | undefined
      if (!row?.id) {
        throw new Error('Retry could not be started.')
      }
      return { runId: String(row.id) }
    } finally {
      await session.release()
    }
  })

// ---------------------------------------------------------------------------
// fetchMemberNamesFn — resolve user names/emails for workspace members
// ---------------------------------------------------------------------------
//
// workspace_memberships (exposed via PostgREST) only contains user_id, not
// name/email. internal.user is not readable by the authenticated role, so
// we use the app's DB connection which has SELECT on internal.user. This is
// safe: we only return name and email for users in the specified workspace,
// never secrets.
export const fetchMemberNamesFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => {
    await loadAdminSession(data.workspaceId)
    const { db } = await import('#/db/client.server')
    const result = await db.execute(sql`
      SELECT m.user_id, u.name, u.email
      FROM api.workspace_memberships m
      JOIN internal."user" u ON u.id = m.user_id
      WHERE m.workspace_id = ${data.workspaceId}::uuid
    `)
    const names: Record<string, { name: string; email: string }> = {}
    for (const row of result.rows) {
      names[String(row.user_id)] = {
        name: String(row.name ?? ''),
        email: String(row.email ?? ''),
      }
    }
    return names
  })
