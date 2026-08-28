/**
 * PLAT-02 — connector run observability contract. `executeConnectorRun`
 * invokes the injected server observability hooks with the bounded connector
 * type, bounded error code and duration, and reports failure even when the
 * fail RPC itself dies. Client-executed runs (no observability) still work.
 */
import { describe, expect, it } from 'vitest'

import { ConnectorStepError, executeConnectorRun } from './run'
import type { ConnectorRunObservability } from './run'
import type { DataClient } from '#/lib/data-client'
import type { ConnectorRunWire } from './types'

function wire(overrides: Partial<ConnectorRunWire>): ConnectorRunWire {
  return {
    id: 'run-1',
    workspace_id: 'ws',
    connector_id: 'conn',
    trigger_kind: 'manual',
    status: 'running',
    attempt: 1,
    retry_of_run_id: null,
    request_digest: null,
    result: {},
    error_code: null,
    error_message: null,
    started_at: new Date().toISOString(),
    finished_at: null,
    ...overrides,
  }
}

function fakeClient(
  startResult: ConnectorRunWire,
  failShouldSucceed = true,
): DataClient {
  return {
    rpc: async (name: string) => {
      if (name === 'start_connector_run') return startResult
      if (name === 'complete_connector_run')
        return { ...startResult, status: 'succeeded', finished_at: 'x' }
      if (name === 'fail_connector_run') {
        if (!failShouldSucceed) throw new Error('rpc down')
        return { ...startResult, status: 'failed', finished_at: 'x' }
      }
      if (name === 'append_connector_run_log') return { id: 'log' }
      throw new Error(`unexpected rpc ${name}`)
    },
  } as unknown as DataClient
}

function recordingObservability(): ConnectorRunObservability & {
  events: { event: string; connectorType: string; errorCode?: string }[]
} {
  const events: { event: string; connectorType: string; errorCode?: string }[] =
    []
  return {
    events,
    onStarted: (_run, connectorType) =>
      events.push({ event: 'started', connectorType }),
    onSucceeded: (_run, connectorType) =>
      events.push({ event: 'succeeded', connectorType }),
    onFailed: (_run, connectorType, errorCode) =>
      events.push({ event: 'failed', connectorType, errorCode }),
    onStaleReconciled: (_run, connectorType) =>
      events.push({ event: 'stale_reconciled', connectorType }),
  }
}

describe('executeConnectorRun observability', () => {
  it('emits started and succeeded with the bounded connector type', async () => {
    const obs = recordingObservability()
    const report = await executeConnectorRun(
      fakeClient(wire({})),
      {
        workspaceId: 'ws',
        connectorId: 'conn',
        connectorType: 'instrument',
        observability: obs,
      },
      async () => 'value',
    )
    expect(report.status).toBe('succeeded')
    expect(obs.events.map((e) => e.event)).toEqual(['started', 'succeeded'])
    expect(obs.events.every((e) => e.connectorType === 'instrument')).toBe(true)
  })

  it('emits failure with the raw error code (bounding happens server-side)', async () => {
    const obs = recordingObservability()
    const report = await executeConnectorRun(
      fakeClient(wire({})),
      {
        workspaceId: 'ws',
        connectorId: 'conn',
        connectorType: 'storage',
        observability: obs,
      },
      async () => {
        throw new ConnectorStepError('download_failed', 'source read broke')
      },
    )
    expect(report.status).toBe('failed')
    expect(report.errorCode).toBe('download_failed')
    expect(obs.events).toContainEqual({
      event: 'failed',
      connectorType: 'storage',
      errorCode: 'download_failed',
    })
  })

  it('still reports failure when the fail RPC itself dies (run stays running server-side)', async () => {
    const obs = recordingObservability()
    const report = await executeConnectorRun(
      fakeClient(wire({}), false),
      {
        workspaceId: 'ws',
        connectorId: 'conn',
        connectorType: 'custom',
        observability: obs,
      },
      async () => {
        throw new Error('boom')
      },
    )
    expect(report.status).toBe('failed')
    expect(report.errorCode).toBe('unexpected_error')
    // The dead-RPC path must not claim a server-acknowledged failure.
    expect(obs.events.some((e) => e.event === 'failed')).toBe(false)
  })

  it('detects automatic stale reconciliation from lineage (no explicit retry)', async () => {
    const obs = recordingObservability()
    // The RPC linked the returned run to a reconciled predecessor.
    await executeConnectorRun(
      fakeClient(wire({ attempt: 2, retry_of_run_id: 'stale-run-id' })),
      {
        workspaceId: 'ws',
        connectorId: 'conn',
        connectorType: 'instrument',
        observability: obs,
      },
      async () => {
        throw new ConnectorStepError('query_failed', 'x')
      },
    )
    expect(obs.events.some((e) => e.event === 'stale_reconciled')).toBe(true)
  })

  it('does not flag explicit retries as stale reconciliations', async () => {
    const obs = recordingObservability()
    await executeConnectorRun(
      fakeClient(wire({ attempt: 2, retry_of_run_id: 'prior-run' })),
      {
        workspaceId: 'ws',
        connectorId: 'conn',
        connectorType: 'instrument',
        retryOfRunId: 'prior-run',
        observability: obs,
      },
      async () => 'value',
    )
    expect(obs.events.some((e) => e.event === 'stale_reconciled')).toBe(false)
  })

  it('works without observability (client-executed runs)', async () => {
    const report = await executeConnectorRun(
      fakeClient(wire({})),
      { workspaceId: 'ws', connectorId: 'conn' },
      async () => 'value',
    )
    expect(report.status).toBe('succeeded')
  })
})
