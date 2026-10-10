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
import {
  PipelinePythonError,
  executePythonTransform,
} from './pipeline-python.server'
import type { PythonTransformUsage } from './pipeline-python.server'
import { releasePythonArtefacts } from './pipeline-python.server'
import { queuePipelineNotifications } from './pipeline-notifications.server'
import { executePipelineActions } from './pipeline-actions.server'
import type { QueryResultRow } from 'pg'

import { env } from '#/env.server'
import { getAppSession } from '#/lib/auth'
import { metrics, sizeBucketFor } from '#/lib/metrics'
import type { PipelineStage } from '#/lib/metrics'
import type { PipelineConfig, PipelineStep } from './pipelines/config'
import {
  validatePipelineConfig,
  validatePipelineRunRequest,
  findPipelineConfirmStep,
  confirmExpiryHours,
  confirmNoAnswerOutcome,
  validateConfirmAnswer,
} from './pipelines/config'
import type { PipelineRunWire } from './pipelines/types'
import {
  checkTransformStatement,
  substituteParameters,
  wrapTransformStatement,
} from './pipelines/statement'
import {
  INPUT_ROW_LIMIT,
  INPUT_FIELD_LIMIT,
  RESULT_CELL_LIMIT,
  EXECUTION_TIMEOUT_SECONDS,
} from './pipeline-limits'

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
  | 'run_not_waiting'
  | 'prompt_not_found'
  | 'confirm_not_asked'
  | 'invalid_answer'
  | 'prompt_expired'
  | 'confirm_expired'
  | 'waiting_expired'
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
  executePython?: typeof executePythonTransform
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
  let workStarted = false
  let enforceDeadline = false
  const query = conn.query.bind(conn)
  conn.query = async <T extends QueryResultRow>(
    statement: string,
    values?: unknown[],
  ) => {
    if (enforceDeadline && Date.now() - startedAt > 600_000) {
      throw new PipelineStepError(
        'transform_timed_out',
        'The pipeline exceeded its ten-minute execution budget.',
      )
    }
    return query<T>(statement, values)
  }
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
    await assertMember(conn, run.workspace_id, actor)
    if (run.status !== 'running') {
      // Idempotent replay of an already-finished run: nothing to execute.
      const finished = await conn.query<PipelineRunWire>(
        'SELECT * FROM api.pipeline_runs WHERE id = $1',
        [run.id],
      )
      await conn.rollback()
      return { ok: true, run: finished.rows[0] ?? null }
    }

    // Stamp the run actor's identity for every governed RPC in this
    // transaction (SECURITY DEFINER functions read request.jwt.claims).
    await setRunActorClaims(conn, run)
    const { rows: executionLock } = await conn.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
      [runId],
    )
    if (executionLock[0]?.acquired === false) {
      await conn.rollback()
      return {
        ok: false,
        errorCode: 'run_not_running',
        errorMessage: 'This run is already executing.',
      }
    }
    await conn.query('SAVEPOINT sb_pipeline_work')
    workStarted = true
    enforceDeadline = true

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
    const transform = await executeSteps(
      conn,
      run,
      config,
      deps.executePython ?? executePythonTransform,
    )
    const transformMs = Date.now() - transformStarted
    if (transform.kind === 'cancelled') {
      await conn.query('ROLLBACK TO SAVEPOINT sb_pipeline_work')
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
      await conn.query('ROLLBACK TO SAVEPOINT sb_pipeline_work')
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
    if (transform.kind === 'waiting') {
      observeStage('transform', transformMs)
      await pauseRun(conn, run, transform)
      await conn.commit()
      const { rows } = await conn.query<PipelineRunWire>(
        'SELECT * FROM api.pipeline_runs WHERE id = $1',
        [run.id],
      )
      return { ok: true, run: rows[0] ?? null }
    }
    observeStage('transform', transformMs)
    await log(conn, run, 'info', 'transform', 'Transform executed.', {
      rowCount: transform.rows.length,
      durationMs: transform.durationMs,
    })

    // Write the output, run actions/notifications and complete the run.
    const finished = await finishExecution(conn, run, config, transform, {
      startedAt,
      materializeMs,
      observeStage,
    })
    await conn.commit()
    if (!finished.ok) {
      metrics.pipelineRuns.inc({
        trigger_kind: run.trigger_kind,
        outcome: 'failed',
      })
      return {
        ok: false,
        errorCode: finished.code,
        errorMessage: finished.message,
      }
    }
    observeStage('total', Date.now() - startedAt)
    metrics.pipelineRuns.inc({
      trigger_kind: run.trigger_kind,
      outcome: 'succeeded',
    })
    return { ok: true, run: finished.run }
  } catch (error) {
    enforceDeadline = false
    let code: PipelineErrorCode =
      error instanceof PipelineStepError ? error.code : 'pipeline_internal'
    let message = error instanceof Error ? error.message : String(error)
    if (!workStarted) {
      await conn.rollback()
      return { ok: false, errorCode: code, errorMessage: message }
    }
    try {
      await conn.query('ROLLBACK TO SAVEPOINT sb_pipeline_work')
      const latest = await loadRun(conn, runId)
      if (latest?.status === 'cancelled') {
        code = 'run_cancelled'
        message = 'Run was cancelled.'
      } else await failRunIfRunning(conn, runId, code, message)
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
  // PIPE-02: an answer resumes a waiting run instead of starting it.
  let answerBody: unknown
  if (body !== null && typeof body === 'object' && 'answer' in body)
    answerBody = body.answer
  const hasAnswer = answerBody !== undefined
  const report = hasAnswer
    ? await resumePipelineRun(session.user.id, runId, answerBody, deps)
    : await runPipelineExecution(session.user.id, runId, deps)
  if (!report.ok) {
    const status = !hasAnswer
      ? report.errorCode === 'run_not_found'
        ? 404
        : 422
      : report.errorCode === 'run_not_found'
        ? 404
        : report.errorCode === 'invalid_answer'
          ? 400
          : 409
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
// PIPE-02 / DEC-08 — confirm steps, waiting runs and expiry.
//
// A step carrying `confirm` runs its proposal and then commits what it has so
// far before stopping in `waiting`; the committed snapshot lives in
// `api.pipeline_runs.result.pending` (bounded) and in the prompt's form schema,
// and is deleted at run end or when the prompt expires. Resumption is a human
// session: the person answers through the canonical RPC surface under their own
// session, the decision is recorded under their name on the prompt row, and the
// run's remaining automated steps re-establish the original actor. The pinned
// inputs (`pipeline_runs.input_versions`) are re-materialized on resumption, so
// live data changed while waiting can never leak into the resumed run.
// ---------------------------------------------------------------------------

/** Temporary committed work is bounded (DEC-08); larger results keep a summary. */
const MAX_PENDING_JSON_CHARS = 262_144

export interface PipelineConfirmAnswerInput {
  decision: 'confirm' | 'skip' | 'stop'
  values?: Record<string, unknown>
  reason?: string
}

interface PromptRow {
  id: string
  workspace_id: string
  run_id: string
  step_id: string
  form_schema: Record<string, unknown>
  asked_user_ids: string[]
  answer: Record<string, unknown> | null
  answered_by_user_id: string | null
  answered_at: string | null
  expires_at: string | null
  created_at: string
}

type FinishOutcome =
  | { ok: true; run: PipelineRunWire | null }
  | { ok: false; code: PipelineErrorCode; message: string }

/**
 * The segment between pauses: write the output through the canonical Dataset
 * operations, run the governed actions, queue notifications and complete the
 * run. Shared by a first execution and a resumption; the caller owns COMMIT so
 * the generic catch path can still fail a broken run.
 */
async function finishExecution(
  conn: ExecConnection,
  run: RunRow,
  config: PipelineConfig,
  transform: {
    rows: Array<Record<string, unknown>>
    durationMs: number
    usage?: PythonTransformUsage
  },
  timing: {
    startedAt: number
    materializeMs: number
    observeStage: (stage: PipelineStage, ms: number) => void
  },
): Promise<FinishOutcome> {
  const { startedAt, materializeMs, observeStage } = timing
  const outputStarted = Date.now()
  if (!(await isRunRunning(conn, run.id)))
    throw new PipelineStepError('run_cancelled', 'Run was cancelled.')
  const output =
    config.output.mode === 'none'
      ? {
          ok: true as const,
          datasetId: null,
          datasetVersionId: null,
          label: null,
          commitMs: 0,
          snapshotMs: 0,
        }
      : await writeOutput(conn, run, config, transform.rows)
  const outputMs = Date.now() - outputStarted
  observeStage('output_commit', outputMs)
  if (!output.ok) {
    await conn.query('ROLLBACK TO SAVEPOINT sb_pipeline_work')
    await failRun(conn, run, output.code, output.message)
    return { ok: false, code: output.code, message: output.message }
  }
  await log(
    conn,
    run,
    'info',
    'output',
    config.output.mode === 'none'
      ? 'Analysis completed without a Dataset output.'
      : 'Output Dataset Version recorded.',
    {
      datasetId: output.datasetId,
      datasetVersionId: output.datasetVersionId,
      rows: transform.rows.length,
      durationMs: outputMs,
    },
  )

  await setRunActorClaims(conn, run)
  const actionResults = await executePipelineActions(
    conn,
    { workspaceId: run.workspace_id, runId: run.id },
    config.actions ?? [],
    {
      parameters: run.parameters,
      previous: transform.rows,
      output: {
        datasetId: output.datasetId,
        datasetVersionId: output.datasetVersionId,
        label: output.label,
      },
    },
  )
  for (const action of config.actions ?? []) {
    await log(conn, run, 'info', 'action', `${action.name} completed.`, {
      name: action.name,
      operation: action.operation,
    })
  }
  const completion = {
    actions: actionResults,
    rowCount: transform.rows.length,
    // PIPE-04.3: the run's peak measured Python payload usage (omitted when no
    // Python step ran). Stored on the run so the UI can show storage/limits.
    pythonUsage: transform.usage,
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
      outputOverhead: Math.max(
        0,
        outputMs - output.commitMs - output.snapshotMs,
      ),
      total: Date.now() - startedAt,
    },
  }
  await setRunActorClaims(conn, run)
  await queuePipelineNotifications(conn, run, config, completion, {
    parameters: run.parameters,
    previous: transform.rows,
    actions: actionResults,
    output: {
      datasetId: output.datasetId,
      datasetVersionId: output.datasetVersionId,
      label: output.label,
    },
  })
  const finished = await completeRun(conn, run, completion)
  return { ok: true, run: finished }
}

/** Keep the committed proposal bounded; a large one is stored as a summary. */
function boundProposal(rows: Array<Record<string, unknown>>): unknown {
  if (JSON.stringify(rows).length <= MAX_PENDING_JSON_CHARS) return rows
  return {
    truncated: true,
    rowCount: rows.length,
    columns: rows[0] ? Object.keys(rows[0]) : [],
  }
}

/**
 * Commit the work so far and stop the run in `waiting`. The proposal snapshot
 * is the temporary storage (bounded); the prompt names who was asked and when
 * it expires. Logged before the status flip, because run logs only accept
 * running runs.
 */
async function pauseRun(
  conn: ExecConnection,
  run: RunRow,
  outcome: Extract<TransformOutcome, { kind: 'waiting' }>,
): Promise<void> {
  const confirm = outcome.step.confirm
  if (!confirm)
    throw new PipelineStepError(
      'pipeline_internal',
      'A waiting outcome needs a confirm step.',
    )
  const hours = confirmExpiryHours(confirm)
  const proposal = boundProposal(outcome.proposal)
  await log(
    conn,
    run,
    'info',
    'confirm',
    `Waiting for a person at step "${outcome.step.name}".`,
    {
      step: outcome.step.name,
      askedUserIds: confirm.askedUserIds,
      expiresHours: hours,
    },
  )
  const pending = {
    step: outcome.step.name,
    since: new Date().toISOString(),
    previousRows: outcome.previous.length,
    proposal,
  }
  const updated = await conn.query<{ id: string }>(
    `UPDATE api.pipeline_runs SET status = 'waiting', result = $2::jsonb
      WHERE id = $1 AND status = 'running' RETURNING id`,
    [run.id, JSON.stringify({ pending })],
  )
  if (updated.rows.length === 0)
    throw new PipelineStepError(
      'run_cancelled',
      'Run was cancelled before it could wait.',
    )
  await conn.query(
    `INSERT INTO api.pipeline_run_prompts
       (workspace_id, run_id, step_id, form_schema, asked_user_ids, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::text[], now() + make_interval(hours => $6::int))`,
    [
      run.workspace_id,
      run.id,
      outcome.step.name,
      JSON.stringify({
        title: `Confirm ${outcome.step.name}`,
        fields: confirm.fields,
        proposal: { step: outcome.step.name, rows: proposal },
      }),
      confirm.askedUserIds,
      hours,
    ],
  )
}

async function loadOpenPrompt(
  conn: ExecConnection,
  runId: string,
): Promise<PromptRow | null> {
  const { rows } = await conn.query<PromptRow>(
    `SELECT * FROM api.pipeline_run_prompts
      WHERE run_id = $1 AND answer IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [runId],
  )
  return rows[0] ?? null
}

async function loadRunWire(
  conn: ExecConnection,
  runId: string,
): Promise<PipelineRunWire | null> {
  const { rows } = await conn.query<PipelineRunWire>(
    'SELECT * FROM api.pipeline_runs WHERE id = $1',
    [runId],
  )
  return rows[0] ?? null
}

/**
 * End a waiting run without applying the decision. Run logs only accept running
 * runs, so the status flips to running for the log, then to the terminal status.
 */
async function endWaitingRun(
  conn: ExecConnection,
  run: RunRow,
  status: 'cancelled' | 'failed',
  code: PipelineErrorCode,
  message: string,
  logStage: string,
  logMessage: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await conn.query(
    `UPDATE api.pipeline_runs SET status = 'running'
      WHERE id = $1 AND status = 'waiting'`,
    [run.id],
  )
  await log(conn, run, 'warning', logStage, logMessage, detail)
  await conn.query(
    `UPDATE api.pipeline_runs
        SET status = $2, finished_at = now(), error_code = $3,
            error_message = $4, result = '{}'::jsonb
      WHERE id = $1 AND status = 'running'`,
    [run.id, status, code, message],
  )
}

/**
 * Answer an open prompt and resume the run from the confirm step with the same
 * pinned inputs. The answering person must be a workspace writer they were
 * asked as; the governed RPCs still run as the original run actor (ADR-0052),
 * while the decision is recorded under the person's name.
 */
export async function resumePipelineRun(
  actor: string,
  runId: string,
  answer: unknown,
  deps: PipelineExecuteDeps,
): Promise<PipelineExecuteReport> {
  const conn = await deps.connect()
  await conn.begin()
  const startedAt = Date.now()
  let workStarted = false
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
    await assertMember(conn, run.workspace_id, actor)
    if (run.status !== 'waiting') {
      await conn.rollback()
      return {
        ok: false,
        errorCode: 'run_not_waiting',
        errorMessage: 'This run is not waiting for a decision.',
      }
    }
    const prompt = await loadOpenPrompt(conn, run.id)
    if (!prompt) {
      await conn.rollback()
      return {
        ok: false,
        errorCode: 'prompt_not_found',
        errorMessage: 'No open decision was found for this run.',
      }
    }
    if (!prompt.asked_user_ids.includes(actor)) {
      await conn.rollback()
      return {
        ok: false,
        errorCode: 'confirm_not_asked',
        errorMessage: 'You were not asked to decide this run.',
      }
    }
    const config = parseConfig(run.configuration)
    const step = findPipelineConfirmStep(config, prompt.step_id)
    if (!step?.confirm) {
      await conn.rollback()
      return {
        ok: false,
        errorCode: 'invalid_configuration',
        errorMessage: 'The waiting step is not a confirm step in this version.',
      }
    }
    const answerError = validateConfirmAnswer(step.confirm, answer)
    if (answerError) {
      await conn.rollback()
      return {
        ok: false,
        errorCode: 'invalid_answer',
        errorMessage: answerError,
      }
    }
    const decision = answer as PipelineConfirmAnswerInput

    await setRunActorClaims(conn, run)
    const { rows: executionLock } = await conn.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
      [runId],
    )
    if (executionLock[0]?.acquired === false) {
      await conn.rollback()
      return {
        ok: false,
        errorCode: 'run_not_running',
        errorMessage: 'This run is already executing.',
      }
    }
    await conn.query('SAVEPOINT sb_pipeline_work')
    workStarted = true

    // Record the decision as one attributable act through the canonical RPC
    // (it enforces asked/unanswered/unexpired and emits the change event).
    // The claims must be the answering person's: PIPE-02.3 attribution.
    await setActorClaims(conn, actor, run.workspace_id)
    try {
      await conn.query(
        `SELECT * FROM api.answer_pipeline_run_prompt($1, $2::jsonb)`,
        [prompt.id, JSON.stringify(answer)],
      )
    } catch (error) {
      await conn.rollback()
      const message =
        error instanceof Error ? error.message : 'The decision was rejected.'
      return {
        ok: false,
        errorCode: /expire/i.test(message)
          ? 'prompt_expired'
          : 'invalid_answer',
        errorMessage: message,
      }
    }
    // The remaining automated steps run as the original run actor.
    await setRunActorClaims(conn, run)
    const resumed = await conn.query<{ id: string }>(
      `UPDATE api.pipeline_runs SET status = 'running', result = '{}'::jsonb
        WHERE id = $1 AND status = 'waiting' RETURNING id`,
      [run.id],
    )
    if (resumed.rows.length === 0) {
      await conn.rollback()
      return {
        ok: false,
        errorCode: 'run_not_waiting',
        errorMessage: 'This run is no longer waiting for a decision.',
      }
    }

    if (decision.decision === 'stop') {
      await log(conn, run, 'warning', 'stop', 'Run stopped by the decision.', {
        by: actor,
        step: prompt.step_id,
      })
      await conn.query(`SELECT api.cancel_pipeline_run($1, $2)`, [
        run.workspace_id,
        run.id,
      ])
      await conn.commit()
      metrics.pipelineRuns.inc({
        trigger_kind: run.trigger_kind,
        outcome: 'cancelled',
      })
      return { ok: true, run: await loadRunWire(conn, run.id) }
    }

    // The pinned inputs, re-materialized: resumption never reads live data.
    const materializeStarted = Date.now()
    const materialized = await materializeInputs(conn, run)
    const materializeMs = Date.now() - materializeStarted
    await log(
      conn,
      run,
      'info',
      'inputs',
      'Pinned inputs re-materialized for resumption.',
      {
        inputs: materialized.map((m) => ({ name: m.name, rows: m.rowCount })),
        durationMs: materializeMs,
      },
    )

    const answered = new Map<string, Record<string, unknown>>([
      [prompt.step_id, answer as Record<string, unknown>],
    ])
    const transform = await executeSteps(
      conn,
      run,
      config,
      deps.executePython ?? executePythonTransform,
      answered,
    )
    if (transform.kind === 'waiting') {
      await pauseRun(conn, run, transform)
      await conn.commit()
      return { ok: true, run: await loadRunWire(conn, run.id) }
    }
    if (transform.kind === 'cancelled') {
      await conn.query('ROLLBACK TO SAVEPOINT sb_pipeline_work')
      await conn.commit()
      return {
        ok: false,
        errorCode: 'run_cancelled',
        errorMessage: 'Run was cancelled.',
      }
    }
    if (transform.kind === 'error') {
      await conn.query('ROLLBACK TO SAVEPOINT sb_pipeline_work')
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
    const observeStage = (stage: PipelineStage, ms: number) =>
      metrics.pipelineStageDuration.observe({ stage }, ms / 1000)
    const finished = await finishExecution(conn, run, config, transform, {
      startedAt,
      materializeMs,
      observeStage,
    })
    await conn.commit()
    if (!finished.ok) {
      metrics.pipelineRuns.inc({
        trigger_kind: run.trigger_kind,
        outcome: 'failed',
      })
      return {
        ok: false,
        errorCode: finished.code,
        errorMessage: finished.message,
      }
    }
    metrics.pipelineRuns.inc({
      trigger_kind: run.trigger_kind,
      outcome: 'succeeded',
    })
    return { ok: true, run: finished.run }
  } catch (error) {
    let code: PipelineErrorCode =
      error instanceof PipelineStepError ? error.code : 'pipeline_internal'
    let message = error instanceof Error ? error.message : String(error)
    if (!workStarted) {
      await conn.rollback()
      return { ok: false, errorCode: code, errorMessage: message }
    }
    try {
      await conn.query('ROLLBACK TO SAVEPOINT sb_pipeline_work')
      const latest = await loadRun(conn, runId)
      if (latest?.status === 'cancelled') {
        code = 'run_cancelled'
        message = 'Run was cancelled.'
      } else if (latest?.status === 'running')
        await failRunIfRunning(conn, runId, code, message)
      await conn.commit()
    } catch {
      await conn.rollback()
    }
    return { ok: false, errorCode: code, errorMessage: message }
  } finally {
    await conn.end()
  }
}

/** Outcome of one expiry sweep (DEC-08's no-answer behaviour, per step). */
export interface PipelineExpiryReport {
  examined: number
  reasked: number
  applied: number
  failed: number
}

/**
 * Expire unanswered prompts: stop and re-ask (default), apply the proposal
 * attributed to the pipeline, or fail the run. Temporary data is deleted in
 * every case. Safe to run repeatedly and concurrently.
 */
/**
 * PIPE-04.2 — a settled run's artefacts are temporary unless the run kept them.
 *
 * A sweep rather than a call at every exit: a run ends in several places (success, transform
 * failure, cancellation, expiry) and an external HTTP call does not belong inside the
 * transaction any of them holds. The sweep is idempotent - releasing an already-released run
 * writes the same keep marker again - and it records that it released, so a settled run is not
 * asked about on every tick.
 *
 * **Kept** means the run produced a proposal: a proposal can reference a file the run
 * produced (PIPE-03), so discarding the files would leave the proposal pointing at nothing.
 * Every other run's artefacts are deleted, which is what "temporary" means.
 */
export async function releaseSettledRunArtefacts(
  deps: PipelineExecuteDeps,
): Promise<{ released: number; kept: number; failed: number }> {
  const conn = await deps.connect()
  const report = { released: 0, kept: 0, failed: 0 }
  try {
    const { rows } = await conn.query<{ id: string; workspace_id: string }>(
      `SELECT r.id, r.workspace_id FROM api.pipeline_runs r
        WHERE r.status IN ('succeeded', 'failed', 'cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM api.pipeline_artefact_releases rel WHERE rel.run_id = r.id
          )
        ORDER BY r.finished_at NULLS LAST
        LIMIT 50`,
    )
    for (const run of rows) {
      const proposed = await conn.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM api.agent_operation_proposals
          WHERE workspace_id = $1 AND provenance->>'runId' = $2`,
        [run.workspace_id, run.id],
      )
      const keep = Number(proposed.rows[0]?.n ?? '0') > 0
      try {
        await releasePythonArtefacts(run.id, keep)
      } catch {
        // Leave the run unmarked so the next tick retries: one unreachable runner must
        // not stop the sweep, and a run whose files were not released must not look
        // released.
        report.failed += 1
        continue
      }
      await conn.query(
        `INSERT INTO api.pipeline_artefact_releases(run_id, workspace_id, kept)
         VALUES ($1, $2, $3::boolean)
         ON CONFLICT (run_id) DO NOTHING`,
        [run.id, run.workspace_id, keep],
      )
      if (keep) report.kept += 1
      else report.released += 1
    }
  } finally {
    await conn.end().catch(() => {})
  }
  return report
}

