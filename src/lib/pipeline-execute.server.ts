/**
 * AUTO-02 — deterministic Pipeline execution (server-side).
 *
 * The transform SQL runs in a dedicated low-privilege `pipeline_worker`
 * session role with zero table grants, a temp-schema-only search_path and a
 * fixed statement timeout. Input Dataset Versions are materialized into
 * session temp tables by the (trusted) application connection first; the
 * transform can only ever see those temp tables and pg_catalog. Outputs land
 * through the canonical governed domain operations — commit_dataset_row_batch
 * and snapshot_dataset — executed with the run actor's JWT claims, exactly
 * like sheet-calculation.server.ts does for composed Sheet reads. The run is
 * started/completed/failed through the same RPC-only surface as the browser.
 *
 * Session model (one dedicated connection per execution, superuser by
 * default, e.g. DATABASE_URL): every governed RPC is SECURITY DEFINER and
 * derives identity from `request.jwt.claims`, so the orchestration stays on
 * the application role with the run actor's claims stamped transaction-locally
 * (`set_config(..., true)`). Only the transform momentarily switches to
 * `pipeline_worker` (`SET LOCAL ROLE` + `SET ROLE NONE` to return to the
 * session user), which needs no privileges beyond reading its own temp
 * tables.
 *
 * Reproducibility: a run pins its definition version, parameters and input
 * Dataset Version ids. Re-running the same definition version with the same
 * input digest replays the prior success (idempotent); a retry links a new
 * attempt to the failed run.
 */
import { Client } from 'pg'
import type { QueryResultRow } from 'pg'

import { env } from '#/env.server'
import { getAppSession } from '#/lib/auth'
import { metrics, sizeBucketFor } from '#/lib/metrics'
import type { PipelineStage } from '#/lib/metrics'
import type { PipelineConfig } from './pipelines/config'
import {
  validatePipelineConfig,
  validatePipelineRunRequest,
} from './pipelines/config'
import type { PipelineRunWire } from './pipelines/types'
import {
  checkTransformStatement,
  substituteParameters,
  wrapTransformStatement,
} from './pipelines/statement'

const INPUT_ROW_LIMIT = 100_000
const INPUT_FIELD_LIMIT = 256
const RESULT_CELL_LIMIT = 1_000_000

export type PipelineErrorCode =
  | 'workspace_membership_required'
  | 'run_not_found'
  | 'run_not_running'
  | 'invalid_configuration'
  | 'invalid_run_request'
  | 'input_not_found'
  | 'input_too_large'
  | 'transform_rejected'
  | 'transform_failed'
  | 'transform_timed_out'
  | 'row_limit_exceeded'
  | 'output_schema_not_found'
  | 'output_target_not_found'
  | 'output_column_mapping'
  | 'output_value_invalid'
  | 'dataset_commit_failed'
  | 'run_cancelled'
  | 'pipeline_internal'

class PipelineStepError extends Error {
  readonly code: PipelineErrorCode
  constructor(code: PipelineErrorCode, message: string) {
    super(message)
    this.name = 'PipelineStepError'
    this.code = code
  }
}

export interface PipelineExecuteReport {
  ok: boolean
  run?: PipelineRunWire | null
  errorCode?: PipelineErrorCode
  errorMessage?: string
}

interface QueryResult<T extends QueryResultRow> {
  rows: T[]
  /** Affected/returned row count (pg provides `number | null`). */
  rowCount?: number | null
}

/** One transactional connection with a role-switchable session. */
export interface ExecConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<T>>
  begin: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
  end: () => Promise<void>
}

export interface PipelineExecuteDeps {
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>
  connect: () => Promise<ExecConnection>
}

interface RunRow {
  id: string
  workspace_id: string
  definition_version_id: string
  trigger_kind: string
  status: string
  attempt: number
  retry_of_run_id: string | null
  trigger_occurrence_id: string | null
  schedule_id: string | null
  input_digest: string | null
  parameters: Record<string, unknown>
  input_versions: Record<string, string>
  actor_user_id: string | null
  actor_credential_id: string | null
  version_number: number
  configuration: Record<string, unknown>
  definition_name: string
}

interface SchemaFieldRow {
  field_id: string
  key: string
  logical_type: string
  nullable: boolean
}

/**
 * Execute the pipeline run identified by runId. Idempotent for finished
 * runs: a succeeded/failed/cancelled run is returned unchanged.
 */
