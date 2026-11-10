/**
 * OpenLineage emitter: turns runs, imports, instrument runs, plate runs and
 * worklists into RunEvents for each workspace's lineage endpoints.
 *
 * Nothing is sent until an admin adds an endpoint and switches it on. Each
 * enabled endpoint follows the change log from where it was switched on; every
 * relevant change becomes a row in the outbox (api.lineage_deliveries), which is
 * delivered with growing waits and given up on after eight tries.
 */
import type { QueryResultRow } from 'pg'

import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { logger } from '../logger'
import {
  deriveConnectorSecretKey,
  openSecret,
} from '../connector-secrets.server'
import {
  buildRunEvent,
  eventTypeForRunStatus,
  lineageIntent,
} from './openlineage'
import type { LineageActivity, LineageDatasetRef } from './openlineage'
import type { ChangeEventInput } from '#/lib/webhook-events'

declare global {
  var __sheetbaseLineageSchedulerStarted: unknown
}

export const LINEAGE_SWEEP_INTERVAL_MS = 15_000
const BATCH = 200
const SEND_TIMEOUT_MS = 15_000

export interface LineageConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
  end: () => Promise<void>
}

export interface LineageSweepDeps {
  connect: () => Promise<LineageConnection>
  fetch?: typeof fetch
  artifactVersion?: string
}

interface TargetRow {
  id: string
  workspace_id: string
  endpoint_url: string
  namespace: string
  auth_header_name: string
  last_sequence: string
}

interface ChangeRow {
  id: string
  sequence: string
  entity_type: string
  operation: string
  entity_uuid: string
  payload: ChangeEventInput['payload']
  created_at: string
}

async function datasetRef(
  conn: LineageConnection,
  versionId: string,
): Promise<LineageDatasetRef | null> {
  const { rows } = await conn.query<{
    dataset_id: string
    name: string
    schema_version_id: string
  }>(
    `SELECT v.dataset_id, d.name, v.schema_version_id
       FROM api.dataset_versions v JOIN api.datasets d ON d.id = v.dataset_id
      WHERE v.id = $1`,
    [versionId],
  )

  const row = rows.at(0)

  if (!row) return null

  const { rows: fields } = await conn.query<{ key: string }>(
    `SELECT key FROM api.dataset_schema_version_fields
      WHERE schema_version_id = $1 AND lifecycle = 'active' ORDER BY display_order, key`,
    [row.schema_version_id],
  )

  return {
    datasetId: row.dataset_id,
    name: row.name,
    versionId,
    columns: fields.map((f) => f.key),
  }
}

