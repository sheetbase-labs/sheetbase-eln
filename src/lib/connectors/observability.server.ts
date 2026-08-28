/**
 * PLAT-02 — server-side connector run observability. Injected into
 * `executeConnectorRun` by the server execution path (enterprise S3 /
 * PostgreSQL imports), so connector runs surface in the process metrics and
 * structured logs with their durable run id.
 *
 * Metric labels are bounded (see src/lib/metrics.ts): connector type and a
 * bounded error code — never run ids, workspace ids or payloads. Structured
 * logs carry `connector_run_id` so a failure in the product run history
 * correlates to its log line without reproducing it.
 */
import { boundedConnectorErrorCode, metrics } from '#/lib/metrics'
import type { ConnectorType } from '#/lib/metrics'
import { logger } from '#/lib/logger'
import type { ConnectorRunObservability } from './run'
import type { ConnectorRunWire } from './types'

export const serverConnectorRunObservability: ConnectorRunObservability = {
  onStarted(_run: ConnectorRunWire, connectorType: ConnectorType): void {
    metrics.connectorRuns.inc({
      connector_type: connectorType,
      outcome: 'started',
    })
  },

  onSucceeded(
    run: ConnectorRunWire,
    connectorType: ConnectorType,
    durationMs: number,
  ): void {
    metrics.connectorRuns.inc({
      connector_type: connectorType,
      outcome: 'succeeded',
    })
    metrics.connectorRunDuration.observe(
      { connector_type: connectorType, outcome: 'succeeded' },
      durationMs / 1000,
    )
    logger.info('connector run succeeded', {
      connector_run_id: run.id,
      connector_type: connectorType,
      attempt: run.attempt,
      duration_ms: durationMs,
    })
  },

  onFailed(
    run: ConnectorRunWire,
    connectorType: ConnectorType,
    errorCode: string,
    durationMs: number,
  ): void {
    const boundedCode = boundedConnectorErrorCode(errorCode)
    metrics.connectorRuns.inc({
      connector_type: connectorType,
      outcome: 'failed',
    })
    metrics.connectorRunFailures.inc({
      connector_type: connectorType,
      error_code: boundedCode,
    })
    if (durationMs > 0) {
      metrics.connectorRunDuration.observe(
        { connector_type: connectorType, outcome: 'failed' },
        durationMs / 1000,
      )
    }
    logger.error('connector run failed', {
      connector_run_id: run.id,
      connector_type: connectorType,
      attempt: run.attempt,
      error_code: boundedCode,
      duration_ms: durationMs,
    })
  },

  onStaleReconciled(run: ConnectorRunWire, connectorType: ConnectorType): void {
    metrics.connectorRuns.inc({
      connector_type: connectorType,
      outcome: 'stale_reconciled',
    })
    logger.warn('stale connector run reconciled', {
      connector_run_id: run.id,
      retry_of_run_id: run.retry_of_run_id,
      connector_type: connectorType,
    })
  },
}