export async function runPipelineExecution(
  actor: string,
  runId: string,
  deps: PipelineExecuteDeps,
): Promise<PipelineExecuteReport> {
  const conn = await deps.connect()
  await conn.begin()
  const startedAt = Date.now()
  metrics.pipelineActiveRuns.inc()
  const observeStage = (stage: PipelineStage, ms: number) => {
    metrics.pipelineStageDuration.observe({ stage }, ms / 1000)
  }
  try {
    const run = await loadRun(conn, runId)
    if (!run) {
      await conn.rollback()
      return {
        ok: false,
        errorCode: 'run_not_found',
        errorMessage: 'Pipeline run not found.',
      }
    }
    if (run.status !== 'running') {
      // Idempotent replay of an already-finished run: nothing to execute.
      await conn.rollback()
      return { ok: true, run: null }
    }
    await assertMember(conn, run.workspace_id, actor)

    // Stamp the run actor's identity for every governed RPC in this
    // transaction (SECURITY DEFINER functions read request.jwt.claims).
    await setRunActorClaims(conn, run)

    const config = parseConfig(run.configuration)
    const requestErrors = validateRunRequest(config, run)
    if (requestErrors) {
      throw new PipelineStepError('invalid_run_request', requestErrors)
    }

    await log(conn, run, 'info', 'start', 'Pipeline execution started.', {
      definitionVersion: run.definition_version_id,
      triggerKind: run.trigger_kind,
      attempt: run.attempt,
    })

    // Materialize input Dataset Versions into session temp tables. The
    // pipeline_worker role is granted SELECT on these tables only.
    const materializeStarted = Date.now()
    const materialized = await materializeInputs(conn, run)
    const materializeMs = Date.now() - materializeStarted
    observeStage('materialize_inputs', materializeMs)
    await log(
      conn,
      run,
      'info',
      'inputs',
      'Input Dataset Versions materialized.',
      {
        inputs: materialized.map((m) => ({ name: m.name, rows: m.rowCount })),
        durationMs: materializeMs,
      },
    )

    // Run the transform as the low-privilege role against the temp schema.
    const transformStarted = Date.now()
    const transform = await executeTransform(conn, run, config)
    const transformMs = Date.now() - transformStarted
    if (transform.kind === 'cancelled') {
      await failRun(
        conn,
        run,
        'run_cancelled',
        'Run was cancelled before execution.',
      )
      await conn.commit()
      metrics.pipelineRuns.inc({
        trigger_kind: run.trigger_kind,
        outcome: 'cancelled',
      })
      return {
        ok: false,
        errorCode: 'run_cancelled',
        errorMessage: 'Run was cancelled.',
      }
    }
    if (transform.kind === 'error') {
      observeStage('transform', transformMs)
      await failRun(conn, run, transform.code, transform.message)
      await conn.commit()
      metrics.pipelineRuns.inc({
        trigger_kind: run.trigger_kind,
        outcome: 'failed',
      })
      return {
        ok: false,
        errorCode: transform.code,
        errorMessage: transform.message,
      }
    }
    observeStage('transform', transformMs)
    await log(conn, run, 'info', 'transform', 'Transform executed.', {
      rowCount: transform.rows.length,
      durationMs: transform.durationMs,
    })

    // Write the output through canonical Dataset operations.
    const outputStarted = Date.now()
    const output = await writeOutput(conn, run, config, transform.rows)
    const outputMs = Date.now() - outputStarted
    observeStage('output_commit', outputMs)
    if (!output.ok) {
      await failRun(conn, run, output.code, output.message)
      await conn.commit()
      metrics.pipelineRuns.inc({
        trigger_kind: run.trigger_kind,
        outcome: 'failed',
      })
      return { ok: false, errorCode: output.code, errorMessage: output.message }
    }
    await log(conn, run, 'info', 'output', 'Output Dataset Version recorded.', {
      datasetId: output.datasetId,
      datasetVersionId: output.datasetVersionId,
      rows: transform.rows.length,
      durationMs: outputMs,
    })

    const finished = await completeRun(conn, run, {
      rowCount: transform.rows.length,
      outputDatasetId: output.datasetId,
      outputDatasetVersionId: output.datasetVersionId,
      outputLabel: output.label,
      durationMs: transform.durationMs,
      stageDurationsMs: {
        materializeInputs: materializeMs,
        transform: transform.durationMs,
        outputCommit: outputMs,
        datasetCommit: output.commitMs,
        datasetSnapshot: output.snapshotMs,
        // Everything in the output phase beyond commit + snapshot (dataset
        // creation, mapping, revision loads, output recording).
        outputOverhead: Math.max(0, outputMs - output.commitMs - output.snapshotMs),
        total: Date.now() - startedAt,
      },
    })
    await conn.commit()
    observeStage('total', Date.now() - startedAt)
    metrics.pipelineRuns.inc({
      trigger_kind: run.trigger_kind,
      outcome: 'succeeded',
    })
    return { ok: true, run: finished }
  } catch (error) {
    const code =
      error instanceof PipelineStepError ? error.code : 'pipeline_internal'
    const message = error instanceof Error ? error.message : String(error)
    try {
      await failRunIfRunning(conn, runId, code, message)
      await conn.commit()
    } catch {
      await conn.rollback()
    }
    observeStage('total', Date.now() - startedAt)
    return { ok: false, errorCode: code, errorMessage: message }
  } finally {
    metrics.pipelineActiveRuns.dec()
    await conn.end()
  }
}

