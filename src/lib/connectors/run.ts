/**
 * INT-01 — connector run executor.
 *
 * Wraps a unit of integration work in the one governed execution model:
 * start (with trigger + digest) → stage logs → complete with a result payload
 * or fail with a bounded error code. The callback decides *what* happens; this
 * module guarantees *how it is recorded*, including the failure path.
 *
 * Retries are a new run attempt linked via `retryOfRunId`; successful work is
 * deduplicated upstream by the connector run's request digest.
 */
import type { DataClient } from '../data-client'
import type { ConnectorRunWire } from './types'
import {
  appendConnectorRunLog,
  completeConnectorRun,
  failConnectorRun,
  startConnectorRun,
} from './client'

export interface ConnectorRunReport<T> {
  status: 'succeeded' | 'failed'
  run: ConnectorRunWire | null
  value?: T
  errorCode?: string
  errorMessage?: string
  /** True when the server resolved the digest to an existing finished run. */
  alreadyCompleted?: boolean
}

/**
 * Provenance payload attached to the finished run. Return the durable facts a
 * reader needs to trace what the execution produced.
 */
export type RunResultBuilder<T> = (value: T) => Record<string, unknown>

export interface ExecuteConnectorRunOptions<T> {
  workspaceId: string
  connectorId: string
  triggerKind?: 'manual' | 'scheduled' | 'event'
  requestDigest?: string | null
  retryOfRunId?: string | null
  /**
   * INT-03 provisional logical source identity — passed instead of (not in
   * addition to) a known request digest when the content identity can only
   * be established by source work that must happen inside the run.
   */
  selectorDigest?: string | null
  /** Logs an info line right after the run starts. */
  startedMessage?: string
  /** Builds the result jsonb recorded on successful completion. */
  buildResult?: RunResultBuilder<T>
}

export class ConnectorStepError extends Error {
  readonly code: string
  readonly detail: Record<string, unknown>

  constructor(
    code: string,
    message: string,
    detail: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ConnectorStepError'
    this.code = code
    this.detail = detail
  }
}

/**
 * Run `work` inside the framework. Any thrown error — `ConnectorStepError` for
 * expected failure codes or anything unexpected — fails the run on the server
 * before being rethrown as a report instead of crashing the caller.
 */
export async function executeConnectorRun<T>(
  client: DataClient,
  options: ExecuteConnectorRunOptions<T>,
  work: (context: {
    run: ConnectorRunWire
    log: (
      stage: string,
      message: string,
      detail?: Record<string, unknown>,
      level?: 'info' | 'warning' | 'error',
    ) => Promise<void>
  }) => Promise<T>,
): Promise<ConnectorRunReport<T>> {
  let run: ConnectorRunWire | null = null
  try {
    run = await startConnectorRun(client, {
      ...options,
      selectorDigest: options.selectorDigest ?? null,
    })
    if (run.status !== 'running') {
      // Digest deduplication returned an already-finished run.
      return {
        status: run.status === 'succeeded' ? 'succeeded' : 'failed',
        run,
        alreadyCompleted: true,
        errorCode: run.error_code ?? undefined,
        errorMessage: run.error_message ?? undefined,
      }
    }
    if (options.startedMessage) {
      await appendConnectorRunLog(client, {
        workspaceId: options.workspaceId,
        runId: run.id,
        stage: 'start',
        message: options.startedMessage,
        detail: { attempt: run.attempt },
      })
    }
    const log = async (
      stage: string,
      message: string,
      detail: Record<string, unknown> = {},
      level: 'info' | 'warning' | 'error' = 'info',
    ) => {
      await appendConnectorRunLog(client, {
        workspaceId: options.workspaceId,
        runId: run!.id,
        level,
        stage,
        message,
        detail,
      })
    }
    const value = await work({ run, log })
    const finished = await completeConnectorRun(client, {
      workspaceId: options.workspaceId,
      runId: run.id,
      result: options.buildResult?.(value) ?? {},
    })
    run = finished
    return { status: 'succeeded', run, value }
  } catch (error) {
    const step = error instanceof ConnectorStepError ? error : null
    const errorCode = step?.code ?? 'unexpected_error'
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (run && run.status === 'running') {
      try {
        await failConnectorRun(client, {
          workspaceId: options.workspaceId,
          runId: run.id,
          errorCode,
          errorMessage,
        })
      } catch {
        // The run stays 'running' server-side; a manual retry will reconcile.
      }
    }
    return { status: 'failed', run, errorCode, errorMessage }
  }
}
