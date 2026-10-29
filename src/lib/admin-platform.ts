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
 *
 * Server-only modules (`*.server.*`) are imported *inside* the handlers rather
 * than at module scope: the settings routes import this module in the client
 * bundle, and the build refuses a client-reachable server-only import.
 */
import { createServerFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'

import {
  INPUT_ROW_LIMIT,
  EXECUTION_TIMEOUT_SECONDS,
} from '#/lib/pipeline-limits'
import { formatFileSize } from '#/lib/format-numbers'
import { checkExtensionCompat } from '#/lib/extensions/compat'
import { t } from '#/copy'

// Scheduler configuration — mirrors the env check in
// src/lib/pipeline-scheduler.server.ts startPipelineScheduler().
function schedulerEnabled(): boolean {
  return process.env.SHEETBASE_SCHEDULER_ENABLED !== 'false'
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiagnosticsResult {
  /**
   * R5-CONFIG-01 — when the live probes in this result were evaluated. The
   * per-check "checked" timestamp for probes with no stored record.
   */
  checkedAt: string
  /**
   * R5-CONFIG-01 — most recent real record per activity stream, so each check
   * can show when it last actually ran instead of a fabricated cadence.
   */
  lastPipelineRunAt: string | null
  lastConnectorRunAt: string | null
  lastWebhookDeliveryAt: string | null
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
  datasetRetention: {
    enabled: boolean
    lastPrunedAt: string | null
    intervalSeconds: number
    prunedSnapshots24h: number
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
  /** Corrective-action destination (an /admin section route). */
  link?: string
  /** Operational runbook slug (a /docs/$name destination). */
  runbook?: string
}

/**
 * Configured workspace quota context for a usage/storage figure.
 *
 * Limits are reported only where they are actually configured. A null limit
 * means "no quota configured" — the UI must say so rather than invent a
 * theatre number, and atLimitBehaviour is null alongside it.
 */
export interface QuotaContext {
  /** Configured byte quota, or null when no quota is configured. */
  byteLimit: number | null
  /**
   * What happens at the limit (e.g. "uploads rejected"), or null when no
   * limit is configured.
   */
  atLimitBehaviour: string | null
}

/**
 * R5-CONFIG-01 — configured seat limit context. A null seatLimit means no
 * seat limit is configured, so the UI states that instead of showing a bar.
 */
export interface SeatLimitContext {
  seatLimit: number | null
  atLimitBehaviour: string | null
}

/**
 * R5-CONFIG-01 — a real monthly usage point. Only measured quantities get a
 * trend: run counts come from `pipeline_runs`/`connector_runs.started_at`.
 */
export interface UsageTrendPoint {
  /** Calendar month, `YYYY-MM`. */
  month: string
  pipelineRuns: number
  connectorRuns: number
}

export interface UsageLimits {
  fileBytes: QuotaContext
  seats: SeatLimitContext
  enabledSchedules: {
    /** Validated-scale guidance threshold, or null when not applicable. */
    validatedScaleThreshold: number | null
  }
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
  /** Real monthly run counts for the last six calendar months, oldest first. */
  trend: UsageTrendPoint[]
  /** Limit context per figure; null limits mean "no quota configured". */
  limits: UsageLimits
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
  /** Quota context; byteLimit null means no workspace quota is configured. */
  quota: QuotaContext
  largestFiles: StorageFileWire[]
  recentFiles: StorageFileWire[]
}

export interface RunHealthItem {
  id: string
  kind: 'pipeline' | 'connector' | 'webhook'
  status: string
  startedAt: string
  finishedAt: string | null
  error_code: string | null
  error_message: string | null
  connectorId: string | null
  definitionVersionId: string | null
  /** Webhook-only: the delivery's subscription id. */
  subscriptionId: string | null
  /** Webhook-only: the subscription key for display. */
  label: string | null
}

export interface WebhookRunHealthSummary {
  /** Dead-letter deliveries created in the last 24 hours. */
  deadLetter24h: number
  /** Deliveries currently awaiting (re)delivery. */
  retryDebt: number
  /** Endpoints auto-disabled after exhausting their failure threshold. */
  autoDisabled: number
}

export interface RunHealthResult {
  running: RunHealthItem[]
  failed: RunHealthItem[]
  recentlySucceeded: RunHealthItem[]
  /** Webhook delivery health folded in from EVENT-02 delivery state. */
  webhook: WebhookRunHealthSummary
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
  /** Corrective-action destination (an /admin section route). */
  link?: string
  /** Operational runbook slug (a /docs/$name destination) where one exists. */
  runbook?: string
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
  if (!context) throw new Error(t('settings.adminPlatform.mustSigned'))
  if (!context.workspace || context.workspace.id !== workspaceId) {
    throw new Error(t('settings.adminPlatform.accessWorkspace'))
  }
  if (!(await isWorkspaceMember(db, context.user.id, workspaceId))) {
    throw new Error(t('settings.adminPlatform.accessWorkspace'))
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
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({
        sub: userId,
        workspace_id: workspaceId,
        role: 'authenticated',
      }),
    ])
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

/**
 * Require the caller's role to reach a settings area at the given level, as
 * the workspace has configured it (Roles and permissions). The same check
 * the database applies to the settings RPCs, so a page's gate and its data
 * can never disagree.
 */
export async function requireSettingsArea(
  workspaceId: string,
  area: string,
  level: 'view' | 'manage' = 'view',
): Promise<void> {
  const session = await requireCapability(
    workspaceId,
    `settings.${area}.${level}`,
  )
  await session.release()
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
        timer = setTimeout(
          () => reject(new Error(t('settings.adminPlatform.timedOut'))),
          timeoutMs,
        )
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
    await requireSettingsArea(data.workspaceId, 'diagnostics')
    // Static imports of `*.server.*` are denied in the client bundle, and this
    // module is reached from the settings routes; read them here instead.
    const { env, getDeploymentConfig } = await import('#/env.server')
    const { DATASET_RETENTION_INTERVAL_MS } =
      await import('#/lib/dataset-retention-scheduler.server')
    const deployment = getDeploymentConfig()
    // R5-CONFIG-01 — the timestamp the live probes below are evaluated at, so
    // each probe-backed check can show when it was last checked.
    const checkedAt = new Date().toISOString()

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
    const [schedRes, runRes, pruneRes, lastRunRes] = await Promise.all([
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
      db.execute(sql`
        SELECT max(p.rows_removed_at)::text AS last_pruned,
               count(*) FILTER (WHERE p.rows_removed_at > now() - interval '24 hours')::int AS pruned_24h
        FROM api.dataset_version_prunes p
        JOIN api.dataset_versions v ON v.id = p.dataset_version_id
        WHERE v.workspace_id = ${data.workspaceId}::uuid
      `),
      // R5-CONFIG-01 — the real "last ran" record per activity stream, so a
      // check reports when its stream last actually did something.
      db.execute(sql`
        SELECT
          (SELECT max(started_at)::text FROM api.pipeline_runs
            WHERE workspace_id = ${data.workspaceId}::uuid) AS last_pipeline_run,
          (SELECT max(started_at)::text FROM api.connector_runs
            WHERE workspace_id = ${data.workspaceId}::uuid) AS last_connector_run,
          (SELECT max(created_at)::text FROM api.webhook_deliveries
            WHERE workspace_id = ${data.workspaceId}::uuid) AS last_webhook_delivery
      `),
    ])

    const schedRow = schedRes.rows[0] as Record<string, unknown> | undefined
    const runRow = runRes.rows[0] as Record<string, unknown> | undefined
    const pruneRow = pruneRes.rows[0] as Record<string, unknown> | undefined
    const lastRunRow = lastRunRes.rows[0] as Record<string, unknown> | undefined

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

    const healthStatus =
      !dbOk || !pgrOk
        ? 'not_ready'
        : migrationStatus === 'incompatible'
          ? 'degraded'
          : 'ready'

    // Scheduler state: report the actual env-driven enabled flag and use
    // last_evaluated_at only as a best-effort signal, not a heartbeat.
    // When there are no enabled schedules, last_evaluated_at may be NULL even
    // if the scheduler is running perfectly — report status accordingly.
    const schedEnabled = schedulerEnabled()
    const schedLastSweep = str(schedRow?.last_sweep ?? null)
    const enabledScheduleCount = num(schedRow?.enabled_count ?? 0)

    return {
      checkedAt,
      lastPipelineRunAt: str(lastRunRow?.last_pipeline_run ?? null),
      lastConnectorRunAt: str(lastRunRow?.last_connector_run ?? null),
      lastWebhookDeliveryAt: str(lastRunRow?.last_webhook_delivery ?? null),
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
      datasetRetention: {
        // Same SHEETBASE_SCHEDULER_ENABLED gate as the pipeline scheduler.
        enabled: schedEnabled,
        lastPrunedAt: str(pruneRow?.last_pruned ?? null),
        intervalSeconds: DATASET_RETENTION_INTERVAL_MS / 1000,
        prunedSnapshots24h: num(pruneRow?.pruned_24h ?? 0),
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
    await requireSettingsArea(data.workspaceId, 'usage')
    const { db } = await import('#/db/client.server')
    const [res, trendRes] = await Promise.all([
      db.execute(sql`
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
      `),
      // R5-CONFIG-01 — a trend only for what this deployment measures: run
      // counts grouped from the real run records over six calendar months.
      db.execute(sql`
        SELECT to_char(m, 'YYYY-MM') AS month,
               (SELECT count(*) FROM api.pipeline_runs r
                 WHERE r.workspace_id = ${data.workspaceId}::uuid
                   AND date_trunc('month', r.started_at) = m)::int AS pipeline_runs,
               (SELECT count(*) FROM api.connector_runs c
                 WHERE c.workspace_id = ${data.workspaceId}::uuid
                   AND date_trunc('month', c.started_at) = m)::int AS connector_runs
        FROM generate_series(
          date_trunc('month', now()) - interval '5 months',
          date_trunc('month', now()),
          interval '1 month'
        ) AS m
        ORDER BY m
      `),
    ])
    const row = res.rows[0] as Record<string, unknown> | undefined
    const fileBytes = num(row?.file_bytes)
    const members = num(row?.members)
    const enabledSchedules = num(row?.enabled_schedules)
    const plan = await workspacePlanLimits()
    const quota = plan.quota
    const seatLimit = plan.seats.seatLimit
    const trend: UsageTrendPoint[] = trendRes.rows.map((r) => ({
      month: String(r.month),
      pipelineRuns: num(r.pipeline_runs),
      connectorRuns: num(r.connector_runs),
    }))
    // Warnings come from configured limits where one exists; otherwise the
    // figure is labelled observed usage and never shown as a quota. The
    // schedule threshold is validated-scale guidance, not a quota.
    const capacityWarnings: CapacityWarning[] = []
    if (enabledSchedules > SCHEDULE_VALIDATED_SCALE) {
      capacityWarnings.push({
        level: 'warning',
        category: 'schedules',
        message: t('settings.adminPlatform.enabledPipelineSchedulesMessage', {
          enabledSchedules,
          limit: SCHEDULE_VALIDATED_SCALE,
        }),
        link: '/admin/pipelines',
        runbook: 'observability',
      })
    }
    const storageLevel = usageWarnLevel(fileBytes, quota.byteLimit)
    if (quota.byteLimit != null && storageLevel) {
      const percent = Math.round((fileBytes / quota.byteLimit) * 100)
      capacityWarnings.push({
        level: 'warning',
        category: 'file_storage',
        message: t('settings.adminPlatform.fileStorageQuotaMessage', {
          percent,
          used: formatFileSize(fileBytes),
          limit: formatFileSize(quota.byteLimit),
          behaviour: quota.atLimitBehaviour ?? '',
        }).trim(),
        link: '/settings/usage',
        runbook: 'administration',
      })
    } else if (quota.byteLimit == null && fileBytes > 10_000_000_000) {
      capacityWarnings.push({
        level: 'warning',
        category: 'file_storage',
        message: t('settings.adminPlatform.workspaceFileStorageMessage'),
        link: '/admin/storage',
        runbook: 'administration',
      })
    }
    const seatLevel = usageWarnLevel(members, seatLimit)
    if (seatLimit != null && seatLevel) {
      const percent = Math.round((members / seatLimit) * 100)
      capacityWarnings.push({
        level: 'warning',
        category: 'seats',
        message: t('settings.adminPlatform.seatLimitMessage', {
          percent,
          members,
          seatLimit,
          behaviour: plan.seats.atLimitBehaviour ?? '',
        }).trim(),
        link: '/settings/members',
      })
    }
    return {
      members,
      records: num(row?.records),
      datasets: num(row?.datasets),
      datasetVersions: num(row?.dataset_versions),
      files: num(row?.files),
      fileBytes,
      connectors: num(row?.connectors),
      pipelineDefinitions: num(row?.pipeline_definitions),
      pipelineRuns: num(row?.pipeline_runs),
      connectorRuns: num(row?.connector_runs),
      trend,
      limits: {
        fileBytes: quota,
        seats: plan.seats,
        enabledSchedules: {
          validatedScaleThreshold: SCHEDULE_VALIDATED_SCALE,
        },
      },
      capacityWarnings,
    }
  })

// ---------------------------------------------------------------------------
// fetchStorageOverviewFn
// ---------------------------------------------------------------------------

export const fetchStorageOverviewFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<StorageOverviewResult> => {
    await requireSettingsArea(data.workspaceId, 'usage')
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
      // A null byteLimit (no configured quota) tells the UI to label figures
      // as observed usage rather than against a limit.
      quota: (await workspacePlanLimits()).quota,
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
    await requireSettingsArea(data.workspaceId, 'diagnostics')
    const { db } = await import('#/db/client.server')
    // Webhook delivery health comes from EVENT-02 delivery state directly:
    // dead_letter rows are the failed jobs of the webhook plane, and
    // pending/retrying rows are its retry debt. Read here (any-member
    // run-health surface) rather than through the integrations.manage-gated
    // endpoint-health RPC — no secrets are involved.
    const [pipeRes, connRes, hookRes, hookSummaryRes] = await Promise.all([
      db.execute(sql`
        SELECT id, 'pipeline' AS kind, status, started_at::text, finished_at::text,
               error_code, error_message, NULL::text AS connector_id, definition_version_id::text,
               NULL::text AS subscription_id, NULL::text AS label
        FROM api.pipeline_runs
        WHERE workspace_id = ${data.workspaceId}::uuid
        ORDER BY started_at DESC
        LIMIT 50
      `),
      db.execute(sql`
        SELECT id, 'connector' AS kind, status, started_at::text, finished_at::text,
               error_code, error_message, connector_id::text, NULL::text AS definition_version_id,
               NULL::text AS subscription_id, NULL::text AS label
        FROM api.connector_runs
        WHERE workspace_id = ${data.workspaceId}::uuid
        ORDER BY started_at DESC
        LIMIT 50
      `),
      db.execute(sql`
        SELECT d.id, 'webhook' AS kind, d.status, d.created_at::text AS started_at,
               d.delivered_at::text AS finished_at,
               d.error_code, d.error_message, NULL::text AS connector_id,
               NULL::text AS definition_version_id,
               d.subscription_id::text AS subscription_id, s.key AS label
        FROM api.webhook_deliveries d
        JOIN api.webhook_subscriptions s ON s.id = d.subscription_id
        WHERE d.workspace_id = ${data.workspaceId}::uuid
          AND d.status = 'dead_letter'
          AND d.created_at > now() - interval '24 hours'
        ORDER BY d.created_at DESC
        LIMIT 20
      `),
      db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM api.webhook_deliveries WHERE workspace_id = ${data.workspaceId}::uuid AND status = 'dead_letter' AND created_at > now() - interval '24 hours') AS dead_letter_24h,
          (SELECT count(*)::int FROM api.webhook_deliveries WHERE workspace_id = ${data.workspaceId}::uuid AND status IN ('pending', 'retrying')) AS retry_debt,
          (SELECT count(*)::int FROM api.webhook_subscriptions WHERE workspace_id = ${data.workspaceId}::uuid AND status = 'disabled' AND failure_threshold > 0 AND consecutive_failures >= failure_threshold) AS auto_disabled
      `),
    ])
    const all: RunHealthItem[] = [
      ...pipeRes.rows,
      ...connRes.rows,
      ...hookRes.rows,
    ].map((r) => ({
      id: String(r.id),
      kind: r.kind as 'pipeline' | 'connector' | 'webhook',
      status: String(r.status),
      startedAt: String(r.started_at),
      finishedAt: str(r.finished_at),
      error_code: str(r.error_code),
      error_message: str(r.error_message),
      connectorId: str(r.connector_id),
      definitionVersionId: str(r.definition_version_id),
      subscriptionId: str(r.subscription_id),
      label: str(r.label),
    }))
    const running = all.filter((r) => r.status === 'running')
    const failed = all
      .filter((r) => r.status === 'failed' || r.status === 'dead_letter')
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, 20)
    const recentlySucceeded = all
      .filter((r) => r.status === 'succeeded')
      .slice(0, 10)
    const summaryRow = hookSummaryRes.rows[0] as
      Record<string, unknown> | undefined
    return {
      running,
      failed,
      recentlySucceeded,
      webhook: {
        deadLetter24h: num(summaryRow?.dead_letter_24h),
        retryDebt: num(summaryRow?.retry_debt),
        autoDisabled: num(summaryRow?.auto_disabled),
      },
      counts: {
        running: running.length,
        failed: failed.length,
        recentlySucceeded: recentlySucceeded.length,
      },
    }
  })
// ---------------------------------------------------------------------------
// Pure attention builders (ADMIN-03) — exported for unit testing. The
// handlers above/below supply counts from existing state; these functions
// own the deterministic mapping to actionable items.
// ---------------------------------------------------------------------------

/** Validated-scale guidance for enabled pipeline schedules (not a quota). */
export const SCHEDULE_VALIDATED_SCALE = 100

/**
 * R5-CONFIG-01 — build a quota context from configuration. A null/absent limit
 * means "no quota configured": the UI must say so rather than invent a number,
 * and `atLimitBehaviour` is null alongside it.
 */
export function resolveQuotaContext(
  byteLimit: number | null | undefined,
  atLimitBehaviour: string | null = null,
): QuotaContext {
  return byteLimit == null
    ? { byteLimit: null, atLimitBehaviour: null }
    : { byteLimit, atLimitBehaviour }
}

/** R5-CONFIG-01 — build a seat-limit context from configuration. */
export function resolveSeatLimit(
  seatLimit: number | null | undefined,
  atLimitBehaviour: string | null = null,
): SeatLimitContext {
  return seatLimit == null
    ? { seatLimit: null, atLimitBehaviour: null }
    : { seatLimit, atLimitBehaviour }
}

/**
 * R5-CONFIG-01 — warning level for a measured figure against a configured
 * limit. Null when no limit is configured (or the limit is not positive), so an
 * unmeasured or unlimited figure never gets a bar or a threshold colour.
 * ≥90% is danger, ≥80% warning.
 */
export function usageWarnLevel(
  used: number,
  limit: number | null | undefined,
): 'warning' | 'danger' | null {
  if (limit == null || limit <= 0) return null
  const percent = (used / limit) * 100
  if (percent >= 90) return 'danger'
  if (percent >= 80) return 'warning'
  return null
}

/**
 * R5-CONFIG-01 — plan limits served with usage/storage figures, sourced from
 * deployment configuration (`SHEETBASE_WORKSPACE_STORAGE_QUOTA_BYTES`,
 * `SHEETBASE_WORKSPACE_SEAT_LIMIT`). Unset means no limit is configured, so the
 * context reports null and the UI states that instead of inventing a number.
 *
 * Read inside the server handlers: `env` is server-only, so it must not be
 * touched at module scope (the module is also imported by the client bundle).
 */
export async function workspacePlanLimits(): Promise<{
  quota: QuotaContext
  seats: SeatLimitContext
}> {
  // Server-only: a static import would be denied in the client bundle, so the
  // limits are read when the server handler asks for them.
  const { env } = await import('#/env.server')
  return {
    quota: resolveQuotaContext(
      env.SHEETBASE_WORKSPACE_STORAGE_QUOTA_BYTES ?? null,
      'uploads are rejected once the quota is reached',
    ),
    seats: resolveSeatLimit(
      env.SHEETBASE_WORKSPACE_SEAT_LIMIT ?? null,
      'new members cannot be invited once the seat limit is reached',
    ),
  }
}

/** Aggregate counts feeding the attention model. */
export interface AttentionCounts {
  failedPipelineRuns: number
  failedConnectorRuns: number
  deadLetterDeliveries: number
  webhookRetryDebt: number
  autoDisabledEndpoints: number
  failingEndpoints: number
  staleRunningRuns: number
  connectorsMissingSecrets: number
  overdueSchedules: number
  expiredCredentials: number
  expiringCredentials: number
  staleCredentials: number
  disabledConnectors: number
  disabledExtensions: number
}

/**
 * Map aggregate counts plus incompatible-extension keys to attention items.
 * Every item carries a corrective-action link; items with an operational
 * runbook carry its docs slug too.
 */
export function buildAttentionItems(
  counts: AttentionCounts,
  incompatibleExtensionKeys: string[],
): AttentionItem[] {
  const items: AttentionItem[] = []
  if (counts.failedPipelineRuns > 0) {
    items.push({
      level: 'warning',
      category: 'pipeline_runs',
      message: t('settings.adminPlatform.attention.failedPipelineRuns', {
        count: counts.failedPipelineRuns,
      }),
      link: '/admin/pipelines',
      runbook: 'observability',
    })
  }
  if (counts.failedConnectorRuns > 0) {
    items.push({
      level: 'warning',
      category: 'connector_runs',
      message: t('settings.adminPlatform.attention.failedConnectorRuns', {
        count: counts.failedConnectorRuns,
      }),
      link: '/admin/connectors',
      runbook: 'observability',
    })
  }
  if (counts.deadLetterDeliveries > 0) {
    items.push({
      level: 'warning',
      category: 'webhook_deliveries',
      message: t('settings.adminPlatform.attention.deadLetterDeliveries', {
        count: counts.deadLetterDeliveries,
      }),
      link: '/admin/webhooks',
      runbook: 'observability',
    })
  }
  if (counts.webhookRetryDebt > 0) {
    items.push({
      level: 'warning',
      category: 'webhook_retry_debt',
      message: t('settings.adminPlatform.attention.webhookRetryDebt', {
        count: counts.webhookRetryDebt,
      }),
      link: '/admin/webhooks',
      runbook: 'observability',
    })
  }
  if (counts.autoDisabledEndpoints > 0) {
    items.push({
      level: 'warning',
      category: 'webhook_endpoints',
      message: t('settings.adminPlatform.attention.autoDisabledEndpoints', {
        count: counts.autoDisabledEndpoints,
      }),
      link: '/admin/webhooks',
      runbook: 'observability',
    })
  }
  if (counts.failingEndpoints > 0) {
    items.push({
      level: 'warning',
      category: 'webhook_endpoints',
      message: t('settings.adminPlatform.attention.failingEndpoints', {
        count: counts.failingEndpoints,
      }),
      link: '/admin/webhooks',
      runbook: 'observability',
    })
  }
  if (counts.staleRunningRuns > 0) {
    items.push({
      level: 'warning',
      category: 'stale_runs',
      message: t('settings.adminPlatform.attention.staleRunningRuns', {
        count: counts.staleRunningRuns,
      }),
      link: '/admin/pipelines',
      runbook: 'observability',
    })
  }
  if (counts.connectorsMissingSecrets > 0) {
    items.push({
      level: 'warning',
      category: 'connector_secrets',
      message: t('settings.adminPlatform.attention.connectorsMissingSecrets', {
        count: counts.connectorsMissingSecrets,
      }),
      link: '/admin/connectors',
      runbook: 'administration',
    })
  }
  if (counts.overdueSchedules > 0) {
    items.push({
      level: 'warning',
      category: 'schedules',
      message: t('settings.adminPlatform.attention.overdueSchedules', {
        count: counts.overdueSchedules,
      }),
      link: '/admin/pipelines',
      runbook: 'observability',
    })
  }
  if (counts.expiredCredentials > 0) {
    items.push({
      level: 'warning',
      category: 'api_credentials',
      message: t('settings.adminPlatform.attention.expiredCredentials', {
        count: counts.expiredCredentials,
      }),
      link: '/admin/api-credentials',
      runbook: 'security',
    })
  }
  if (counts.expiringCredentials > 0) {
    items.push({
      level: 'warning',
      category: 'api_credentials',
      message: t('settings.adminPlatform.attention.expiringCredentials', {
        count: counts.expiringCredentials,
      }),
      link: '/admin/api-credentials',
      runbook: 'security',
    })
  }
  if (counts.staleCredentials > 0) {
    items.push({
      level: 'info',
      category: 'api_credentials',
      message: t('settings.adminPlatform.attention.staleCredentials', {
        count: counts.staleCredentials,
      }),
      link: '/admin/api-credentials',
      runbook: 'security',
    })
  }
  if (counts.disabledConnectors > 0) {
    items.push({
      level: 'info',
      category: 'connectors',
      message: t('settings.adminPlatform.attention.disabledConnectors', {
        count: counts.disabledConnectors,
      }),
      link: '/admin/connectors',
    })
  }
  if (incompatibleExtensionKeys.length > 0) {
    items.push({
      level: 'warning',
      category: 'extensions',
      message: t('settings.adminPlatform.attention.incompatibleExtensions', {
        count: incompatibleExtensionKeys.length,
        keys: `${incompatibleExtensionKeys.slice(0, 3).join(', ')}${incompatibleExtensionKeys.length > 3 ? ', …' : ''}`,
      }),
      link: '/admin/extensions',
      runbook: 'administration',
    })
  }
  if (counts.disabledExtensions > 0) {
    items.push({
      level: 'info',
      category: 'extensions',
      message: t('settings.adminPlatform.attention.disabledExtensions', {
        count: counts.disabledExtensions,
      }),
      link: '/admin/extensions',
    })
  }
  return items
}

/**
 * Keys of extension installs whose declared `compatibleWith` range is
 * violated by the running app version. Unknown compatibility (no range,
 * unparsable version) never reports — warn loudly only on a declared
 * violation, per EXT-03.
 */
export function findIncompatibleExtensionKeys(
  rows: Array<{ key: unknown; compatible_with: unknown }>,
  appVersion: string,
): string[] {
  return rows
    .filter(
      (r) =>
        checkExtensionCompat(
          {
            compatibleWith:
              typeof r.compatible_with === 'string' ? r.compatible_with : null,
          },
          appVersion,
        ) === 'incompatible',
    )
    .map((r) => String(r.key))
}

// ---------------------------------------------------------------------------
// fetchAttentionFn
// ---------------------------------------------------------------------------

export const fetchAttentionFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<AttentionItem[]> => {
    await requireSettingsArea(data.workspaceId, 'diagnostics')
    const { db } = await import('#/db/client.server')
    // Every warning below derives from existing state — no new tracking
    // tables. Each carries a corrective-action link (an /admin section) and,
    // where an operational runbook exists, a runbook slug (a /docs/$name
    // destination from the docs allowlist).
    const [res, extRes] = await Promise.all([
      db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM api.pipeline_runs WHERE workspace_id = ${data.workspaceId}::uuid AND status = 'failed' AND started_at > now() - interval '24 hours') AS failed_pipeline_runs,
        (SELECT count(*)::int FROM api.connector_runs WHERE workspace_id = ${data.workspaceId}::uuid AND status = 'failed' AND started_at > now() - interval '24 hours') AS failed_connector_runs,
        (SELECT count(*)::int FROM api.pipeline_runs WHERE workspace_id = ${data.workspaceId}::uuid AND status = 'running' AND started_at < now() - interval '15 minutes') AS stale_running_runs,
        (SELECT count(*)::int FROM api.connectors WHERE workspace_id = ${data.workspaceId}::uuid AND status = 'paused') AS disabled_connectors,
        (SELECT count(*)::int FROM api.connectors c WHERE workspace_id = ${data.workspaceId}::uuid AND c.status = 'active' AND NOT EXISTS (SELECT 1 FROM internal.connector_secrets cs WHERE cs.connector_id = c.id)) AS connectors_missing_secrets,
        (SELECT count(*)::int FROM api.pipeline_schedules WHERE workspace_id = ${data.workspaceId}::uuid AND enabled AND next_run_at IS NOT NULL AND next_run_at < now()) AS overdue_schedules,
        (SELECT count(*)::int FROM api.webhook_deliveries WHERE workspace_id = ${data.workspaceId}::uuid AND status = 'dead_letter' AND created_at > now() - interval '24 hours') AS dead_letter_deliveries,
        (SELECT count(*)::int FROM api.webhook_deliveries WHERE workspace_id = ${data.workspaceId}::uuid AND status IN ('pending', 'retrying')) AS webhook_retry_debt,
        (SELECT count(*)::int FROM api.webhook_subscriptions WHERE workspace_id = ${data.workspaceId}::uuid AND status = 'disabled' AND failure_threshold > 0 AND consecutive_failures >= failure_threshold) AS auto_disabled_endpoints,
        (SELECT count(*)::int FROM api.webhook_subscriptions WHERE workspace_id = ${data.workspaceId}::uuid AND status = 'active' AND consecutive_failures > 0) AS failing_endpoints,
        (SELECT count(*)::int FROM api.extensions WHERE workspace_id = ${data.workspaceId}::uuid AND status = 'disabled') AS disabled_extensions,
        (SELECT count(*)::int FROM internal.api_credentials WHERE workspace_id = ${data.workspaceId}::uuid AND kind = 'service' AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at < now()) AS expired_credentials,
        (SELECT count(*)::int FROM internal.api_credentials WHERE workspace_id = ${data.workspaceId}::uuid AND kind = 'service' AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at >= now() AND expires_at < now() + interval '30 days') AS expiring_credentials,
        (SELECT count(*)::int FROM internal.api_credentials WHERE workspace_id = ${data.workspaceId}::uuid AND kind = 'service' AND revoked_at IS NULL AND (last_used_at IS NULL AND created_at < now() - interval '90 days' OR last_used_at < now() - interval '90 days')) AS stale_credentials
    `),
      db.execute(sql`
        SELECT key, status, manifest->>'compatibleWith' AS compatible_with
        FROM api.extensions
        WHERE workspace_id = ${data.workspaceId}::uuid
      `),
    ])
    const row = res.rows[0] as Record<string, unknown> | undefined
    const counts: AttentionCounts = {
      failedPipelineRuns: num(row?.failed_pipeline_runs),
      failedConnectorRuns: num(row?.failed_connector_runs),
      deadLetterDeliveries: num(row?.dead_letter_deliveries),
      webhookRetryDebt: num(row?.webhook_retry_debt),
      autoDisabledEndpoints: num(row?.auto_disabled_endpoints),
      failingEndpoints: num(row?.failing_endpoints),
      staleRunningRuns: num(row?.stale_running_runs),
      connectorsMissingSecrets: num(row?.connectors_missing_secrets),
      overdueSchedules: num(row?.overdue_schedules),
      expiredCredentials: num(row?.expired_credentials),
      expiringCredentials: num(row?.expiring_credentials),
      staleCredentials: num(row?.stale_credentials),
      disabledConnectors: num(row?.disabled_connectors),
      disabledExtensions: num(row?.disabled_extensions),
    }
    // Incompatible extensions (EXT-03): computed against the running app
    // version via the shared compat check — unknown never warns.
    // Server-only module: a static import would be denied in the client bundle.
    const { getDeploymentConfig } = await import('#/env.server')
    const appVersion = getDeploymentConfig().artifact.version
    const incompatibleKeys = findIncompatibleExtensionKeys(
      extRes.rows as Array<{ key: unknown; compatible_with: unknown }>,
      appVersion,
    )
    return buildAttentionItems(counts, incompatibleKeys)
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
      const connectors: ConnectorDiagnosticsResult['connectors'] = rows.map(
        (r: Record<string, unknown>) => ({
          id: String(r.id),
          name: String(r.name),
          connectorType: String(r.connector_type),
          status: String(r.status),
          lastRunStatus: str(r.last_run_status),
          lastRunAt: str(r.last_run_at),
          lastErrorCode: str(r.last_error_code),
          hasSecrets: Boolean(r.has_secrets),
          recentFailureCount: num(r.recent_failure_count),
        }),
      )
      const activeConnectors = connectors.filter(
        (c) => c.status === 'active',
      ).length
      const pausedConnectors = connectors.filter(
        (c) => c.status === 'paused',
      ).length
      const recentFailures = connectors.reduce(
        (sum, c) => sum + c.recentFailureCount,
        0,
      )
      const missingSecrets = connectors.filter(
        (c) => c.status === 'active' && !c.hasSecrets,
      ).length
      const repeatedFailures = connectors.filter(
        (c) => c.recentFailureCount >= 3,
      ).length
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
        throw new Error(t('settings.adminPlatform.scheduleFoundUpdate'))
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
  .validator((input: { workspaceId: string; runId: string }) => input)
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
        throw new Error(t('settings.adminPlatform.failedRunFound'))
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
        throw new Error(t('settings.adminPlatform.retryCouldStarted'))
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