// ---------------------------------------------------------------------------
// HTTP route.
// ---------------------------------------------------------------------------

export async function handlePipelineExecute(
  request: Request,
  deps: PipelineExecuteDeps = defaultDeps,
): Promise<Response> {
  const session = await deps.getSession(request.headers)
  if (!session) {
    return responseError(401, 'unauthenticated', 'Authentication is required.')
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return responseError(
      400,
      'invalid_request',
      'A JSON request body is required.',
    )
  }
  const runId =
    body &&
    typeof body === 'object' &&
    'runId' in body &&
    typeof body.runId === 'string'
      ? body.runId
      : null
  if (!runId || !/^[0-9a-f-]{36}$/i.test(runId)) {
    return responseError(400, 'invalid_request', 'A valid runId is required.')
  }
  const report = await runPipelineExecution(session.user.id, runId, deps)
  if (!report.ok) {
    const status = report.errorCode === 'run_not_found' ? 404 : 422
    return responseError(
      status,
      report.errorCode ?? 'execution_failed',
      report.errorMessage ?? 'Execution failed.',
    )
  }
  return Response.json(report.run)
}

function responseError(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json({ error: { code, message } }, { status })
}

const defaultDeps: PipelineExecuteDeps = {
  getSession: getAppSession,
  async connect() {
    const client = new Client({
      connectionString: env.DATABASE_URL,
      // Backstop for the transform's statement_timeout: the sandbox role can
      // reach pg_catalog set_config and disarm the transaction-local GUC
      // mid-statement, so a driver-level cap bounds every query on the
      // execution connection. Generous enough for the output phase
      // (commit + snapshot of up to 100k rows).
      query_timeout: (EXECUTION_TIMEOUT_SECONDS + 120) * 1000,
    })
    await client.connect()
    return {
      query: async (text, values = []) => client.query(text, values),
      begin: () => client.query('BEGIN').then(() => undefined),
      commit: () => client.query('COMMIT').then(() => undefined),
      rollback: () => client.query('ROLLBACK').then(() => undefined),
      end: () => client.end(),
    }
  },
}

// ---------------------------------------------------------------------------
// Steps.
// ---------------------------------------------------------------------------

async function loadRun(
  conn: ExecConnection,
  runId: string,
): Promise<RunRow | null> {
  const { rows } = await conn.query<RunRow>(
    `SELECT r.id, r.workspace_id, r.definition_version_id, r.trigger_kind,
            r.status, r.attempt, r.retry_of_run_id, r.trigger_occurrence_id,
            r.schedule_id, r.input_digest,
            r.parameters, r.input_versions, r.actor_user_id, r.actor_credential_id,
            v.version AS version_number, v.configuration, d.name AS definition_name
       FROM api.pipeline_runs r
       JOIN api.pipeline_definition_versions v ON v.id = r.definition_version_id
       JOIN api.pipeline_definitions d ON d.id = v.definition_id
      WHERE r.id = $1`,
    [runId],
  )
  return rows[0] ?? null
}

async function assertMember(
  conn: ExecConnection,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const { rows } = await conn.query<{ role: string }>(
    `SELECT m.role FROM api.workspace_memberships m
      WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.suspended_at IS NULL`,
    [workspaceId, userId],
  )
  const role = rows.at(0)?.role
  // GOV-01 writer set: anyone but the read-only viewer may execute runs.
  if (!role || role === 'viewer') {
    throw new PipelineStepError(
      'workspace_membership_required',
      'You are not a workspace writer for the workspace that owns this run.',
    )
  }
}

function parseConfig(raw: Record<string, unknown>): PipelineConfig {
  const errors = validatePipelineConfig(raw)
  if (errors.length > 0) {
    throw new PipelineStepError(
      'invalid_configuration',
      `Pipeline configuration is invalid: ${errors[0].message}`,
    )
  }
  return raw as unknown as PipelineConfig
}

function validateRunRequest(
  config: PipelineConfig,
  run: RunRow,
): string | null {
  const errors = validatePipelineRunRequest(
    config,
    run.parameters,
    run.input_versions,
  )
  return errors.length > 0 ? errors[0].message : null
}

interface MaterializedInput {
  name: string
  datasetVersionId: string
  rowCount: number
}