/** Finish a change into an activity by reading the rows behind it; null to skip. */
export async function activityFor(
  conn: LineageConnection,
  change: ChangeRow,
): Promise<LineageActivity | null> {
  const intent = lineageIntent({
    entityType: change.entity_type,
    operation: change.operation,
    payload: change.payload,
  })

  if (!intent) return null

  const base: Pick<
    LineageActivity,
    'eventTime' | 'runId' | 'jobType' | 'inputs' | 'outputs'
  > = {
    eventTime: new Date(change.created_at).toISOString(),
    runId: change.entity_uuid,
    jobType: intent.kind,
    inputs: [],
    outputs: [],
  }

  if (intent.kind === 'PIPELINE') {
    const { rows } = await conn.query<{
      status: string
      input_versions: Record<string, string> | null
      error_message: string | null
      key: string
    }>(
      `SELECT r.status, r.input_versions, r.error_message, d.key
         FROM api.pipeline_runs r
         JOIN api.pipeline_definition_versions v ON v.id = r.definition_version_id
         JOIN api.pipeline_definitions d ON d.id = v.definition_id
        WHERE r.id = $1`,
      [change.entity_uuid],
    )

    const run = rows.at(0)

    if (!run) return null

    const eventType =
      intent.eventType === 'FROM_STATUS'
        ? eventTypeForRunStatus(run.status)
        : intent.eventType

    if (!eventType) return null

    const activity: LineageActivity = {
      ...base,
      eventType,
      jobName: `pipeline.${run.key}`,
    }

    for (const versionId of Object.values(run.input_versions ?? {})) {
      const ref = await datasetRef(conn, versionId)

      if (ref) activity.inputs.push(ref)
    }

    if (eventType === 'COMPLETE') {
      const { rows: outs } = await conn.query<{ dataset_version_id: string }>(
        `SELECT dataset_version_id FROM api.pipeline_run_outputs WHERE run_id = $1`,
        [change.entity_uuid],
      )

      for (const out of outs) {
        const ref = await datasetRef(conn, out.dataset_version_id)

        if (ref) activity.outputs.push(ref)
      }
    }

    if (eventType === 'FAIL') activity.errorMessage = run.error_message

    return activity
  }

  const eventType = intent.eventType === 'FROM_STATUS' ? null : intent.eventType

  if (!eventType) return null

  if (intent.kind === 'IMPORT') {
    const { rows } = await conn.query<{
      dataset_id: string
      snapshot_version_id: string | null
      error_detail: string | null
    }>(
      `SELECT dataset_id, snapshot_version_id, error_detail FROM api.dataset_imports WHERE id = $1`,
      [change.entity_uuid],
    )

    const row = rows.at(0)

    if (!row) return null

    const activity: LineageActivity = {
      ...base,
      eventType,
      jobName: `import.${row.dataset_id}`,
    }

    if (eventType === 'COMPLETE' && row.snapshot_version_id) {
      const ref = await datasetRef(conn, row.snapshot_version_id)

      if (ref) activity.outputs.push(ref)
    }

    if (eventType === 'FAIL') activity.errorMessage = row.error_detail

    return activity
  }

  if (intent.kind === 'INSTRUMENT') {
    const { rows } = await conn.query<{
      instrument_id: string
      error_message: string | null
    }>(
      `SELECT instrument_id, error_message FROM api.instrument_runs WHERE id = $1`,
      [change.entity_uuid],
    )

    if (!rows[0]) return null

    return {
      ...base,
      eventType,
      jobName: `instrument-run.${rows[0].instrument_id}`,
      errorMessage: eventType === 'FAIL' ? rows[0].error_message : null,
    }
  }

  if (intent.kind === 'PLATE') {
    const { rows } = await conn.query<{ design_id: string | null }>(
      `SELECT design_id FROM api.plate_runs WHERE id = $1`,
      [change.entity_uuid],
    )

    if (!rows[0]) return null

    return {
      ...base,
      eventType,
      jobName: `plate-run.${rows[0].design_id ?? 'adhoc'}`,
    }
  }

  const { rows } = await conn.query<{ format: string }>(
    `SELECT format FROM api.plate_worklists WHERE id = $1`,
    [change.entity_uuid],
  )

  if (!rows[0]) return null

  return { ...base, eventType, jobName: `worklist.${rows[0].format}` }
}

/** Turn new change events into outbox rows for every enabled endpoint. */
export async function enqueueLineage(
  conn: LineageConnection,
  artifactVersion: string,
): Promise<number> {
  const { rows: targets } = await conn.query<TargetRow>(
    `SELECT id, workspace_id, endpoint_url, namespace, auth_header_name, last_sequence::text
       FROM api.lineage_targets WHERE enabled`,
  )

  let queued = 0

  for (const target of targets) {
    const { rows: changes } = await conn.query<ChangeRow>(
      `SELECT id, sequence::text, entity_type, operation, entity_uuid, payload, created_at::text
         FROM api.change_events
        WHERE workspace_id = $1 AND sequence > $2
          AND entity_type IN ('pipeline_run','dataset_import','instrument_run','plate_run','plate_worklist')
        ORDER BY sequence LIMIT $3`,
      [target.workspace_id, target.last_sequence, BATCH],
    )

    let cursor = target.last_sequence

    for (const change of changes) {
      const activity = await activityFor(conn, change)

      if (activity) {
        const body = buildRunEvent(activity, target.namespace, artifactVersion)
        await conn.query(
          `INSERT INTO api.lineage_deliveries
             (workspace_id, target_id, change_event_id, event_type, job_name, run_id, body)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING`,
          [
            target.workspace_id,
            target.id,
            change.id,
            activity.eventType,
            activity.jobName,
            activity.runId,
            JSON.stringify(body),
          ],
        )
        queued++
      }

      cursor = change.sequence
    }

    if (cursor !== target.last_sequence) {
      await conn.query(
        `UPDATE api.lineage_targets SET last_sequence = $2 WHERE id = $1`,
        [target.id, cursor],
      )
    }
  }

  return queued
}

