/**
 * AUTO-02 — deterministic Pipeline execution (server-side).
 *
 * The transform SQL runs on its own connection that logs in as the
 * `pipeline_sandbox` role (see ./pipeline-sandbox.server): zero grants, no
 * role memberships, a temp-schema-only search_path and a statement timeout.
 * Input Dataset Versions are materialized into session temp tables by the
 * (trusted) application connection first and copied by value into the
 * sandbox session; the transform can only ever see those temp tables and
 * pg_catalog. Outputs land
 * through the canonical governed domain operations — commit_dataset_row_batch
 * and snapshot_dataset — executed with the run actor's JWT claims, exactly
 * like sheet-calculation.server.ts does for composed Sheet reads. The run is
 * started/completed/failed through the same RPC-only surface as the browser.
 *
 * Session model (one orchestration connection per execution, e.g.
 * DATABASE_URL): every governed RPC is SECURITY DEFINER and derives identity
 * from `request.jwt.claims`, so the orchestration stays on the application
 * role with the run actor's claims stamped transaction-locally
 * (`set_config(..., true)`). Untrusted SQL never touches that connection: it
 * runs on a second, separately authenticated sandbox connection, so a
 * statement that resets its role has nowhere more privileged to go.
 *
 * Reproducibility: a run pins its definition version, parameters and input
 * Dataset Version ids. Re-running the same definition version with the same
 * input digest replays the prior success (idempotent); a retry links a new
 * attempt to the failed run.
 */
import { z } from 'zod'
import {
  buildResultPreview,
  readResultPreview,
} from '#/lib/pipelines/result-preview'
import { describeGateBlock } from '#/lib/data-contracts/gate'
import type { ContractGateReport } from '#/lib/data-contracts/types'
import {
  PipelinePythonError,
  executePythonTransform,
  releasePythonArtefacts,
  pythonInputRowsSchema,
  pythonInputsSchema,
} from './pipeline-python.server'
import type {
  PythonTransformUsage,
  pythonInputValueSchema,
  pythonInputRowSchema,
} from './pipeline-python.server'
import { queuePipelineNotifications } from './pipeline-notifications.server'
import { executePipelineActions } from './pipeline-actions.server'
import { PluginStepError, runPluginStep } from './pipeline-plugin-step.server'
import {
  WebCallError,
  defaultWebCallDeps,
  latestResponseFinder,
  loadRunResponses,
  newWebCallSession,
  persistRunResponses,
  runManifestResponses,
  runWebCallStep,
} from './pipeline-web-call.server'
import type {
  RecordedResponse,
  WebCallDeps,
  WebCallSession,
} from './pipeline-web-call.server'
import type { ExtensionRuntimeDeps } from './extensions/runtime.server'
import {
  digestInput,
  digestRows,
  recordRunManifest,
} from './pipeline-manifest.server'
import type { RunManifest } from './pipeline-manifest.server'
import {
  SandboxSession,
  SandboxUnavailableError,
  connectPipelineSandbox,
} from './pipeline-sandbox.server'
import type { ConnectSandbox } from './pipeline-sandbox.server'
import type { QueryResultRow } from 'pg'
import {
  pipelineJsonObjectSchema,
  pipelineJsonValueSchema,
} from './pipelines/types'

import { metrics, sizeBucketFor } from '#/lib/metrics'
import type { PipelineStage } from '#/lib/metrics'
import type {
  PipelineAskStep,
  PipelineConfig,
  PipelineDataStep,
  PipelineOutput,
  PipelineRemoteJobStep,
} from './pipelines/config'
import { loadLakeTables } from './pipeline-lakehouse.server'
import { remoteRowsOf, runRemoteJobStep } from './pipeline-hpc.server'
import type { RemoteJobDeps, RemoteJobRow } from './pipeline-hpc.server'
import type { ObjectStorage } from './file-storage/types'
import {
  validatePipelineConfig,
  validatePipelineRunRequest,
  findPipelineConfirmStep,
  pipelineActionSteps,
  pipelineDataSteps,
  stepRuns,
  confirmExpiryHours,
  confirmNoAnswerOutcome,
  validateConfirmAnswer,
} from './pipelines/config'
import type {
  PipelineReproductionSummary,
  PipelineReproductionWire,
  PipelineRunWire,
  PipelineTrialLogEntry,
  PipelineTrialWire,
} from './pipelines/types'
import {
  DEFAULT_REPRODUCE_TOLERANCE,
  diffMatches,
  diffResultRows,
} from './pipelines/reproduce-diff'
import type { DiffExample } from './pipelines/reproduce-diff'
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
  | 'workspace_busy'
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
  | 'contract_blocked'
  | 'run_cancelled'
  | 'run_not_waiting'
  | 'prompt_not_found'
  | 'confirm_not_asked'
  | 'invalid_answer'
  | 'prompt_expired'
  | 'confirm_expired'
  | 'waiting_expired'
  | 'run_not_finished'
  | 'reproduce_no_baseline'
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
  /** Opens the sandbox login connection that runs transform SQL. */
  sandbox?: ConnectSandbox
  /** How plugin steps are run; a test hands in its own. Absent means the workspace's installed plugins. */
  plugins?: ExtensionRuntimeDeps
  /** How remote job steps reach their scheduler; a test hands in its own. Absent means the workspace's connections. */
  remote?: RemoteJobDeps
  /** Where the open tables' files are read from; a test hands in its own. Absent means the file store. */
  lakeStorage?: Pick<ObjectStorage, 'getStream'>
  /** How web call steps reach connections, secrets and the network; a test hands in its own. */
  webCalls?: WebCallDeps
}

/** What the two steps that reach outside the database are given. */
interface ExternalStepDeps {
  remote?: RemoteJobDeps
  lakeStorage?: Pick<ObjectStorage, 'getStream'>
  /** Reproduce: a remote job's recorded answer is read, never asked for again. */
  recorded?: boolean
  /** The web answers this run reads and collects. */
  web?: WebCallSession
}

function externalSteps(deps: PipelineExecuteDeps): ExternalStepDeps {
  return { remote: deps.remote, lakeStorage: deps.lakeStorage }
}

/** Scientific values before output-field coercion or JSON serialization. */
type SqlResultValue = z.infer<typeof pythonInputValueSchema>

type SqlResultRow = z.infer<typeof pythonInputRowSchema>

type PythonFailureDetail = {
  step: string
  logs?: PipelinePythonError['logs']
  line?: PipelinePythonError['line']
}

type PipelineJsonObject = z.infer<typeof pipelineJsonObjectSchema>

const numericResultSchema = z.union([
  z.number(),
  z.nan(),
  z.literal(Infinity),
  z.literal(-Infinity),
])

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
  parameters: PipelineRunWire['parameters']
  input_versions: Record<string, string>
  /** What the run stored when it finished (the preview of its rows). */
  result?: PipelineRunWire['result']
  actor_user_id: string | null
  actor_credential_id: string | null
  version_number: number
  configuration: unknown
  definition_name: string
  /** The pipeline the run belongs to: one of its runs executes at a time. */
  definition_id?: string
  /**
   * Log lines held back until the run may write to the workspace (see
   * `holdWorkspaceWrites`). Unset once they are written.
   */
  pendingLogs?: PendingLog[]
  /**
   * Set for a trial of a draft: nothing is recorded against the run, because
   * there is none. Log lines are collected here instead of written.
   */
  trial?: TrialLogEntry[]
}

type TrialLogEntry = PipelineTrialLogEntry

interface PendingLog {
  level: 'info' | 'warning' | 'error'
  stage: string
  message: string
  detail: SqlResultRow
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

    if (!(await tryPipelineExecutionLock(conn, run))) {
      await conn.rollback()

      return {
        ok: false,
        errorCode: 'workspace_busy',
        errorMessage: 'Another run of this pipeline is executing.',
      }
    }

    await conn.query('SAVEPOINT sb_pipeline_work')
    workStarted = true
    enforceDeadline = true
    run.pendingLogs = []

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
    // The sandbox session receives copies of these tables, nothing else.
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

    // A run that waited for a remote job starts again from its first step: the
    // decisions people already gave at ask steps are replayed, not asked again.
    const answeredPrompts = await loadAnsweredPrompts(conn, run.id)

    // Run the transform as the low-privilege role against the temp schema.
    const transformStarted = Date.now()
    const web = newWebCallSession('live', [], { deps: deps.webCalls })