async function materializeInputs(
  conn: ExecConnection,
  run: RunRow,
): Promise<MaterializedInput[]> {
  const config = run.configuration as unknown as PipelineConfig
  const result: MaterializedInput[] = []
  for (const input of config.inputs) {
    const versionId = run.input_versions[input.name]
    const version = await loadInputVersion(conn, run.workspace_id, versionId)
    if (!version) {
      throw new PipelineStepError(
        'input_not_found',
        `Input "${input.name}" references a Dataset Version that is not available in this workspace.`,
      )
    }
    const fields = await loadSchemaFields(conn, version.schema_version_id)
    if (fields.length === 0) {
      throw new PipelineStepError(
        'output_schema_not_found',
        `Input "${input.name}" schema has no active fields.`,
      )
    }
    if (fields.length > INPUT_FIELD_LIMIT) {
      throw new PipelineStepError(
        'input_too_large',
        'Input schema exceeds the field limit.',
      )
    }
    const columnDefs = fields.map((f) => ({
      slug: f.key,
      logicalType: f.logical_type,
      fieldId: f.field_id,
    }))
    await conn.query(buildInputTableDdl(input.name, columnDefs))
    const rowCount = await countInputRows(conn, version.id)
    if (rowCount > INPUT_ROW_LIMIT) {
      throw new PipelineStepError(
        'input_too_large',
        'Input Dataset Version exceeds the row limit.',
      )
    }
    await materializeInputRows(conn, input.name, version, columnDefs)
    // The sandbox role may read exactly the temp tables it needs.
    await conn.query(`GRANT SELECT ON pg_temp.${input.name} TO pipeline_worker`)
    result.push({
      name: input.name,
      datasetVersionId: version.id,
      rowCount,
    })
  }
  return result
}

async function loadInputVersion(
  conn: ExecConnection,
  workspaceId: string,
  versionId: string,
): Promise<{ id: string; schema_version_id: string } | null> {
  const { rows } = await conn.query<{ id: string; schema_version_id: string }>(
    `SELECT id, schema_version_id FROM api.dataset_versions
      WHERE id = $1 AND workspace_id = $2`,
    [versionId, workspaceId],
  )
  return rows[0] ?? null
}

async function loadSchemaFields(
  conn: ExecConnection,
  schemaVersionId: string,
): Promise<SchemaFieldRow[]> {
  const { rows } = await conn.query<SchemaFieldRow>(
    `SELECT f.field_id, f.key, f.logical_type, f.nullable
       FROM api.dataset_schema_version_fields f
      WHERE f.schema_version_id = $1 AND f.lifecycle = 'active'
      ORDER BY f.display_order, f.key`,
    [schemaVersionId],
  )
  return rows
}

function buildInputTableDdl(
  name: string,
  columns: Array<{ slug: string; logicalType: string }>,
): string {
  const cols = [
    '"_sb_row_id" uuid NOT NULL',
    '"_sb_row_revision" bigint NOT NULL',
    ...columns.map((c) => `"${c.slug}" ${pgTypeFor(c.logicalType)}`),
  ]
  return `CREATE TEMP TABLE ${name} (${cols.join(', ')})`
}

function pgTypeFor(logicalType: string): string {
  switch (logicalType) {
    case 'text':
      return 'text'
    case 'integer':
      return 'bigint'
    case 'decimal':
      return 'numeric'
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'date'
    case 'timestamp':
      return 'timestamptz'
    case 'category':
    case 'reference':
      return 'uuid'
    default:
      return 'text'
  }
}

/**
 * Count the rows in an input Dataset Version before materializing (indexed;
 * keeps the row limit check cheap and authoritative).
 */
async function countInputRows(
  conn: ExecConnection,
  versionId: string,
): Promise<number> {
  const { rows } = await conn.query<{ count: string }>(
    `SELECT count(*) FROM api.dataset_version_rows WHERE dataset_version_id = $1`,
    [versionId],
  )
  return Number(rows[0]?.count ?? 0)
}

/**
 * Materialize an input Dataset Version into a session temp table with ONE
 * set-based statement (previously one INSERT round-trip per row, which
 * dominated large-input runs). Each column aggregates exactly the values of
 * its own field (FILTER by field_id), so multi-valued fields expose their
 * first value (by ordinal) and every other field's NULLs never leak into a
 * sibling column. PostgreSQL's ARRAY_AGG includes NULLs, hence the FILTER is
 * required, not cosmetic.
 */