export async function expirePipelinePrompts(
  deps: PipelineExecuteDeps,
  now: Date = new Date(),
): Promise<PipelineExpiryReport> {
  const conn = await deps.connect()
  const report: PipelineExpiryReport = {
    examined: 0,
    reasked: 0,
    applied: 0,
    failed: 0,
  }
  try {
    const { rows: expired } = await conn.query<PromptRow>(
      `SELECT p.* FROM api.pipeline_run_prompts p
         JOIN api.pipeline_runs r ON r.id = p.run_id
        WHERE p.answer IS NULL AND p.expires_at IS NOT NULL
          AND p.expires_at <= $1 AND r.status = 'waiting'
        ORDER BY p.expires_at`,
      [now.toISOString()],
    )
    for (const prompt of expired) {
      report.examined += 1
      await conn.begin()
      try {
        // Re-check under a row lock: a concurrent answer, resumption or
        // another sweep must win without losing a recorded decision.
        const { rows: current } = await conn.query<{
          answer: unknown
          expires_at: string | null
        }>(
          `SELECT answer, expires_at FROM api.pipeline_run_prompts
            WHERE id = $1 FOR UPDATE`,
          [prompt.id],
        )
        if (
          !current[0] ||
          current[0].answer !== null ||
          (current[0].expires_at !== null &&
            new Date(current[0].expires_at) > now)
        ) {
          await conn.rollback()
          continue
        }
        const run = await loadRun(conn, prompt.run_id)
        if (!run || run.status !== 'waiting') {
          await conn.rollback()
          continue
        }
        await setRunActorClaims(conn, run)
        const config = parseConfig(run.configuration)
        const step = findPipelineConfirmStep(config, prompt.step_id)
        const outcome = step?.confirm
          ? confirmNoAnswerOutcome(step.confirm)
          : 'fail'
        if (outcome === 'apply' && step?.confirm) {
          await conn.query(
            `UPDATE api.pipeline_runs SET status = 'running', result = '{}'::jsonb
              WHERE id = $1 AND status = 'waiting'`,
            [run.id],
          )
          await log(
            conn,
            run,
            'warning',
            'waiting',
            'Nobody answered before the prompt expired; the proposal is applied and attributed to the pipeline.',
            { step: prompt.step_id },
          )
          await conn.query(
            `DELETE FROM api.pipeline_run_prompts WHERE id = $1`,
            [prompt.id],
          )
          await conn.query('SAVEPOINT sb_pipeline_work')
          const materializeStarted = Date.now()
          await materializeInputs(conn, run)
          const materializeMs = Date.now() - materializeStarted
          const answered = new Map<string, Record<string, unknown>>([
            [prompt.step_id, { decision: 'confirm', values: {} }],
          ])
          const transform = await executeSteps(
            conn,
            run,
            config,
            deps.executePython ?? executePythonTransform,
            answered,
          )
          if (transform.kind === 'rows') {
            const observeStage = (stage: PipelineStage, ms: number) =>
              metrics.pipelineStageDuration.observe({ stage }, ms / 1000)
            const finished = await finishExecution(
              conn,
              run,
              config,
              transform,
              {
                startedAt: Date.now(),
                materializeMs,
                observeStage,
              },
            )
            if (finished.ok) {
              metrics.pipelineRuns.inc({
                trigger_kind: run.trigger_kind,
                outcome: 'succeeded',
              })
            } else {
              metrics.pipelineRuns.inc({
                trigger_kind: run.trigger_kind,
                outcome: 'failed',
              })
            }
          } else if (transform.kind === 'waiting') {
            await pauseRun(conn, run, transform)
          } else if (transform.kind === 'error') {
            await conn.query('ROLLBACK TO SAVEPOINT sb_pipeline_work')
            await failRun(conn, run, transform.code, transform.message)
            metrics.pipelineRuns.inc({
              trigger_kind: run.trigger_kind,
              outcome: 'failed',
            })
          } else {
            await conn.query('ROLLBACK TO SAVEPOINT sb_pipeline_work')
            await failRun(conn, run, 'run_cancelled', 'Run was cancelled.')
            metrics.pipelineRuns.inc({
              trigger_kind: run.trigger_kind,
              outcome: 'cancelled',
            })
          }
          await conn.commit()
          report.applied += 1
          continue
        }
        if (outcome === 'fail') {
          await endWaitingRun(
            conn,
            run,
            'failed',
            'confirm_expired',
            'Nobody answered before the prompt expired.',
            'waiting',
            'Nobody answered before the prompt expired; the run failed.',
            { step: prompt.step_id },
          )
          await conn.query(
            `DELETE FROM api.pipeline_run_prompts WHERE id = $1`,
            [prompt.id],
          )
          await conn.commit()
          report.failed += 1
          continue
        }
        await endWaitingRun(
          conn,
          run,
          'cancelled',
          'waiting_expired',
          'Nobody answered before the prompt expired; the next run will ask again.',
          'waiting',
          'Nobody answered before the prompt expired; the run stops and the next run asks again.',
          { step: prompt.step_id },
        )
        await conn.query(`DELETE FROM api.pipeline_run_prompts WHERE id = $1`, [
          prompt.id,
        ])
        await conn.commit()
        report.reasked += 1
      } catch {
        await conn.rollback()
      }
    }
  } finally {
    await conn.end()
  }
  return report
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
): Promise<{
  id: string
  schema_version_id: string
  dataset_id: string
} | null> {
  const { rows } = await conn.query<{
    id: string
    schema_version_id: string
    dataset_id: string
  }>(
    `SELECT id, schema_version_id, dataset_id FROM api.dataset_versions
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
       -- DSET-01.2: a flagged value is excluded from the pipeline input.
       AND NOT EXISTS (
         SELECT 1 FROM api.dataset_version_flags f
          WHERE f.dataset_version_id = v.dataset_version_id
            AND f.row_id = v.row_id
            AND f.field_id = v.field_id
       )
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
  | {
      kind: 'rows'
      rows: Array<Record<string, unknown>>
      durationMs: number
      /** PIPE-04.3: per-run peak payload usage measured across Python steps. */
      usage?: PythonTransformUsage
    }
  | {
      kind: 'waiting'
      step: PipelineStep
      /** The last executed step's result: what the dependent steps read. */
      previous: Array<Record<string, unknown>>
      /** The confirm step's own result: the proposal shown to the person. */
      proposal: Array<Record<string, unknown>>
      durationMs: number
    }
  | { kind: 'cancelled' }
  | { kind: 'error'; code: PipelineErrorCode; message: string }

/** Run ordered analysis steps without exposing the orchestration connection to Python. */
async function executeSteps(
  conn: ExecConnection,
  run: RunRow,
  config: PipelineConfig,
  python: typeof executePythonTransform,
  answered?: Map<string, Record<string, unknown>>,
): Promise<TransformOutcome> {
  const started = Date.now()
  let previous: Array<Record<string, unknown>> | undefined
  // Steps skipped by a Skip decision: the confirm step's declared dependents.
  const skipped = new Set<string>()
  // The most recent recorded decision, exposed to the steps after it.
  let answerValues: Record<string, unknown> | null = null
  // PIPE-04.3: the peak payload usage reported by any Python step this run.
  const peakUsage: PythonTransformUsage = {
    inputBytes: 0,
    outputBytes: 0,
    rows: 0,
    cells: 0,
  }
  let sawUsage = false
  const recordUsage = (usage: PythonTransformUsage | undefined): void => {
    if (!usage) return
    sawUsage = true
    peakUsage.inputBytes = Math.max(peakUsage.inputBytes, usage.inputBytes)
    peakUsage.outputBytes = Math.max(peakUsage.outputBytes, usage.outputBytes)
    peakUsage.rows = Math.max(peakUsage.rows, usage.rows)
    peakUsage.cells = Math.max(peakUsage.cells, usage.cells)
  }
  const steps: PipelineStep[] = [
    ...(config.transform.language === 'none'
      ? []
      : [
          {
            name: 'analysis',
            language: config.transform.language,
            statement: config.transform.statement,
          },
        ]),
    ...(config.steps ?? []),
  ]

  const runStep = async (
    index: number,
    step: (typeof steps)[number],
  ): Promise<TransformOutcome> => {
    if (step.language === 'python') {
      const inputs: Record<string, Array<Record<string, unknown>>> = {}
      for (const input of config.inputs) {
        const { rows } = await conn.query<{ row: Record<string, unknown> }>(
          `SELECT row_to_json(t) AS row FROM pg_temp.${quoteIdentifier(input.name)} t ORDER BY "_sb_row_id"`,
        )
        inputs[input.name] = rows.map((entry) => entry.row)
      }
      if (previous) inputs.previous = previous
      if (answerValues) inputs.answer = [answerValues]
      try {
        const result = await python({
          // PIPE-04.2: the artefact key is the run, so every Python step's files land in
          // one per-run directory the run releases when it settles.
          artefactKey: run.id,
          statement: step.statement,
          inputs,
          parameters: run.parameters,
          runtime: config.pythonRuntime,
        })
        await log(
          conn,
          run,
          'info',
          'python',
          `Python step ${index + 1} completed.`,
          { runtime: result.runtime, logs: result.logs },
        )
        recordUsage(result.usage)
        return {
          kind: 'rows',
          rows: result.rows,
          durationMs: Date.now() - started,
        }
      } catch (error) {
        return {
          kind: 'error',
          code: pythonErrorCode(error),
          message:
            error instanceof Error ? error.message : 'Python execution failed.',
        }
      }
    }
    if (previous) await materializePrevious(conn, previous)
    return executeTransform(conn, run, { ...config, transform: step })
  }

  for (const [index, step] of steps.entries()) {
    if (skipped.has(step.name)) {
      await log(
        conn,
        run,
        'info',
        'skip',
        `${index + 1}. ${step.name} skipped by the decision.`,
        { step: index + 1, name: step.name },
      )
      continue
    }
    if (!(await isRunRunning(conn, run.id))) return { kind: 'cancelled' }
    const outcome = await runStep(index, step)
    if (outcome.kind !== 'rows') return outcome
    let cells = 0
    for (const row of outcome.rows) cells += Object.keys(row).length
    if (outcome.rows.length > INPUT_ROW_LIMIT || cells > RESULT_CELL_LIMIT) {
      return {
        kind: 'error',
        code: 'row_limit_exceeded',
        message: 'Step result exceeds the row or cell limit.',
      }
    }
    // PIPE-02: a confirm step proposes values and then waits for a person.
    // Its own result is the proposal; the dependent steps keep reading the
    // preceding result, so an unanswered run changes nothing.
    if (step.confirm) {
      const decision = answered?.get(step.name)
      if (!decision) {
        return {
          kind: 'waiting',
          step,
          previous: previous ?? [],
          proposal: outcome.rows,
          durationMs: Date.now() - started,
        }
      }
      if (decision.decision === 'skip')
        for (const name of step.confirm.skipSteps ?? []) skipped.add(name)
      answerValues =
        (decision.values as Record<string, unknown> | undefined) ?? {}
      await provisionConfirmAnswer(conn, answerValues)
      await log(
        conn,
        run,
        'info',
        'confirm',
        `${index + 1}. ${step.name} answered: ${String(decision.decision)}.`,
        {
          step: index + 1,
          name: step.name,
          decision: decision.decision,
          skipped: [...skipped],
        },
      )
      continue
    }
    previous = outcome.rows
    await log(
      conn,
      run,
      'info',
      'step',
      `${index + 1}. ${step.name} completed.`,
      {
        step: index + 1,
        name: step.name,
        language: step.language,
        rowCount: previous.length,
      },
    )
  }
  return {
    kind: 'rows',
    rows: previous ?? [],
    durationMs: Date.now() - started,
    ...(sawUsage ? { usage: peakUsage } : {}),
  }
}

/**
 * Map a runner failure onto the executor's bounded error codes. Size and
 * timeout limits are reported with their own codes (and a numeric message from
 * the broker) rather than collapsing into a bare `transform_failed`.
 */
function pythonErrorCode(error: unknown): PipelineErrorCode {
  if (error instanceof PipelinePythonError) {
    switch (error.code) {
      case 'input_too_large':
        return 'input_too_large'
      case 'transform_timed_out':
        return 'transform_timed_out'
      case 'output_too_large':
        return 'row_limit_exceeded'
      default:
        return 'transform_failed'
    }
  }
  return 'transform_failed'
}

/**
 * Expose the recorded decision to the steps after a confirm step. SQL steps
 * read `pg_temp.confirm_answer` (their search_path already resolves pg_temp);
 * Python steps receive `inputs.answer`.
 */
async function provisionConfirmAnswer(
  conn: ExecConnection,
  values: Record<string, unknown>,
): Promise<void> {
  await conn.query('DROP TABLE IF EXISTS pg_temp.confirm_answer')
  await conn.query('CREATE TEMP TABLE confirm_answer (answer jsonb)')
  await conn.query(
    'INSERT INTO pg_temp.confirm_answer (answer) VALUES ($1::jsonb)',
    [JSON.stringify(values)],
  )
  await conn.query('GRANT SELECT ON pg_temp.confirm_answer TO pipeline_worker')
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/** Infer a bounded primitive table for a SQL step reading the preceding result. */
async function materializePrevious(
  conn: ExecConnection,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  if (
    columns.length > INPUT_FIELD_LIMIT ||
    columns.some((name) => !name || Buffer.byteLength(name) > 63)
  ) {
    throw new PipelineStepError(
      'input_too_large',
      'Previous step has too many columns or an invalid column name.',
    )
  }
  const fields = columns.map((name) => {
    const values = rows
      .map((row) => row[name])
      .filter((value) => value !== null && value !== undefined)
    const type = values.every((value) => typeof value === 'number')
      ? 'numeric'
      : values.every((value) => typeof value === 'boolean')
        ? 'boolean'
        : 'text'
    return `${quoteIdentifier(name)} ${type}`
  })
  await conn.query('DROP TABLE IF EXISTS pg_temp.previous')
  // A zero-column result still has a useful SQL relation (SELECT count(*)).
  await conn.query(`CREATE TEMP TABLE previous (${fields.join(', ')})`)
  if (columns.length && rows.length) {
    await conn.query(
      `INSERT INTO pg_temp.previous SELECT * FROM jsonb_populate_recordset(NULL::pg_temp.previous, $1::jsonb)`,
      [JSON.stringify(rows)],
    )
  }
  await conn.query('GRANT SELECT ON pg_temp.previous TO pipeline_worker')
}

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

/** Stamp an actor's identity for governed RPCs in this transaction. */
async function setActorClaims(
  conn: ExecConnection,
  userId: string | null,
  workspaceId: string,
): Promise<void> {
  await conn.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: userId,
      workspace_id: workspaceId,
    }),
  ])
}

/** Stamp the run actor's identity for governed RPCs in this transaction. */
async function setRunActorClaims(
  conn: ExecConnection,
  run: RunRow,
): Promise<void> {
  await setActorClaims(conn, run.actor_user_id, run.workspace_id)
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