function secretKey(): Buffer {
  return deriveConnectorSecretKey(env.BETTER_AUTH_SECRET)
}

/** POST one body to a target. Returns the HTTP status; throws on network failure. */
export async function sendToTarget(
  target: Pick<TargetRow, 'endpoint_url' | 'auth_header_name'>,
  sealedSecret: string | null,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw outbox transport delegates serialization to JSON.stringify, preserving native toJSON/getters, undefined bodies and serialization failures.
  body: unknown,
  doFetch: typeof fetch = fetch,
): Promise<number> {
  const headers: RequestInit['headers'] = { 'content-type': 'application/json' }

  if (sealedSecret) {
    headers[target.auth_header_name] = openSecret(sealedSecret, secretKey())
  }

  const response = await doFetch(target.endpoint_url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  })

  return response.status
}

/** Deliver what is due. */
export async function deliverLineage(
  conn: LineageConnection,
  doFetch: typeof fetch = fetch,
): Promise<{ delivered: number; failed: number }> {
  const { rows } = await conn.query<{
    id: string
    body: unknown
    endpoint_url: string
    auth_header_name: string
    sealed: string | null
  }>(
    `SELECT d.id, d.body, t.endpoint_url, t.auth_header_name, s.sealed
       FROM api.lineage_deliveries d
       JOIN api.lineage_targets t ON t.id = d.target_id AND t.enabled
       LEFT JOIN internal.lineage_target_secrets s ON s.target_id = t.id
      WHERE d.status = 'pending' AND d.next_attempt_at <= now()
      ORDER BY d.created_at LIMIT 50`,
  )

  let delivered = 0
  let failed = 0

  for (const row of rows) {
    try {
      const status = await sendToTarget(row, row.sealed, row.body, doFetch)

      if (status >= 200 && status < 300) {
        await conn.query(`SELECT internal.lineage_delivery_succeeded($1, $2)`, [
          row.id,
          status,
        ])
        delivered++
      } else {
        await conn.query(
          `SELECT internal.lineage_delivery_failed($1, $2, $3)`,
          [row.id, `The service answered ${status}.`, status],
        )
        failed++
      }
    } catch (error) {
      await conn.query(
        `SELECT internal.lineage_delivery_failed($1, $2, NULL)`,
        [row.id, error instanceof Error ? error.message : String(error)],
      )
      failed++
    }
  }

  return { delivered, failed }
}

export async function sweepLineage(
  deps: LineageSweepDeps,
): Promise<{ queued: number; delivered: number; failed: number }> {
  const conn = await deps.connect()

  try {
    const queued = await enqueueLineage(
      conn,
      deps.artifactVersion ?? env.SHEETBASE_ARTIFACT_VERSION,
    )

    return { queued, ...(await deliverLineage(conn, deps.fetch)) }
  } finally {
    await conn.end()
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let running = false
const startedKey = '__sheetbaseLineageSchedulerStarted'

function disabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true

  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

export function startLineageScheduler(): void {
  if (typeof window !== 'undefined' || disabled()) return

  if (globalThis[startedKey]) return
  globalThis[startedKey] = true

  const tick = async () => {
    if (running) return
    running = true

    try {
      await sweepLineage({
        connect: async () => {
          const client = new PooledClient({
            connectionString: env.DATABASE_URL,
          })

          await client.connect()

          return client
        },
      })
    } catch (error) {
      logger.warn('lineage sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      running = false
    }
  }

  timer = setInterval(() => void tick(), LINEAGE_SWEEP_INTERVAL_MS)
  timer.unref()
}

export function stopLineageScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
  delete globalThis[startedKey]
}