async function materializeInputRows(
  conn: ExecConnection,
  name: string,
  version: { id: string; schema_version_id: string },
  columns: Array<{ slug: string; logicalType: string; fieldId: string }>,
): Promise<number> {
  if (columns.length === 0) return 0
  const valueColumn = (logicalType: string): string => {
    switch (logicalType) {
      case 'text':
        return 'text_value'
      case 'integer':
        return 'integer_value'
      case 'decimal':
        return 'numeric_value'
      case 'boolean':
        return 'boolean_value'
      case 'date':
        return 'date_value'
      case 'timestamp':
        return 'timestamp_value'
      case 'category':
        return 'category_option_id'
      case 'reference':
        return 'reference_id'
      default:
        return 'text_value'
    }
  }
  const quote = (slug: string) => `"${slug}"`
  const columnSql = columns.map((c) => quote(c.slug)).join(', ')
  const selectSql = columns
    .map(
      (c) =>
        `(ARRAY_AGG(v.${valueColumn(c.logicalType)} ORDER BY v.ordinal) ` +
        `FILTER (WHERE v.field_id = '${c.fieldId}'))[1] AS ${quote(c.slug)}`,
    )
    .join(', ')
  const sql = `
    INSERT INTO ${name} ("_sb_row_id", "_sb_row_revision", ${columnSql})
    SELECT r.row_id, r.revision, ${selectSql}
      FROM api.dataset_version_rows r
      JOIN api.dataset_version_values v
        ON v.dataset_version_id = r.dataset_version_id
       AND v.row_id = r.row_id
     WHERE r.dataset_version_id = $1
     GROUP BY r.row_id, r.revision
     ORDER BY r.row_id`
  const result = await conn.query(sql, [version.id])
  return result.rowCount ?? 0
}

// ---------------------------------------------------------------------------
// Transform execution.
// ---------------------------------------------------------------------------

type TransformOutcome =
  | { kind: 'rows'; rows: Array<Record<string, unknown>>; durationMs: number }
  | { kind: 'cancelled' }
  | { kind: 'error'; code: PipelineErrorCode; message: string }

async function executeTransform(
  conn: ExecConnection,
  run: RunRow,
  config: PipelineConfig,
): Promise<TransformOutcome> {
  // A concurrent cancellation is honoured at the next safe point.
  if (!(await isRunRunning(conn, run.id))) {
    return { kind: 'cancelled' }
  }
  const statement = config.transform.statement
  const check = checkTransformStatement(statement)
  if (!check.ok) {
    return {
      kind: 'error',
      code: 'transform_rejected',
      message: check.reason,
    }
  }
  const parameterTypes: Record<string, string> = Object.fromEntries(
    config.parameters.map((p) => [p.name, p.type]),
  )
  const substituted = substituteParameters(
    statement,
    run.parameters,
    parameterTypes,
  )
  if (!substituted.ok) {
    return {
      kind: 'error',
      code: 'transform_rejected',
      message: substituted.reason,
    }
  }
  const wrapped = wrapTransformStatement(substituted.statement)

  const started = Date.now()
  // A transform SQL error aborts the transaction; keep the run's output
  // phase (fail + logs) on a healthy transaction via a savepoint.
  await conn.query('SAVEPOINT sb_pipeline_transform')
  try {
    // Sandbox: pipeline_worker has zero table grants; search_path is pinned
    // to the temp schema so unqualified names resolve only to the
    // materialized input tables (and pg_catalog).
    await conn.query('SET LOCAL ROLE pipeline_worker')
    await conn.query('SET LOCAL search_path = pg_temp')
    await conn.query(
      `SET LOCAL statement_timeout = '${EXECUTION_TIMEOUT_SECONDS}s'`,
    )
    const result = await conn.query<Record<string, unknown>>(wrapped)
    await conn.query(`SET LOCAL statement_timeout = '0'`)
    // Return to the session user for the output phase.
    await conn.query('SET ROLE NONE')
    await conn.query("SET LOCAL search_path = ''")
    await conn.query('RELEASE SAVEPOINT sb_pipeline_transform')

    const rows = result.rows
    if (rows.length > 100_000) {
      return {
        kind: 'error',
        code: 'row_limit_exceeded',
        message: 'Transform produced more than 100000 rows.',
      }
    }
    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (
          value !== null &&
          value !== undefined &&
          typeof value === 'string' &&
          value.length > RESULT_CELL_LIMIT
        ) {
          return {
            kind: 'error',
            code: 'row_limit_exceeded',
            message: 'A transformed value exceeds the cell size limit.',
          }
        }
      }
    }
    return { kind: 'rows', rows, durationMs: Date.now() - started }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Restore a healthy transaction so the failure can be recorded.
    await conn
      .query('ROLLBACK TO SAVEPOINT sb_pipeline_transform')
      .catch(() => {})
    await conn.query('SET ROLE NONE').catch(() => {})
    if (/statement timeout/i.test(message)) {
      return {
        kind: 'error',
        code: 'transform_timed_out',
        message: `Transform exceeded the ${EXECUTION_TIMEOUT_SECONDS}s execution limit.`,
      }
    }
    return {
      kind: 'error',
      code: 'transform_failed',
      message: `Transform failed: ${truncate(message, 500)}`,
    }
  }
}

const EXECUTION_TIMEOUT_SECONDS = 60