    const transform = await withSandbox(conn, deps, (sandbox) =>
      executeSteps(
        conn,
        run,
        config,
        deps.executePython ?? executePythonTransform,
        sandbox,
        answeredPrompts,
        deps.plugins,
        { ...externalSteps(deps), web },
      ),
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
      await failRun(
        conn,
        run,
        transform.code,
        transform.message,
        transform.detail,
      )
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

    // Another pipeline held the workspace's writes for too long: drop this
    // attempt whole, run still running, and let the queue try again.
    if (isWorkspaceBusy(error)) {
      await conn.rollback()

      return {
        ok: false,
        errorCode: 'workspace_busy',
        errorMessage: 'Another pipeline in this workspace is writing.',
      }
    }

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
// Try draft — run a configuration that is not saved, published or recorded.
// ---------------------------------------------------------------------------

export interface PipelineTrialInput {
  workspaceId: string
  /** The configuration as the editor holds it: nothing needs to be saved. */
  configuration: unknown
  inputVersions: Record<string, string>
  parameters: PipelineRunWire['parameters']
}

export type PipelineTrialReport = PipelineTrialWire

/**
 * Run a draft configuration against chosen input Dataset Versions exactly as a
 * real run would up to the point of writing: same membership check, same
 * materialised inputs, same sandbox login, timeout and row limits. Then stop.
 * The whole thing happens in a transaction that is always rolled back, with no
 * run row, no log rows, no output Dataset, no actions or notifications and no
 * manifest. A confirm step is not paused for a person: the trial shows what the
 * step proposed and ends there.
 */
export async function tryPipelineDraft(
  actor: string,
  input: PipelineTrialInput,
  deps: PipelineExecuteDeps,
): Promise<PipelineTrialReport> {
  const logs: TrialLogEntry[] = []
  const conn = await deps.connect()
  const startedAt = Date.now()

  const fail = (
    errorCode: PipelineErrorCode,
    errorMessage: string,
  ): PipelineTrialReport => ({ ok: false, errorCode, errorMessage, logs })

  try {
    await conn.begin()
    await assertMember(conn, input.workspaceId, actor)
    await setActorClaims(conn, actor, input.workspaceId)
    const config = parseConfig(input.configuration)

    const requestErrors = validatePipelineRunRequest(
      config,
      input.parameters,
      input.inputVersions,
    )

    if (requestErrors.length > 0) {
      return fail('invalid_run_request', requestErrors[0].message)
    }

    const run: RunRow = {
      id: randomUuid(),
      workspace_id: input.workspaceId,
      definition_version_id: '',
      trigger_kind: 'manual',
      status: 'running',
      attempt: 1,
      retry_of_run_id: null,
      trigger_occurrence_id: null,
      schedule_id: null,
      input_digest: null,
      parameters: input.parameters,
      input_versions: input.inputVersions,
      actor_user_id: actor,
      actor_credential_id: null,
      version_number: 0,
      configuration: input.configuration,
      definition_name: 'draft',
      trial: logs,
    }

    const materialized = await materializeInputs(conn, run)
    await log(conn, run, 'info', 'inputs', 'Inputs read.', {
      inputs: materialized.map((m) => ({ name: m.name, rows: m.rowCount })),
    })

    // A trial asks for a GET; a POST reads what the pipeline last recorded.
    const web = newWebCallSession('trial', [], {
      deps: deps.webCalls,
      latestFor: latestResponseFinder(conn),
    })

    const outcome = await withSandbox(conn, deps, (sandbox) =>
      executeSteps(
        conn,
        run,
        config,
        deps.executePython ?? executePythonTransform,
        sandbox,
        undefined,
        deps.plugins,
        { ...externalSteps(deps), web },
      ),
    )

    if (outcome.kind === 'error') return fail(outcome.code, outcome.message)

    if (outcome.kind === 'cancelled')
      return fail('run_cancelled', 'The trial was cancelled.')
    const waiting = outcome.kind === 'waiting'

    const report: PipelineTrialReport = {
      ok: true,
      preview: buildResultPreview(waiting ? outcome.proposal : outcome.rows),
      logs,
      durationMs: Date.now() - startedAt,
      wouldWrite: config.output.mode,
    }

    if (waiting)
      report.stoppedAt = { step: outcome.step.name, reason: 'confirm' }

    return report
  } catch (error) {
    return fail(
      error instanceof PipelineStepError ? error.code : 'pipeline_internal',
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    // A trial leaves nothing behind, whatever happened.
    await conn.rollback().catch(() => {})
    await conn.end().catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Reproduce — run a finished run again from what it pinned, into scratch.
// ---------------------------------------------------------------------------

export interface PipelineReproduceInput {
  runId: string
  /** Relative tolerance for numbers; defaults to 1e-9. */
  tolerance?: number
}

export interface PipelineReproduceReport {
  ok: boolean
  reproduction?: PipelineReproductionWire
  errorCode?: PipelineErrorCode
  errorMessage?: string
}

/** Rows compared one by one; a bigger result is compared by digest alone. */
const REPRODUCE_COMPARE_ROW_LIMIT = 100_000

interface ReproductionOutcome {
  status: 'matches' | 'differs' | 'failed'
  compared: 'dataset_version' | 'preview' | 'digest' | null
  summary: Partial<PipelineReproductionSummary>
  changes: DiffExample[]
  errorCode: string | null
  errorMessage: string | null
}

/**
 * Re-run a succeeded Pipeline run with the definition version, parameters,
 * recorded answers and input Dataset Versions it pinned, in a transaction that
 * is always rolled back: no run, no logs, no Dataset Version, no actions and no
 * notifications. Then compare with what the run recorded and keep only the
 * verdict, as a reproduction. Python steps run on the image the pinned
 * configuration names by digest.
 */
export async function reproducePipelineRun(
  actor: string,
  input: PipelineReproduceInput,
  deps: PipelineExecuteDeps,
): Promise<PipelineReproduceReport> {
  const tolerance =
    input.tolerance !== undefined &&
    Number.isFinite(input.tolerance) &&
    input.tolerance >= 0
      ? input.tolerance
      : DEFAULT_REPRODUCE_TOLERANCE

  const startedAt = Date.now()
  const conn = await deps.connect()
  let workspaceId: string | null = null
  let outcome: ReproductionOutcome

  try {
    await conn.begin()
    const run = await loadRun(conn, input.runId)

    if (!run) {
      return {
        ok: false,
        errorCode: 'run_not_found',
        errorMessage: 'Pipeline run not found.',
      }
    }

    await assertMember(conn, run.workspace_id, actor)
    await setActorClaims(conn, actor, run.workspace_id)

    if (run.status !== 'succeeded') {
      return {
        ok: false,
        errorCode: 'run_not_finished',
        errorMessage:
          'Only a run that finished successfully can be reproduced.',
      }
    }

    // From here on a failure is a finding about the run, and is kept.
    workspaceId = run.workspace_id
    outcome = await reproduceInScratch(conn, run, deps, tolerance)
  } catch (error) {
    if (!workspaceId) {
      return {
        ok: false,
        errorCode:
          error instanceof PipelineStepError ? error.code : 'pipeline_internal',
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }

    outcome = {
      status: 'failed',
      compared: null,
      summary: {},
      changes: [],
      errorCode:
        error instanceof PipelineStepError ? error.code : 'pipeline_internal',
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  } finally {
    // A reproduction leaves nothing behind, whatever happened.
    await conn.rollback().catch(() => {})
    await conn.end().catch(() => {})
  }

  // Only the verdict is kept, in its own short transaction.
  if (!workspaceId) {
    return {
      ok: false,
      errorCode: 'run_not_found',
      errorMessage: 'Pipeline run not found.',
    }
  }

  const keep = await deps.connect()

  try {
    await keep.begin()
    await setActorClaims(keep, actor, workspaceId)

    const { rows } = await keep.query<PipelineReproductionWire>(
      `SELECT * FROM api.record_pipeline_reproduction($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)`,
      [
        input.runId,
        outcome.status,
        tolerance,
        outcome.compared,
        JSON.stringify(outcome.summary),
        JSON.stringify(outcome.changes),
        outcome.errorCode,
        outcome.errorMessage ? truncate(outcome.errorMessage, 500) : null,
        Date.now() - startedAt,
      ],
    )

    await keep.commit()

    return { ok: true, reproduction: rows[0] }
  } catch (error) {
    await keep.rollback().catch(() => {})

    return {
      ok: false,
      errorCode: 'pipeline_internal',
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await keep.end().catch(() => {})
  }
}

async function reproduceInScratch(
  conn: ExecConnection,
  source: RunRow,
  deps: PipelineExecuteDeps,
  tolerance: number,
): Promise<ReproductionOutcome> {
  const config = parseConfig(source.configuration)

  const requestErrors = validatePipelineRunRequest(
    config,
    source.parameters,
    source.input_versions,
  )

  if (requestErrors.length > 0) {
    throw new PipelineStepError('invalid_run_request', requestErrors[0].message)
  }

  const { rows: manifestRows } = await conn.query<{ manifest: RunManifest }>(
    `SELECT manifest FROM api.pipeline_run_manifests WHERE run_id = $1`,
    [source.id],
  )

  const manifest: RunManifest | null = manifestRows.at(0)?.manifest ?? null

  // The decisions people gave at confirm steps are replayed, not asked again.
  const { rows: prompts } = await conn.query<{
    step_id: string
    answer: PipelineJsonObject
  }>(
    `SELECT step_id, answer FROM api.pipeline_run_prompts
      WHERE run_id = $1 AND answer IS NOT NULL`,
    [source.id],
  )

  const answered = new Map(prompts.map((p) => [p.step_id, p.answer]))

  const trialLogs: TrialLogEntry[] = []
  const run: RunRow = { ...source, trial: trialLogs }
  const materialized = await materializeInputs(conn, run)
  const inputs: PipelineReproductionSummary['inputs'] = []

  const recordedInputs = new Map(
    manifest?.inputs.map((entry) => [entry.name, entry]),
  )

  for (const input of materialized) {
    const recorded = recordedInputs.get(input.name)
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Every digest uses this transaction's single connection; preserve query and failure order rather than queue concurrent work on it.
    const digest = recorded ? await digestInput(conn, input.name) : null
    inputs.push({
      name: input.name,
      datasetVersionId: input.datasetVersionId,
      unchanged:
        recorded && digest
          ? recorded.contentDigest === digest.contentDigest
          : null,
    })
  }

  // A reproduction asks nobody: what the run was told is read from its recording.
  const web = newWebCallSession(
    'replay',
    await loadRunResponses(conn, source.id),
    { deps: deps.webCalls },
  )

  const transform = await withSandbox(conn, deps, (sandbox) =>
    executeSteps(
      conn,
      run,
      config,
      deps.executePython ?? executePythonTransform,
      sandbox,
      answered,
      deps.plugins,
      { ...externalSteps(deps), recorded: true, web },
    ),
  )

  if (transform.kind === 'error') {
    return {
      status: 'failed',
      compared: null,
      summary: { inputs },
      changes: [],
      errorCode: transform.code,
      errorMessage: transform.message,
    }
  }

  if (transform.kind !== 'rows') {
    return {
      status: 'failed',
      compared: null,
      summary: { inputs },
      changes: [],
      errorCode: 'run_cancelled',
      errorMessage: 'The re-run stopped before it produced a result.',
    }
  }

  const reproducedRows = rowsForOutput(config.output, transform)
  const reproducedDigest = digestRows(reproducedRows)
  const originalDigest = manifest?.outputs.contentDigest ?? null

  // Further outputs are compared by digest against what the manifest recorded.
  const furtherChecks = (config.moreOutputs ?? [])
    .filter((more) => more.mode !== 'none')
    .map((more, index) => {
      const recorded = manifest?.furtherOutputs?.[index]
      const moreDigest = digestRows(rowsForOutput(more, transform))

      return {
        from: more.from ?? null,
        originalDigest: recorded?.contentDigest ?? null,
        reproducedDigest: moreDigest,
        matches: recorded?.contentDigest === moreDigest,
      }
    })

  const withFurther = (outcome: ReproductionOutcome): ReproductionOutcome => {
    if (furtherChecks.length === 0) return outcome
    const allMatch = furtherChecks.every((check) => check.matches)

    return {
      ...outcome,
      status:
        outcome.status === 'matches' && !allMatch ? 'differs' : outcome.status,
      summary: {
        ...outcome.summary,
        identical: Boolean(outcome.summary.identical) && allMatch,
        furtherOutputs: furtherChecks,
      },
    }
  }

  const base: Partial<PipelineReproductionSummary> = {
    inputs,
    originalDigest,
    reproducedDigest,
    originalRows: manifest?.outputs.rowCount ?? 0,
    reproducedRows: reproducedRows.length,
  }

  if (originalDigest !== null && originalDigest === reproducedDigest) {
    return withFurther({
      status: 'matches',
      compared: 'digest',
      summary: {
        ...base,
        identical: true,
        matchedRows: reproducedRows.length,
        addedRows: 0,
        removedRows: 0,
        changedRows: 0,
        changedCells: 0,
        columnsAdded: [],
        columnsRemoved: [],
        changedColumns: {},
        largestDelta: {},
        truncated: false,
      },
      changes: [],
      errorCode: null,
      errorMessage: null,
    })
  }

  // Not byte for byte: find what the run recorded and compare row by row.
  const baseline = await loadReproductionBaseline(
    conn,
    source,
    config,
    manifest,
    reproducedRows,
  )

  if (!baseline) {
    return withFurther({
      status: originalDigest === null ? 'failed' : 'differs',
      compared: originalDigest === null ? null : 'digest',
      summary: {
        ...base,
        identical: false,
        note:
          originalDigest === null
            ? 'This run recorded no result to compare with.'
            : 'The result differs, but the run did not keep its rows, so what changed cannot be shown.',
      },
      changes: [],
      errorCode: originalDigest === null ? 'reproduce_no_baseline' : null,
      errorMessage:
        originalDigest === null
          ? 'This run recorded no result to compare with.'
          : null,
    })
  }

  const diff = diffResultRows(baseline.original, baseline.reproduced, tolerance)
  const { examples, ...counts } = diff

  const summary: Partial<PipelineReproductionSummary> = {
    ...base,
    ...counts,
    originalRows: baseline.originalTotal,
    identical: false,
  }

  if (baseline.note) summary.note = baseline.note

  return withFurther({
    status: diffMatches(diff) ? 'matches' : 'differs',
    compared: baseline.compared,
    summary,
    changes: examples,
    errorCode: null,
    errorMessage: null,
  })
}

/**
 * The rows to compare: the Dataset Version the run wrote when it holds exactly
 * the run's result; otherwise the preview the run stored (its first rows).
 * Both sides are keyed by the output field names, so the comparison reads like
 * the Dataset.
 */
async function loadReproductionBaseline(
  conn: ExecConnection,
  source: RunRow,
  config: PipelineConfig,
  manifest: RunManifest | null,
  reproducedRows: SqlResultRow[],
): Promise<{
  compared: 'dataset_version' | 'preview'
  original: SqlResultRow[]
  reproduced: SqlResultRow[]
  originalTotal: number
  note?: string
} | null> {
  const { rows: outputs } = await conn.query<{ dataset_version_id: string }>(
    `SELECT dataset_version_id FROM api.pipeline_run_outputs
      WHERE run_id = $1 ORDER BY created_at LIMIT 1`,
    [source.id],
  )

  const versionId = outputs[0]?.dataset_version_id
  const expectedRows = manifest?.outputs.rowCount ?? null

  if (versionId && reproducedRows.length <= REPRODUCE_COMPARE_ROW_LIMIT) {
    const version = await loadInputVersion(conn, source.workspace_id, versionId)

    if (version) {
      const fields = await loadSchemaFields(conn, version.schema_version_id)
      const count = await countInputRows(conn, version.id)

      // An appending pipeline's version also holds earlier runs' rows; only a
      // version that is exactly this run's result can be compared whole.
      if (
        fields.length > 0 &&
        count <= REPRODUCE_COMPARE_ROW_LIMIT &&
        (expectedRows === null || expectedRows === count)
      ) {
        const columns = fields.map((f) => ({
          slug: f.key,
          logicalType: f.logical_type,
          fieldId: f.field_id,
        }))

        await conn.query(buildInputTableDdl('_sb_reproduce_original', columns))
        await materializeInputRows(
          conn,
          '_sb_reproduce_original',
          version,
          columns,
        )

        const { rows } = await conn.query<{ row: SqlResultRow }>(
          `SELECT row_to_json(t) AS row FROM pg_temp._sb_reproduce_original t ORDER BY "_sb_row_id"`,
        )

        const original = rows.map((entry) => {
          const {
            _sb_row_id: _id,
            _sb_row_revision: _rev,
            ...values
          } = entry.row

          return values
        })

        return {
          compared: 'dataset_version',
          original,
          reproduced: toOutputFieldRows(config, fields, reproducedRows),
          originalTotal: count,
        }
      }
    }
  }

  const preview = readResultPreview(source.result ?? {})

  if (preview && preview.columns.length > 0) {
    const original = preview.rows.map((cells) =>
      Object.fromEntries(preview.columns.map((c, i) => [c, cells[i]])),
    )

    const shown = reproducedRows.slice(0, preview.rows.length)

    return {
      compared: 'preview',
      original,
      reproduced: shown.map((row) =>
        Object.fromEntries(preview.columns.map((c) => [c, row[c] ?? null])),
      ),
      originalTotal: preview.rowCount,
      note: `Compared the first ${preview.rows.length} rows only; the run did not keep its full result.`,
    }
  }

  return null
}

/** Reproduced result rows keyed the way the output Dataset keys them. */
function toOutputFieldRows(
  config: PipelineConfig,
  fields: SchemaFieldRow[],
  rows: SqlResultRow[],
): SqlResultRow[] {
  const mapping = config.output.fieldMapping ?? {}
  const byKey = new Map(fields.map((f) => [f.key, f]))

  return rows.map((row) => {
    const out: SqlResultRow = {}

    for (const [column, raw] of Object.entries(row)) {
      const field = byKey.get(mapping[column] ?? column)

      if (!field) continue

      if (raw === null || raw === undefined) {
        out[field.key] = null
        continue
      }

      const value = coerceValue(field.logical_type, raw)
      out[field.key] = value === COERCE_ERROR ? raw : value
    }

    return out
  })
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
  values?: PipelineJsonObject
  reason?: string
}

interface PromptRow {
  id: string
  workspace_id: string
  run_id: string
  step_id: string
  form_schema: PipelineJsonObject
  asked_user_ids: string[]
  answer: PipelineJsonObject | null
  answered_by_user_id: string | null
  answered_at: string | null
  expires_at: string | null
  created_at: string
}

type FinishOutcome =
  | { ok: true; run: PipelineRunWire | null }
  | { ok: false; code: PipelineErrorCode; message: string }

type RunCompletion = {
  actions: Awaited<ReturnType<typeof executePipelineActions>>
  rowCount: number
  resultPreview: ReturnType<typeof buildResultPreview>
  pythonUsage: PythonTransformUsage | undefined
  outputDatasetId: string | null
  outputDatasetVersionId: string | null
  outputLabel: string | null
  durationMs: number
  stageDurationsMs: Record<
    | 'materializeInputs'
    | 'transform'
    | 'outputCommit'
    | 'datasetCommit'
    | 'datasetSnapshot'
    | 'outputOverhead'
    | 'total',
    number
  >
}

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
    rows: SqlResultRow[]
    durationMs: number
    usage?: PythonTransformUsage
    effectPrevious?: Record<string, SqlResultRow[]>
    webResponses?: RecordedResponse[]
    stepResults?: Record<string, SqlResultRow[]>
  },
  timing: {
    startedAt: number
    materializeMs: number
    observeStage: (stage: PipelineStage, ms: number) => void
  },
): Promise<FinishOutcome> {
  const { startedAt, materializeMs, observeStage } = timing

  await holdWorkspaceWrites(conn, run)
  const outputStarted = Date.now()

  if (!(await isRunRunning(conn, run.id)))
    throw new PipelineStepError('run_cancelled', 'Run was cancelled.')

  const noOutput = {
    ok: true as const,
    datasetId: null,
    datasetVersionId: null,
    label: null,
    commitMs: 0,
    snapshotMs: 0,
  }

  const output =
    config.output.mode === 'none'
      ? noOutput
      : await writeOutput(
          conn,
          run,
          config.output,
          rowsForOutput(config.output, transform),
        )

  // Further outputs (file-only) are written in the same transaction, each
  // from the rows of the step it names. Any one refused rolls back them all.
  const furtherOutputs: FurtherOutput[] = []

  if (output.ok)
    for (const [index, more] of (config.moreOutputs ?? []).entries()) {
      if (more.mode === 'none') continue
      const rows = rowsForOutput(more, transform)

      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- outputs are written one after another inside one transaction; each re-reads the Dataset revision it extends.
      const written = await writeOutput(conn, run, more, rows, index + 1)

      if (!written.ok) {
        await conn.query('ROLLBACK TO SAVEPOINT sb_pipeline_work')
        await failRun(conn, run, written.code, written.message)

        return { ok: false, code: written.code, message: written.message }
      }

      furtherOutputs.push({
        index: index + 1,
        from: more.from ?? null,
        rows: rows.length,
        ...written,
      })
      await log(conn, run, 'info', 'output', `Output ${index + 2} recorded.`, {
        datasetId: written.datasetId,
        datasetVersionId: written.datasetVersionId,
        from: more.from ?? null,
        rows: rows.length,
      })
    }

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

  const actions = pipelineActionSteps(config)

  // `output` is the first output; `outputs` lists every one, first first.
  const allOutputs = [
    {
      datasetId: output.datasetId,
      datasetVersionId: output.datasetVersionId,
      label: output.label,
    },
    ...furtherOutputs.map((more) => ({
      datasetId: more.datasetId,
      datasetVersionId: more.datasetVersionId,
      label: more.label,
    })),
  ]

  const actionResults = await executePipelineActions(
    conn,
    { workspaceId: run.workspace_id, runId: run.id },
    actions,
    {
      parameters: run.parameters,
      previous: transform.rows,
      previousFor: transform.effectPrevious,
      output: {
        datasetId: output.datasetId,
        datasetVersionId: output.datasetVersionId,
        label: output.label,
      },
      outputs: allOutputs,
    },
  )

  for (const action of actions) {
    await log(conn, run, 'info', 'action', `${action.name} completed.`, {
      name: action.name,
      operation: action.operation,
    })
  }

  const completion = {
    actions: actionResults,
    rowCount: transform.rows.length,
    resultPreview: buildResultPreview(transform.rows),
    // PIPE-04.3: the run's peak measured Python payload usage (omitted when no
    // Python step ran). Stored on the run so the UI can show storage/limits.
    pythonUsage: transform.usage,
    outputDatasetId: output.datasetId,
    outputDatasetVersionId: output.datasetVersionId,
    outputLabel: output.label,
    furtherOutputs: furtherOutputs.map((more) => ({
      datasetId: more.datasetId,
      datasetVersionId: more.datasetVersionId,
      label: more.label,
      from: more.from,
      rows: more.rows,
    })),
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
    previousFor: transform.effectPrevious,
    actions: actionResults,
    output: {
      datasetId: output.datasetId,
      datasetVersionId: output.datasetVersionId,
      label: output.label,
    },
    outputs: allOutputs,
  })
  const finished = await completeRun(conn, run, completion)
  // The evidence is written in the transaction that completes the run: a run
  // either succeeds with a manifest or does not succeed. It is written by the
  // executor itself, not under the request role: the output phase ran as
  // `authenticated`, which can neither read the materialized temp tables to
  // digest them nor insert evidence.
  await conn.query('SET LOCAL ROLE NONE')
  await persistRunResponses(conn, run, transform.webResponses ?? [])
  const webResponses = await runManifestResponses(conn, run.id)
  await recordRunManifest(conn, {
    run: {
      ...run,
      configuration: { ...config },
      definition_version_id: run.definition_version_id,
    },
    inputNames: config.inputs.map((input) => input.name),
    // A plugin step has no code: its digest covers which step runs and what it is given.
    steps: manifestSteps(config),
    output: {
      mode: config.output.mode,
      datasetId: output.datasetId,
      datasetVersionId: output.datasetVersionId,
      label: output.label,
    },
    furtherOutputs: furtherOutputs.map((more) => ({
      datasetId: more.datasetId,
      datasetVersionId: more.datasetVersionId,
      label: more.label,
      from: more.from,
      rows: rowsForOutput(config.moreOutputs?.[more.index - 1], transform),
    })),
    rows: rowsForOutput(config.output, transform),
    actions: actions.map((action) => ({
      name: action.name,
      operation: action.operation,
    })),
    responses: webResponses,
    finishedAt: finished?.finished_at
      ? new Date(finished.finished_at).toISOString()
      : null,
  })

  return { ok: true, run: finished }
}

/** Keep the committed proposal bounded; a large one is stored as a summary. */
function boundProposal(rows: SqlResultRow[]) {
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
  await flushLogs(conn, run)

  if (outcome.step.kind === 'remote_job') {
    // The run waits for a job on a cluster, not for a person: no prompt, and
    // the sweep wakes it once the job has an answer, fails or runs out of time.
    const job = outcome.job

    const pending = {
      step: outcome.step.name,
      since: new Date().toISOString(),
      previousRows: outcome.previous.length,
      kind: 'remote_job',
      queue: job?.queue ?? outcome.step.remoteJob.queue,
      deadlineAt: job?.deadline_at ?? null,
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

    return
  }

  const confirm = outcome.step.ask
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

  // What a web call was told stays with the run: resuming reads it, not asks again.
  await persistRunResponses(conn, run, outcome.webResponses ?? [])

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
  detail: SqlResultRow,
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

type ResumeCheck =
  | { ok: false; report: PipelineExecuteReport }
  | {
      ok: true
      run: RunRow
      prompt: PromptRow
      config: PipelineConfig
      decision: PipelineConfirmAnswerInput
    }

const confirmAnswerSchema = z.object({
  decision: z.enum(['confirm', 'skip', 'stop']),
  values: pipelineJsonObjectSchema.optional(),
})

function refuse(errorCode: PipelineErrorCode, errorMessage: string) {
  return {
    ok: false,
    report: { ok: false, errorCode, errorMessage },
  } satisfies ResumeCheck
}

/** The checks a decision must pass before it may resume a waiting run. */
async function checkResumable(
  conn: ExecConnection,
  actor: string,
  runId: string,
  answer: z.core.util.JSONType | undefined,
): Promise<ResumeCheck> {
  const run = await loadRun(conn, runId)

  if (!run) return refuse('run_not_found', 'Pipeline run not found.')
  await assertMember(conn, run.workspace_id, actor)

  if (run.status !== 'waiting')
    return refuse('run_not_waiting', 'This run is not waiting for a decision.')
  const prompt = await loadOpenPrompt(conn, run.id)

  if (!prompt)
    return refuse(
      'prompt_not_found',
      'No open decision was found for this run.',
    )

  if (!prompt.asked_user_ids.includes(actor))
    return refuse('confirm_not_asked', 'You were not asked to decide this run.')
  const config = parseConfig(run.configuration)
  const step = findPipelineConfirmStep(config, prompt.step_id)

  if (!step)
    return refuse(
      'invalid_configuration',
      'The waiting step is not an ask step in this version.',
    )
  const answerError = validateConfirmAnswer(step.ask, answer)

  if (answerError) return refuse('invalid_answer', answerError)

  const decision = confirmAnswerSchema.parse(answer)

  return { ok: true, run, prompt, config, decision }
}

/**
 * Check a decision without recording it, so the route can refuse a bad one
 * immediately and only queue a resumption that has a chance to apply.
 */
export async function validatePipelineResume(
  actor: string,
  runId: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public answer boundary immediately decodes JSON before the authorization/form checks.
  answer: unknown,
  deps: PipelineExecuteDeps,
): Promise<
  | { ok: true; workspaceId: string }
  | { ok: false; report: PipelineExecuteReport }
> {
  const decodedAnswer = pipelineJsonValueSchema.safeParse(answer)
  const conn = await deps.connect()

  try {
    await conn.begin()
    const checked = await checkResumable(conn, actor, runId, decodedAnswer.data)

    return checked.ok
      ? { ok: true, workspaceId: checked.run.workspace_id }
      : checked
  } catch (error) {
    return {
      ok: false,
      report: {
        ok: false,
        errorCode:
          error instanceof PipelineStepError ? error.code : 'pipeline_internal',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    }
  } finally {
    await conn.rollback().catch(() => {})
    await conn.end().catch(() => {})
  }
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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public answer boundary immediately decodes JSON before the authorization/form checks.
  answer: unknown,
  deps: PipelineExecuteDeps,
): Promise<PipelineExecuteReport> {
  const decodedAnswer = pipelineJsonValueSchema.safeParse(answer)
  const conn = await deps.connect()
  await conn.begin()
  const startedAt = Date.now()
  let workStarted = false

  try {
    const checked = await checkResumable(conn, actor, runId, decodedAnswer.data)

    if (!checked.ok) {
      await conn.rollback()

      return checked.report
    }

    const { run, prompt, config, decision } = checked

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

    if (!(await tryPipelineExecutionLock(conn, run))) {
      await conn.rollback()

      return {
        ok: false,
        errorCode: 'workspace_busy',
        errorMessage: 'Another run of this pipeline is executing.',
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

    const answered = new Map<string, PipelineJsonObject>([
      [prompt.step_id, pipelineJsonObjectSchema.parse(decodedAnswer.data)],
    ])

    // Asking again from the top: what a web call was told before the pause is read, not fetched.
    const web = newWebCallSession(
      'live',
      await loadRunResponses(conn, run.id),
      { deps: deps.webCalls },
    )

    const transform = await withSandbox(conn, deps, (sandbox) =>
      executeSteps(
        conn,
        run,
        config,
        deps.executePython ?? executePythonTransform,
        sandbox,
        answered,
        deps.plugins,
        { ...externalSteps(deps), web },
      ),
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
      await failRun(
        conn,
        run,
        transform.code,
        transform.message,
        transform.detail,
      )
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
    if (isWorkspaceBusy(error)) {
      await conn.rollback()

      return {
        ok: false,
        errorCode: 'workspace_busy',
        errorMessage: 'Another pipeline in this workspace is writing.',
      }
    }

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
          answer: PipelineJsonObject | null
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

        const outcome = step ? confirmNoAnswerOutcome(step.ask) : 'fail'

        if (outcome === 'apply' && step) {
          if (!(await tryPipelineExecutionLock(conn, run))) {
            // Another run of this pipeline is executing; the next sweep applies it.
            await conn.rollback()
            continue
          }

          // Hold the log lines back until the output phase takes the
          // workspace's write lock (see holdWorkspaceWrites).
          run.pendingLogs = []

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

          const answered = new Map<string, PipelineJsonObject>([
            [prompt.step_id, { decision: 'confirm', values: {} }],
          ])

          const web = newWebCallSession(
            'live',
            await loadRunResponses(conn, run.id),
            { deps: deps.webCalls },
          )

          const transform = await withSandbox(conn, deps, (sandbox) =>
            executeSteps(
              conn,
              run,
              config,
              deps.executePython ?? executePythonTransform,
              sandbox,
              answered,
              deps.plugins,
              { ...externalSteps(deps), web },
            ),
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
            await failRun(
              conn,
              run,
              transform.code,
              transform.message,
              transform.detail,
            )
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

/**
 * One run of a pipeline executes at a time; runs of different pipelines in a
 * workspace execute side by side. A run that finds its pipeline busy is
 * deferred by the queue, never failed.
 */
async function tryPipelineExecutionLock(
  conn: ExecConnection,
  run: RunRow,
): Promise<boolean> {
  const { rows } = await conn.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
    [`pipeline-definition:${run.definition_id ?? run.definition_version_id}`],
  )

  return rows[0]?.acquired !== false
}

/** How long a run waits for another pipeline to finish writing to the workspace. */
const WORKSPACE_WRITE_WAIT = '20s'

class WorkspaceBusyError extends Error {}

/** A lock that could not be had in time, or a deadlock the database broke. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A caught error is unknown; its code is decoded here.
function isWorkspaceBusy(error: unknown): boolean {
  if (error instanceof WorkspaceBusyError) return true
  const code = z.object({ code: z.string() }).safeParse(error)

  return (
    code.success && (code.data.code === '55P03' || code.data.code === '40P01')
  )
}

/**
 * Writing the output takes the workspace row exclusively (display ids), and
 * every log line holds a shared lock on it. So writes are taken in turn: a run
 * keeps its log lines in memory while its steps work, takes the workspace's
 * write lock before it writes anything there, then writes its log lines and
 * its output. A run waiting for the lock holds no lock on the workspace row,
 * so the two can never wait on each other.
 */
async function holdWorkspaceWrites(
  conn: ExecConnection,
  run: RunRow,
): Promise<void> {
  if (run.trial) return

  try {
    await conn.query(`SELECT set_config('lock_timeout', $1, true)`, [
      WORKSPACE_WRITE_WAIT,
    ])
    await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `pipeline-workspace:${run.workspace_id}`,
    ])
    await conn.query(`SELECT set_config('lock_timeout', '0', true)`)
  } catch (error) {
    if (isWorkspaceBusy(error))
      throw new WorkspaceBusyError('The workspace is busy.')
    throw error
  }

  await flushLogs(conn, run)
}

/** Write the log lines a run held back, in order. */
async function flushLogs(conn: ExecConnection, run: RunRow): Promise<void> {
  const pending = run.pendingLogs

  run.pendingLogs = undefined

  for (const entry of pending ?? [])
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Log sequence numbers follow write order on the run's single connection.
    await log(conn, run, entry.level, entry.stage, entry.message, entry.detail)
}

async function loadRun(
  conn: ExecConnection,
  runId: string,
): Promise<RunRow | null> {
  const { rows } = await conn.query<RunRow>(
    `SELECT r.id, r.workspace_id, r.definition_version_id, r.trigger_kind,
            r.status, r.attempt, r.retry_of_run_id, r.trigger_occurrence_id,
            r.schedule_id, r.input_digest,
            r.parameters, r.input_versions, r.result, r.actor_user_id, r.actor_credential_id,
            v.version AS version_number, v.configuration, d.name AS definition_name,
            v.definition_id
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

const executionConfigSchema = z.custom<PipelineConfig>(
  (value) => validatePipelineConfig(value).length === 0,
)

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw authoring boundary immediately validates with the canonical validator, preserving its rejection diagnostics.
function parseConfig(raw: unknown): PipelineConfig {
  const errors = validatePipelineConfig(raw)

  if (errors.length > 0) {
    throw new PipelineStepError(
      'invalid_configuration',
      `Pipeline configuration is invalid: ${errors[0].message}`,
    )
  }

  return executionConfigSchema.parse(raw)
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
  const config = parseConfig(run.configuration)
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
      rows: SqlResultRow[]
      durationMs: number
      /** PIPE-04.3: per-run peak payload usage measured across Python steps. */
      usage?: PythonTransformUsage
      /**
       * What each action and notification reads as `previous`: the result of
       * the data step before it. They run once the output is written.
       */
      effectPrevious?: Record<string, SqlResultRow[]>
      /** What web call steps fetched this time and the run does not hold yet. */
      webResponses?: RecordedResponse[]
      /** What each data step gave back: an output may take its rows from any of them. */
      stepResults?: Record<string, SqlResultRow[]>
    }
  | {
      kind: 'waiting'
      step: PipelineAskStep | PipelineRemoteJobStep
      /** A remote job step waits for its job, not a person. */
      job?: RemoteJobRow
      /** The last executed step's result: what the steps after the ask read. */
      previous: SqlResultRow[]
      /** What the person is shown: the rows of the step before the ask. */
      proposal: SqlResultRow[]
      durationMs: number
      webResponses?: RecordedResponse[]
    }
  | { kind: 'cancelled' }
  | {
      kind: 'error'
      code: PipelineErrorCode
      message: string
      /** Extra context for the failure log: what a Python step printed, and where it failed. */
      detail?: SqlResultRow
    }

/**
 * Run `fn` with the run's sandbox session and always discard the session
 * afterwards. A statement that outlives its budget is terminated from the
 * orchestration side, which the sandbox login cannot prevent.
 */
async function withSandbox<T>(
  conn: ExecConnection,
  deps: PipelineExecuteDeps,
  fn: (sandbox: SandboxSession) => Promise<T>,
): Promise<T> {
  const sandbox = new SandboxSession(
    deps.sandbox ?? connectPipelineSandbox,
    async (pid) => {
      await conn.query('SELECT pg_terminate_backend($1)', [pid])
    },
  )

  try {
    return await fn(sandbox)
  } finally {
    await sandbox.close()
  }
}

/**
 * The data steps a run executes, as the manifest records them: a plugin step
 * has no code, so its digest covers which step runs and what it is given.
 */
function manifestSteps(
  config: PipelineConfig,
): Array<{ name: string; language: string; statement: string }> {
  return pipelineDataSteps(config).map((step) => ({
    name: step.name,
    language: stepRuns(step.kind),
    statement:
      step.kind === 'plugin'
        ? JSON.stringify(step.plugin)
        : step.kind === 'remote_job'
          ? JSON.stringify(step.remoteJob)
          : step.kind === 'web_call'
            ? JSON.stringify(step.webCall)
            : step.statement,
  }))
}

/** The decisions people gave a run at its ask steps, by step name. */
async function loadAnsweredPrompts(
  conn: ExecConnection,
  runId: string,
): Promise<Map<string, PipelineJsonObject> | undefined> {
  const { rows } = await conn.query<{
    step_id: string
    answer: PipelineJsonObject
  }>(
    `SELECT step_id, answer FROM api.pipeline_run_prompts
      WHERE run_id = $1 AND answer IS NOT NULL`,
    [runId],
  )

  return rows.length > 0
    ? new Map(rows.map((row) => [row.step_id, row.answer]))
    : undefined
}

async function defaultRemoteJobDeps(): Promise<RemoteJobDeps> {
  return (await import('./pipeline-hpc-deps.server')).realRemoteJobDeps
}

async function defaultLakeStorage(): Promise<Pick<ObjectStorage, 'getStream'>> {
  return (await import('./file-storage')).getObjectStorage()
}

/** Run ordered analysis steps without exposing the orchestration connection to Python. */
async function executeSteps(
  conn: ExecConnection,
  run: RunRow,
  config: PipelineConfig,
  python: typeof executePythonTransform,
  sandbox: SandboxSession,
  answered?: Map<string, PipelineJsonObject>,
  plugins?: ExtensionRuntimeDeps,
  external: ExternalStepDeps = {},
): Promise<TransformOutcome> {
  const started = Date.now()
  const web = external.web ?? newWebCallSession('live', [])
  let previous: SqlResultRow[] | undefined
  // Steps skipped by a Skip decision: the ask step's declared dependents.
  const skipped = new Set<string>()
  // The most recent recorded decision, exposed to the steps after it.
  let answerValues: PipelineJsonObject | null = null
  // PIPE-04.3: the peak payload usage reported by any Python step this run. Accumulated into a
  // list rather than folded into a running object: a flag assigned inside the callback is
  // narrowed to its initialiser by control-flow analysis, so the result could not ask whether
  // anything had been seen.
  const usages: PythonTransformUsage[] = []

  const recordUsage = (usage: PythonTransformUsage | undefined): void => {
    if (!usage) return
    usages.push(usage)
  }

  // What each step gave back, so a plugin step can read any earlier one by name.
  const stepResults: Record<string, SqlResultRow[]> = {}
  // What each action and notification will read as `previous`.
  const effectPrevious: Record<string, SqlResultRow[]> = {}

  const inputRows = async (name: string) => {
    if (!config.inputs.some((input) => input.name === name)) return undefined

    const { rows } = await conn.query<{ row: SqlResultRow }>(
      `SELECT row_to_json(t) AS row FROM pg_temp.${quoteIdentifier(name)} t ORDER BY "_sb_row_id"`,
    )

    return rows.map((entry) => entry.row)
  }

  const runStep = async (
    index: number,
    step: PipelineDataStep,
  ): Promise<TransformOutcome> => {
    if (step.kind === 'plugin') {
      try {
        const actor =
          run.actor_user_id ??
          (
            await conn.query<{ id: string | null }>(
              'SELECT api.current_user_id() AS id',
            )
          ).rows.at(0)?.id

        if (!actor)
          throw new PluginStepError('This run has no person to act as.')

        const result = await runPluginStep(
          {
            workspaceId: run.workspace_id,
            actorUserId: actor,
            step,
            deps: plugins,
          },
          {
            parameters: run.parameters,
            previous,
            inputRows,
            steps: stepResults,
          },
        )

        await log(
          conn,
          run,
          'info',
          'plugin',
          `Plugin step ${index + 1} completed.`,
          { step: step.name, operation: step.plugin.operation },
        )

        return {
          kind: 'rows',
          rows: pythonInputRowsSchema.parse(result.rows),
          durationMs: Date.now() - started,
        }
      } catch (error) {
        return {
          kind: 'error',
          code: 'transform_failed',
          message: `Plugin step ${step.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          detail: { step: step.name },
        }
      }
    }

    if (step.kind === 'remote_job') {
      // A trial of a draft sends nothing to a cluster: it hands the rows on.
      if (run.trial && run.definition_version_id === '') {
        await log(
          conn,
          run,
          'info',
          'remote_job',
          `Remote job step ${index + 1} is not sent in a trial; its rows pass through.`,
          { step: step.name, queue: step.remoteJob.queue },
        )

        return {
          kind: 'rows',
          rows: previous ?? [],
          durationMs: Date.now() - started,
        }
      }

      const remote = external.remote ?? (await defaultRemoteJobDeps())

      try {
        const outcome = await runRemoteJobStep({
          conn,
          run,
          step,
          previous: remoteRowsOf(previous ?? []),
          deps: remote,
          recordedOnly: external.recorded === true,
        })

        if (outcome.kind === 'error')
          return {
            kind: 'error',
            code: 'transform_failed',
            message: outcome.message,
            detail: { step: step.name },
          }

        if (outcome.kind === 'waiting') {
          await log(
            conn,
            run,
            'info',
            'remote_job',
            `Remote job step ${index + 1} is on ${outcome.job.queue}; the run waits for it.`,
            {
              step: step.name,
              queue: outcome.job.queue,
              connection: outcome.job.connection_key,
              jobId: outcome.job.external_job_id,
              limitMinutes: outcome.job.limit_minutes,
            },
          )

          return {
            kind: 'waiting',
            step,
            job: outcome.job,
            previous: previous ?? [],
            proposal: previous ?? [],
            durationMs: Date.now() - started,
          }
        }

        await log(
          conn,
          run,
          'info',
          'remote_job',
          `Remote job step ${index + 1} gave ${outcome.rows.length} rows back.`,
          { step: step.name, rows: outcome.rows.length },
        )

        return {
          kind: 'rows',
          rows: pythonInputRowsSchema.parse(outcome.rows),
          durationMs: Date.now() - started,
        }
      } catch (error) {
        return {
          kind: 'error',
          code: 'transform_failed',
          message: `Remote job step ${step.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          detail: { step: step.name },
        }
      }
    }

    if (step.kind === 'web_call') {
      try {
        const result = await runWebCallStep({
          workspaceId: run.workspace_id,
          stepName: step.name,
          call: step.webCall,
          parameters: run.parameters,
          session: web,
          deps: web.deps ?? defaultWebCallDeps(),
        })

        await log(
          conn,
          run,
          'info',
          'web_call',
          `Web call step ${index + 1} completed.`,
          {
            step: step.name,
            method: result.response.method,
            // Where it went, never what it asked: the query and the secret stay out of the log.
            url:
              new URL(result.response.url).origin +
              new URL(result.response.url).pathname,
            status: result.response.status,
            attempts: result.response.attempts,
          },
        )

        return {
          kind: 'rows',
          rows: pythonInputRowsSchema.parse(result.rows),
          durationMs: Date.now() - started,
        }
      } catch (error) {
        return {
          kind: 'error',
          code: 'transform_failed',
          message: `Web call step ${step.name}: ${
            error instanceof WebCallError || error instanceof Error
              ? error.message
              : String(error)
          }`,
          detail: { step: step.name },
        }
      }
    }

    if (step.kind === 'python') {
      const inputs: Record<string, SqlResultRow[]> = {}

      for (const input of config.inputs) {
        const { rows } = await conn.query<{ row: SqlResultRow }>(
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
          artefactKey: run.trial ? undefined : run.id,
          statement: step.statement,
          inputs: pythonInputsSchema.parse(inputs),
          parameters: run.parameters,
          runtime: config.pythonRuntime,
          requirements: config.pythonRequirements,
          contract: step.contract,
        })

        await log(
          conn,
          run,
          'info',
          'python',
          `Python step ${index + 1} completed.`,
          {
            step: step.name,
            runtime: result.runtime,
            environment: result.environment
              ? { ...result.environment }
              : undefined,
            logs: result.logs,
          },
        )
        recordUsage(result.usage)

        return {
          kind: 'rows',
          rows: result.rows,
          durationMs: Date.now() - started,
        }
      } catch (error) {
        const failure = error instanceof PipelinePythonError ? error : null

        const message =
          error instanceof Error ? error.message : 'Python execution failed.'

        const detail: PythonFailureDetail = { step: step.name }

        if (failure?.logs.length) detail.logs = failure.logs

        if (failure?.line) detail.line = failure.line

        return {
          kind: 'error',
          code: pythonErrorCode(failure),
          // A traceback-free message still needs to say where: point at the line.
          message:
            failure?.line && !/\bline \d+/.test(message)
              ? `${message} (line ${failure.line} of step ${step.name})`
              : message,
          // The step's own output survives the rollback because it travels with the
          // failure log, which is written after it.
          detail,
        }
      }
    }

    if (previous) await materializePrevious(conn, previous)

    // SQL against the lakehouse: the open tables the step names become tables
    // of its own SQL, as they stand in their current snapshot.
    if (step.kind === 'lakehouse') {
      const loaded = await loadLakeTables({
        conn,
        workspaceId: run.workspace_id,
        tables: step.lake.tables,
        storage: external.lakeStorage ?? (await defaultLakeStorage()),
      })

      if (loaded.kind === 'error')
        return {
          kind: 'error',
          code: 'input_not_found',
          message: `Lakehouse step ${step.name}: ${loaded.message}`,
          detail: { step: step.name },
        }

      for (const table of loaded.tables)
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- copyTable shares a lazily opened sandbox session and mutates its temp tables; concurrent calls can race session creation and DDL.
        await sandbox.copyTable(conn, table.name)

      await log(
        conn,
        run,
        'info',
        'lakehouse',
        `Lakehouse step ${index + 1} read ${loaded.tables.length} open tables.`,
        {
          step: step.name,
          tables: loaded.tables.map(({ name, snapshotId, rows }) => ({
            name,
            snapshotId,
            rows,
          })),
        },
      )
    }

    // Hand the sandbox exactly the tables this step may read.
    for (const input of config.inputs)
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- copyTable shares a lazily opened sandbox session and mutates its temp tables; concurrent calls can race session creation and DDL.
      if (!sandbox.has(input.name)) await sandbox.copyTable(conn, input.name)

    if (previous) await sandbox.copyTable(conn, 'previous')

    if (answerValues && !sandbox.has('confirm_answer'))
      await sandbox.copyTable(conn, 'confirm_answer')

    return executeTransform(run, config, step.statement, sandbox, conn)
  }

  for (const [index, step] of config.steps.entries()) {
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

    // Actions and notifications run once the output is written; note what
    // they will read.
    if (step.kind === 'action' || step.kind === 'notify') {
      effectPrevious[step.name] = previous ?? []
      continue
    }

    // PIPE-02: an ask step shows a person the rows so far and waits. Confirm
    // carries on with those rows; Skip leaves out the steps it names.
    if (step.kind === 'ask') {
      const shown = previous ?? []
      const recordedDecision = answered?.get(step.name)

      if (!recordedDecision) {
        return {
          kind: 'waiting',
          step,
          previous: shown,
          proposal: shown,
          durationMs: Date.now() - started,
          webResponses: web.collected,
        }
      }

      const decision = confirmAnswerSchema.parse(recordedDecision)

      if (decision.decision === 'skip')
        for (const name of step.ask.skipSteps ?? []) skipped.add(name)

      stepResults[step.name] = shown
      answerValues =
        pipelineJsonObjectSchema.optional().parse(decision.values) ?? {}
      await provisionConfirmAnswer(conn, answerValues)
      await log(
        conn,
        run,
        'info',
        'confirm',
        `${index + 1}. ${step.name} answered: ${decision.decision}.`,
        {
          step: index + 1,
          name: step.name,
          decision: decision.decision,
          skipped: [...skipped],
        },
      )
      continue
    }

    // The skip rule: nothing came out of the step before, so this one has
    // nothing to work on. The empty result carries on.
    if (step.onlyIfRows && previous !== undefined && previous.length === 0) {
      stepResults[step.name] = previous
      await log(
        conn,
        run,
        'info',
        'skip',
        `${index + 1}. ${step.name} skipped: the step before it gave no rows.`,
        { step: index + 1, name: step.name, reason: 'no_rows' },
      )
      continue
    }

    if (!(await isRunRunning(conn, run.id, run.trial !== undefined)))
      return { kind: 'cancelled' }
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

    previous = outcome.rows
    stepResults[step.name] = outcome.rows
    await log(
      conn,
      run,
      'info',
      'step',
      `${index + 1}. ${step.name} completed.`,
      {
        step: index + 1,
        name: step.name,
        language: stepRuns(step.kind),
        kind: step.kind,
        rowCount: previous.length,
        columns: Object.keys(previous.at(0) ?? {}).slice(0, 100),
      },
    )
  }

  const outcome: Extract<TransformOutcome, { kind: 'rows' }> = {
    kind: 'rows',
    rows: previous ?? [],
    durationMs: Date.now() - started,
    effectPrevious,
    webResponses: web.collected,
    stepResults,
  }

  if (usages.length > 0)
    outcome.usage = {
      inputBytes: Math.max(...usages.map((u) => u.inputBytes)),
      outputBytes: Math.max(...usages.map((u) => u.outputBytes)),
      rows: Math.max(...usages.map((u) => u.rows)),
      cells: Math.max(...usages.map((u) => u.cells)),
    }

  return outcome
}

/**
 * Map a runner failure onto the executor's bounded error codes. Size and
 * timeout limits are reported with their own codes (and a numeric message from
 * the broker) rather than collapsing into a bare `transform_failed`.
 */
function pythonErrorCode(error: PipelinePythonError | null): PipelineErrorCode {
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
  values: PipelineJsonObject,
): Promise<void> {
  await conn.query('DROP TABLE IF EXISTS pg_temp.confirm_answer')
  await conn.query('CREATE TEMP TABLE confirm_answer (answer jsonb)')
  await conn.query(
    'INSERT INTO pg_temp.confirm_answer (answer) VALUES ($1::jsonb)',
    [JSON.stringify(values)],
  )
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/** Infer a bounded primitive table for a SQL step reading the preceding result. */
async function materializePrevious(
  conn: ExecConnection,
  rows: SqlResultRow[],
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
    const values = rows.flatMap((row) =>
      row[name] === null || row[name] === undefined ? [] : [row[name]],
    )

    const type = values.every(
      (value) => numericResultSchema.safeParse(value).success,
    )
      ? 'numeric'
      : values.every((value) => z.boolean().safeParse(value).success)
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
}

async function executeTransform(
  run: RunRow,
  config: PipelineConfig,
  statement: string,
  sandbox: SandboxSession,
  conn: ExecConnection,
): Promise<TransformOutcome> {
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

  try {
    const result = await sandbox.run<SqlResultRow>(
      wrapped,
      EXECUTION_TIMEOUT_SECONDS,
    )

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
        const text = z.string().safeParse(value)

        if (text.success && text.data.length > RESULT_CELL_LIMIT) {
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
    // The sandbox is a separate session, so a failed statement cannot poison
    // the run's transaction: there is nothing to restore here.
    if (error instanceof SandboxUnavailableError) {
      return {
        kind: 'error',
        code: 'pipeline_internal',
        message: error.message,
      }
    }

    const message = error instanceof Error ? error.message : String(error)

    if (
      /statement timeout|terminating connection|connection terminated/i.test(
        message,
      )
    ) {
      return {
        kind: 'error',
        code: 'transform_timed_out',
        message: `Transform exceeded the ${EXECUTION_TIMEOUT_SECONDS}s execution limit.`,
      }
    }

    const hint = /does not exist/i.test(message)
      ? await availableColumnsHint(conn)
      : ''

    return {
      kind: 'error',
      code: 'transform_failed',
      message: `Transform failed: ${truncate(message, 500)}${hint}`,
    }
  }
}

/**
 * When a transform names a table or column that is not there, say what is:
 * the declared inputs (and `previous`) with their column keys. Best effort;
 * the failure is reported either way.
 */
async function availableColumnsHint(conn: ExecConnection): Promise<string> {
  try {
    const { rows } = await conn.query<{ table_name: string; columns: string }>(
      `SELECT c.table_name, string_agg(c.column_name, ', ' ORDER BY c.ordinal_position) AS columns
         FROM information_schema.columns c
        WHERE c.table_schema = pg_my_temp_schema()::regnamespace::text
          AND c.column_name NOT LIKE '\\_sb\\_%'
        GROUP BY c.table_name
        ORDER BY c.table_name`,
    )

    if (rows.length === 0) return ''
    const listing = rows.map((r) => `${r.table_name}(${r.columns})`).join('; ')

    return `. Available: ${truncate(listing, 600)}`
  } catch {
    return ''
  }
}

async function isRunRunning(
  conn: ExecConnection,
  runId: string,
  trial = false,
): Promise<boolean> {
  if (trial) return true

  const { rows } = await conn.query<{ status: string }>(
    `SELECT status FROM api.pipeline_runs WHERE id = $1`,
    [runId],
  )

  return rows[0]?.status === 'running'
}

// ---------------------------------------------------------------------------
// Output materialization through canonical operations.
// ---------------------------------------------------------------------------

type FurtherOutput = {
  index: number
  from: string | null
  rows: number
  datasetId: string
  datasetVersionId: string
  label: string
}

/**
 * The rows an output writes: those of the step it names, or the result of the
 * last data step when it names none.
 */
function rowsForOutput(
  output: PipelineOutput | undefined,
  transform: {
    rows: SqlResultRow[]
    stepResults?: Record<string, SqlResultRow[]>
  },
): SqlResultRow[] {
  if (!output?.from) return transform.rows

  return transform.stepResults?.[output.from] ?? []
}

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
  output: PipelineOutput,
  resultRows: SqlResultRow[],
  /** 0 for the first output; a further output's commits carry its slot so no two share a key. */
  slot = 0,
): Promise<OutputOutcome> {
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
    // "Create" makes the Dataset once. Later runs of the same pipeline add a
    // new Dataset Version to it instead of making another one every time.
    const created =
      (await findOwnOutputDataset(
        conn,
        run,
        output.schemaVersionId!,
        output.datasetName!,
      )) ??
      (await createDataset(
        conn,
        run.workspace_id,
        output.schemaVersionId!,
        output.datasetName!,
        run.actor_user_id,
      ))

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

  const mapped = mapOutputRows(output, fields, resultRows)

  if (mapped.kind === 'error') {
    return { ok: false, code: mapped.code, message: mapped.message }
  }

  // A data contract on the output's schema can refuse the whole result before
  // any of it is written. Every chunk is checked at once, so a rule about the
  // batch (a value that must be unique, a share that must be filled in) sees
  // the whole result, not one slice of it.
  if (mapped.rows.length > 0) {
    const gate = await conn.query<{ result: ContractGateReport | null }>(
      `SELECT api.check_dataset_contract($1, $2::jsonb, 'pipeline') result`,
      [datasetId, JSON.stringify(mapped.rows)],
    )

    const report = gate.rows[0]?.result

    if (report?.blocked) {
      return {
        ok: false,
        code: 'contract_blocked',
        message: truncate(describeGateBlock(report), 500),
      }
    }
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

      const commit = await conn.query<{ result: z.core.util.JSONType }>(
        `SELECT api.commit_dataset_row_batch($1, $2, $3::jsonb, $4) result`,
        [
          datasetId,
          expectedRevision,
          JSON.stringify(chunk),
          `pipeline:${run.id}${slot ? `:o${slot}` : ''}:${Math.floor(offset / BATCH_SIZE)}`,
        ],
      )

      metrics.datasetCommitDuration.observe(
        { size_bucket: sizeBucketFor(chunk.length) },
        (Date.now() - commitStarted) / 1000,
      )
      const commitResult = commit.rows[0]?.result

      const decodedCommit = pipelineJsonObjectSchema.safeParse(commitResult)
      const ok = decodedCommit.success && decodedCommit.data.ok === true

      if (!ok) {
        const detail =
          decodedCommit.success || Array.isArray(commitResult)
            ? JSON.stringify(decodedCommit.data?.errors ?? commitResult)
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

  const { revision, rowCount: snapshotRowCount } =
    await loadDatasetSnapshotState(conn, datasetId)

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

/**
 * The Dataset this pipeline's earlier runs created for the same output (same
 * schema version and name), if it is still active. A lock on the definition
 * makes two runs that start together agree on one Dataset instead of each
 * creating its own. Changing the schema version or the name in a new version
 * deliberately starts a new Dataset.
 */
async function findOwnOutputDataset(
  conn: ExecConnection,
  run: RunRow,
  schemaVersionId: string,
  name: string,
): Promise<{ id: string } | null> {
  const { rows: definition } = await conn.query<{ definition_id: string }>(
    `SELECT definition_id FROM api.pipeline_definition_versions WHERE id = $1`,
    [run.definition_version_id],
  )

  const definitionId = definition[0]?.definition_id

  if (!definitionId) return null
  await conn.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `pipeline-output:${definitionId}`,
  ])

  const { rows } = await conn.query<{ id: string }>(
    `SELECT d.id
       FROM api.datasets d
      WHERE d.workspace_id = $1
        AND d.schema_version_id = $2
        AND d.name = $3
        AND d.lifecycle = 'active'
        AND EXISTS (
          SELECT 1
            FROM api.pipeline_run_outputs o
            JOIN api.pipeline_runs r ON r.id = o.run_id
            JOIN api.pipeline_definition_versions v
              ON v.id = r.definition_version_id
           WHERE o.dataset_id = d.id AND v.definition_id = $4
        )
      ORDER BY d.created_at
      LIMIT 1`,
    [run.workspace_id, schemaVersionId, name.trim(), definitionId],
  )

  return rows[0] ?? null
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

async function loadDatasetSnapshotState(
  conn: ExecConnection,
  datasetId: string,
) {
  const { rows } = await conn.query<{ revision: string | null; count: string }>(
    `SELECT (SELECT revision FROM api.datasets WHERE id = $1) AS revision,
            (SELECT count(*) FROM api.dataset_rows WHERE dataset_id = $1) AS count`,
    [datasetId],
  )

  return {
    revision: Number(rows[0]?.revision ?? 1),
    rowCount: Number(rows[0]?.count ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Output mapping + value coercion.
// ---------------------------------------------------------------------------

function mapOutputRows(
  output: PipelineOutput,
  fields: SchemaFieldRow[],
  resultRows: SqlResultRow[],
):
  | {
      kind: 'ok'
      rows: Array<{
        operation: 'create'
        rowId: string
        values: PipelineJsonObject
      }>
    }
  | { kind: 'error'; code: PipelineErrorCode; message: string } {
  const mapping = output.fieldMapping ?? {}
  const slugToField = new Map(fields.map((f) => [f.key, f]))

  const batches: Array<{
    operation: 'create'
    rowId: string
    values: PipelineJsonObject
  }> = []

  for (const source of resultRows) {
    const values: PipelineJsonObject = {}

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
  raw: SqlResultValue,
): string | number | boolean | typeof COERCE_ERROR {
  switch (logicalType) {
    case 'text':
      return z.coerce.string().parse(raw)
    case 'integer': {
      const integer = z.number().refine(Number.isInteger).safeParse(raw)

      if (integer.success) return integer.data

      const text = z.string().safeParse(raw)

      if (text.success && /^-?\d+$/.test(text.data.trim())) {
        const n = Number(text.data)

        if (Number.isSafeInteger(n)) return n
      }

      return COERCE_ERROR
    }

    case 'decimal': {
      const decimal = z.number().safeParse(raw)

      if (decimal.success) return decimal.data

      const text = z.string().safeParse(raw)

      if (
        text.success &&
        text.data.trim() !== '' &&
        Number.isFinite(Number(text.data))
      ) {
        return Number(text.data)
      }

      return COERCE_ERROR
    }

    case 'boolean': {
      const value = z.boolean().safeParse(raw)

      return value.success ? value.data : COERCE_ERROR
    }

    case 'date': {
      if (raw instanceof Date) return toDateString(raw)

      const text = z.string().safeParse(raw)

      if (text.success) {
        const date = new Date(text.data)

        if (!Number.isNaN(date.getTime())) return toDateString(date)
      }

      return COERCE_ERROR
    }

    case 'timestamp': {
      if (raw instanceof Date) return raw.toISOString()

      const text = z.string().safeParse(raw)

      if (text.success && !Number.isNaN(Date.parse(text.data))) {
        return new Date(text.data).toISOString()
      }

      return COERCE_ERROR
    }

    case 'category':
    case 'reference': {
      const text = z.coerce.string().parse(raw)

      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        text,
      )
        ? text
        : COERCE_ERROR
    }

    default:
      return z.coerce.string().parse(raw)
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
  result: RunCompletion,
): Promise<PipelineRunWire | null> {
  const { rows } = await conn.query<PipelineRunWire>(
    `SELECT * FROM api.complete_pipeline_run($1, $2, $3::jsonb)`,
    [run.workspace_id, run.id, JSON.stringify(result)],
  )

  return rows.at(0) ?? null
}

async function failRun(
  conn: ExecConnection,
  run: RunRow,
  code: PipelineErrorCode,
  message: string,
  detail: SqlResultRow = {},
): Promise<void> {
  await conn.query(
    `SELECT api.append_pipeline_run_log($1, $2, 'error', 'failure', $3, $4::jsonb)`,
    [
      run.workspace_id,
      run.id,
      truncate(message, 2000),
      JSON.stringify({ ...detail, code }),
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
/**
 * Fail a run that nothing can execute any more (its job was abandoned). Acts as
 * the run's own actor, like every other write the executor makes, and is a no-op
 * once the run has settled.
 */
export async function failStuckPipelineRun(
  deps: PipelineExecuteDeps,
  runId: string,
  code: string,
  message: string,
): Promise<void> {
  const conn = await deps.connect()

  try {
    await conn.begin()
    await failRunIfRunning(conn, runId, code, message)
    await conn.commit()
  } catch {
    await conn.rollback().catch(() => {})
  } finally {
    await conn.end().catch(() => {})
  }
}

async function failRunIfRunning(
  conn: ExecConnection,
  runId: string,
  code: string,
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

const trialStepDetailSchema = z.object({
  name: z.string().optional(),
  rowCount: z.number().optional(),
  columns: z.array(z.string()).optional(),
})

async function log(
  conn: ExecConnection,
  run: RunRow,
  level: 'info' | 'warning' | 'error',
  stage: string,
  message: string,
  detail: SqlResultRow = {},
): Promise<void> {
  if (run.trial) {
    const entry: TrialLogEntry = {
      level,
      stage,
      message: truncate(message, 2000),
    }

    if (stage === 'step') {
      const facts = trialStepDetailSchema.safeParse(detail)

      entry.detail = facts.success ? facts.data : {}
    }

    run.trial.push(entry)

    return
  }

  if (run.pendingLogs) {
    run.pendingLogs.push({ level, stage, message, detail })

    return
  }

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