async function isRunRunning(
  conn: ExecConnection,
  runId: string,
): Promise<boolean> {
  const { rows } = await conn.query<{ status: string }>(
    `SELECT status FROM api.pipeline_runs WHERE id = $1`,
    [runId],
  )
  return rows[0]?.status === 'running'
}

// ---------------------------------------------------------------------------
// Output materialization through canonical operations.
// ---------------------------------------------------------------------------

type OutputOutcome =
  | {
      ok: true
      datasetId: string
      datasetVersionId: string
      label: string
      commitMs: number
      snapshotMs: number
    }
  | { ok: false; code: PipelineErrorCode; message: string }

async function writeOutput(
  conn: ExecConnection,
  run: RunRow,
  config: PipelineConfig,
  resultRows: Array<Record<string, unknown>>,
): Promise<OutputOutcome> {
  const output = config.output
  // Re-check cancellation before any output work.
  if (!(await isRunRunning(conn, run.id))) {
    return {
      ok: false,
      code: 'run_cancelled',
      message: 'Run was cancelled before output.',
    }
  }
  // Re-stamp the run actor's identity: the transform ran in the same
  // transaction and could have touched request.jwt.claims via pg_catalog
  // set_config. The output phase must use the run's own identity, never one
  // the transform chose.
  await setRunActorClaims(conn, run)
  // Switch to the request role so the output Dataset creation goes through
  // the canonical RLS-gated writer path (datasets_insert_writer requires
  // is_workspace_writer) — the same domain operation the product/API uses —
  // never a privileged second writer. The governed RPCs below are SECURITY
  // DEFINER and work from any session role with the stamped claims.
  await conn.query('SET LOCAL ROLE authenticated')
  await conn.query("SET LOCAL search_path = ''")

  let datasetId: string
  let schemaVersionId: string
  if (output.mode === 'create') {
    const created = await createDataset(
      conn,
      run.workspace_id,
      output.schemaVersionId!,
      output.datasetName!,
      run.actor_user_id,
    )
    if (!created) {
      return {
        ok: false,
        code: 'output_schema_not_found',
        message:
          'The output Dataset Schema Version is not available in this workspace.',
      }
    }
    datasetId = created.id
    schemaVersionId = output.schemaVersionId!
  } else {
    const target = await loadOutputDataset(
      conn,
      run.workspace_id,
      output.datasetId!,
    )
    if (!target) {
      return {
        ok: false,
        code: 'output_target_not_found',
        message: 'The output Dataset is not available in this workspace.',
      }
    }
    datasetId = target.id
    schemaVersionId = target.schema_version_id
  }

  // Build + validate the canonical row batch against the schema version.
  const fields = await loadSchemaFields(conn, schemaVersionId)
  if (fields.length === 0) {
    return {
      ok: false,
      code: 'output_schema_not_found',
      message: 'The output schema has no active fields.',
    }
  }
  const mapped = mapOutputRows(config, fields, resultRows)
  if (mapped.kind === 'error') {
    return { ok: false, code: mapped.code, message: mapped.message }
  }

  let commitMs = 0
  if (mapped.rows.length > 0) {
    // commit_dataset_row_batch accepts 1–1000 rows per call, so large
    // outputs are chunked; each commit bumps the Dataset revision, so the
    // expected revision is re-read per chunk. Distinct chunk keys keep
    // idempotency authoritative. commitMs is captured immediately after the
    // final chunk so it excludes snapshot/output-recording time.
    const BATCH_SIZE = 1000
    const commitStartedAt = Date.now()
    for (let offset = 0; offset < mapped.rows.length; offset += BATCH_SIZE) {
      const chunk = mapped.rows.slice(offset, offset + BATCH_SIZE)
      const expectedRevision = await loadDatasetRevision(conn, datasetId)
      const commitStarted = Date.now()
      const commit = await conn.query<{ result: unknown }>(
        `SELECT api.commit_dataset_row_batch($1, $2, $3::jsonb, $4) result`,
        [
          datasetId,
          expectedRevision,
          JSON.stringify(chunk),
          `pipeline:${run.id}:${Math.floor(offset / BATCH_SIZE)}`,
        ],
      )
      metrics.datasetCommitDuration.observe(
        { size_bucket: sizeBucketFor(chunk.length) },
        (Date.now() - commitStarted) / 1000,
      )
      const commitResult = commit.rows[0]?.result
      const ok =
        commitResult !== null &&
        commitResult !== undefined &&
        typeof commitResult === 'object' &&
        (commitResult as { ok?: unknown }).ok === true
      if (!ok) {
        const detail =
          commitResult && typeof commitResult === 'object'
            ? JSON.stringify(
                (commitResult as { errors?: unknown }).errors ?? commitResult,
              )
            : 'Dataset commit was rejected.'
        return {
          ok: false,
          code: 'dataset_commit_failed',
          message: truncate(`Dataset commit rejected: ${detail}`, 500),
        }
      }
    }
    commitMs = Date.now() - commitStartedAt
  }

  const revision = await loadDatasetRevision(conn, datasetId)
  const snapshotRowCount = await loadDatasetRowCount(conn, datasetId)
  const snapshotStarted = Date.now()
  const snapshot = await conn.query<{ id: string }>(
    `SELECT (api.snapshot_dataset($1, $2, $3)).id AS id`,
    [datasetId, revision, output.datasetLabel],
  )
  const snapshotMs = Date.now() - snapshotStarted
  metrics.datasetSnapshotDuration.observe(
    { size_bucket: sizeBucketFor(snapshotRowCount) },
    snapshotMs / 1000,
  )
  const versionId = snapshot.rows[0]?.id
  if (!versionId) {
    return {
      ok: false,
      code: 'dataset_commit_failed',
      message: 'Output Dataset snapshot failed.',
    }
  }
  await conn.query(
    `SELECT api.record_pipeline_run_output($1, $2, $3, $4, $5)`,
    [run.workspace_id, run.id, datasetId, versionId, output.datasetLabel],
  )
  return {
    ok: true,
    datasetId,
    datasetVersionId: versionId,
    label: output.datasetLabel,
    commitMs,
    snapshotMs,
  }
}

async function createDataset(
  conn: ExecConnection,
  workspaceId: string,
  schemaVersionId: string,
  name: string,
  actorUserId: string | null,
): Promise<{ id: string } | null> {
  const { rows } = await conn.query<{ id: string }>(
    `INSERT INTO api.datasets(workspace_id, schema_version_id, name, created_by_user_id, created_by_credential_id)
     VALUES ($1, $2, $3, $4, NULL)
     RETURNING id`,
    [workspaceId, schemaVersionId, name.trim(), actorUserId],
  )
  return rows[0] ?? null
}

async function loadOutputDataset(
  conn: ExecConnection,
  workspaceId: string,
  datasetId: string,
): Promise<{ id: string; schema_version_id: string } | null> {
  const { rows } = await conn.query<{ id: string; schema_version_id: string }>(
    `SELECT id, schema_version_id FROM api.datasets
      WHERE id = $1 AND workspace_id = $2 AND lifecycle = 'active'`,
    [datasetId, workspaceId],
  )
  return rows[0] ?? null
}

async function loadDatasetRevision(
  conn: ExecConnection,
  datasetId: string,
): Promise<number> {
  const { rows } = await conn.query<{ revision: string }>(
    `SELECT revision FROM api.datasets WHERE id = $1`,
    [datasetId],
  )
  return Number(rows[0]?.revision ?? 1)
}

async function loadDatasetRowCount(
  conn: ExecConnection,
  datasetId: string,
): Promise<number> {
  const { rows } = await conn.query<{ count: string }>(
    `SELECT count(*) FROM api.dataset_rows WHERE dataset_id = $1`,
    [datasetId],
  )
  return Number(rows[0]?.count ?? 0)
}

// ---------------------------------------------------------------------------
// Output mapping + value coercion.
// ---------------------------------------------------------------------------

function mapOutputRows(
  config: PipelineConfig,
  fields: SchemaFieldRow[],
  resultRows: Array<Record<string, unknown>>,
):
  | { kind: 'ok'; rows: Array<Record<string, unknown>> }
  | { kind: 'error'; code: PipelineErrorCode; message: string } {
  const mapping = config.output.fieldMapping ?? {}
  const slugToField = new Map(fields.map((f) => [f.key, f]))

  const batches: Array<Record<string, unknown>> = []
  for (const source of resultRows) {
    const values: Record<string, unknown> = {}
    for (const [column, raw] of Object.entries(source)) {
      const slug = mapping[column] ?? column
      const field = slugToField.get(slug)
      if (!field) {
        return {
          kind: 'error',
          code: 'output_column_mapping',
          message: `Result column "${column}" does not map to any field of the output schema (use fieldMapping to map it).`,
        }
      }
      if (raw === null || raw === undefined) {
        if (!field.nullable) {
          return {
            kind: 'error',
            code: 'output_value_invalid',
            message: `Output field "${slug}" is required but the transform produced a null value.`,
          }
        }
        values[field.field_id] = null
        continue
      }
      const coerced = coerceValue(field.logical_type, raw)
      if (coerced === COERCE_ERROR) {
        return {
          kind: 'error',
          code: 'output_value_invalid',
          message: `Output field "${slug}" received a value that does not match its ${field.logical_type} type.`,
        }
      }
      values[field.field_id] = coerced
    }
    // Required fields must be present in the result (mapped or default).
    for (const field of fields) {
      if (!field.nullable && !(field.field_id in values)) {
        const columns = Object.keys(source)
        return {
          kind: 'error',
          code: 'output_column_mapping',
          message: `Output field "${field.key}" is required but the transform result (${columns.join(', ')}) does not produce it.`,
        }
      }
    }
    batches.push({
      operation: 'create',
      rowId: randomUuid(),
      values,
    })
  }
  return { kind: 'ok', rows: batches }
}

const COERCE_ERROR = Symbol('coerce-error')

function coerceValue(
  logicalType: string,
  raw: unknown,
): unknown | typeof COERCE_ERROR {
  switch (logicalType) {
    case 'text':
      return String(raw)
    case 'integer': {
      if (typeof raw === 'number' && Number.isInteger(raw)) return raw
      if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) {
        const n = Number(raw)
        if (Number.isSafeInteger(n)) return n
      }
      return COERCE_ERROR
    }
    case 'decimal': {
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw
      if (
        typeof raw === 'string' &&
        raw.trim() !== '' &&
        Number.isFinite(Number(raw))
      ) {
        return Number(raw)
      }
      return COERCE_ERROR
    }
    case 'boolean':
      return typeof raw === 'boolean' ? raw : COERCE_ERROR
    case 'date': {
      if (raw instanceof Date) return toDateString(raw)
      if (typeof raw === 'string') {
        const date = new Date(raw)
        if (!Number.isNaN(date.getTime())) return toDateString(date)
      }
      return COERCE_ERROR
    }
    case 'timestamp': {
      if (raw instanceof Date) return raw.toISOString()
      if (typeof raw === 'string' && !Number.isNaN(Date.parse(raw))) {
        return new Date(raw).toISOString()
      }
      return COERCE_ERROR
    }
    case 'category':
    case 'reference': {
      const text = String(raw)
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        text,
      )
        ? text
        : COERCE_ERROR
    }
    default:
      return String(raw)
  }
}

function toDateString(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function randomUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ---------------------------------------------------------------------------
// Run completion helpers (governed RPCs, identity from the stamped claims).
// ---------------------------------------------------------------------------

async function completeRun(
  conn: ExecConnection,
  run: RunRow,
  result: Record<string, unknown>,
): Promise<PipelineRunWire | null> {
  const { rows } = await conn.query<{ run: unknown }>(
    `SELECT * FROM api.complete_pipeline_run($1, $2, $3::jsonb)`,
    [run.workspace_id, run.id, JSON.stringify(result)],
  )
  return (rows.at(0) as PipelineRunWire | undefined) ?? null
}

async function failRun(
  conn: ExecConnection,
  run: RunRow,
  code: PipelineErrorCode,
  message: string,
): Promise<void> {
  await conn.query(
    `SELECT api.append_pipeline_run_log($1, $2, 'error', 'failure', $3, $4::jsonb)`,
    [
      run.workspace_id,
      run.id,
      truncate(message, 2000),
      JSON.stringify({ code }),
    ],
  )
  await conn.query(`SELECT api.fail_pipeline_run($1, $2, $3, $4)`, [
    run.workspace_id,
    run.id,
    code,
    truncate(message, 2000),
  ])
}

/** Fail the run when it is still running (used by the generic catch path). */
async function failRunIfRunning(
  conn: ExecConnection,
  runId: string,
  code: PipelineErrorCode,
  message: string,
): Promise<void> {
  const run = await loadRun(conn, runId)
  if (!run || run.status !== 'running') return
  try {
    await setRunActorClaims(conn, run)
  } catch {
    // The transaction may be unusable; the run stays running and is
    // reconciled as stale by a later start.
    return
  }
  try {
    await conn.query(
      `SELECT api.append_pipeline_run_log($1, $2, 'error', 'failure', $3, $4::jsonb)`,
      [
        run.workspace_id,
        run.id,
        truncate(message, 2000),
        JSON.stringify({ code }),
      ],
    )
  } catch {
    // best effort
  }
  await conn.query(`SELECT api.fail_pipeline_run($1, $2, $3, $4)`, [
    run.workspace_id,
    run.id,
    code,
    truncate(message, 2000),
  ])
}

async function log(
  conn: ExecConnection,
  run: RunRow,
  level: 'info' | 'warning' | 'error',
  stage: string,
  message: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await conn.query(
    `SELECT api.append_pipeline_run_log($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      run.workspace_id,
      run.id,
      level,
      stage,
      truncate(message, 2000),
      JSON.stringify(detail),
    ],
  )
}

/** Stamp the run actor's identity for governed RPCs in this transaction. */
async function setRunActorClaims(
  conn: ExecConnection,
  run: RunRow,
): Promise<void> {
  await conn.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: run.actor_user_id,
      workspace_id: run.workspace_id,
    }),
  ])
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
