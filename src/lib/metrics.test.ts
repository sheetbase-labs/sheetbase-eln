import { describe, expect, it } from 'vitest'

import {
  Gauge,
  boundedConnectorErrorCode,
  createMetricsRegistry,
  sizeBucketFor,
} from './metrics'

describe('counter', () => {
  it('aggregates by label values and renders Prometheus text', () => {
    const registry = createMetricsRegistry()
    registry.httpRequests.inc({
      route: 'db_proxy',
      method: 'GET',
      status: '200',
    })
    registry.httpRequests.inc({
      route: 'db_proxy',
      method: 'GET',
      status: '200',
    })
    registry.httpRequests.inc({
      route: 'db_proxy',
      method: 'POST',
      status: '500',
    })

    const rendered = registry.render()
    expect(rendered).toContain(
      'sheetbase_http_requests_total{route="db_proxy",method="GET",status="200"} 2',
    )
    expect(rendered).toContain(
      'sheetbase_http_requests_total{route="db_proxy",method="POST",status="500"} 1',
    )
    expect(rendered).toContain('# TYPE sheetbase_http_requests_total counter')
  })

  it('folds unknown bounded label values to other (cardinality guard)', () => {
    const registry = createMetricsRegistry()
    registry.connectorRuns.inc({
      connector_type: 'instrument',
      outcome: 'started',
    })
    registry.connectorRuns.inc({
      connector_type: 'bogus-type',
      outcome: 'bogus-outcome',
    })

    const rendered = registry.render()
    expect(rendered).toContain(
      'sheetbase_connector_runs_total{connector_type="instrument",outcome="started"} 1',
    )
    expect(rendered).toContain(
      'sheetbase_connector_runs_total{connector_type="other",outcome="other"} 1',
    )
    // No unbounded series was created for the raw values.
    expect(rendered).not.toContain('bogus-type')
  })

  it('declares unobserved counters by type and emits series on first use', () => {
    const registry = createMetricsRegistry()
    const rendered = registry.render()
    expect(rendered).toContain('# TYPE sheetbase_file_bytes_total counter')
    expect(rendered).not.toContain(
      'sheetbase_file_bytes_total{operation="upload"}',
    )

    registry.fileBytes.inc({ operation: 'upload' }, 128)
    expect(registry.render()).toContain(
      'sheetbase_file_bytes_total{operation="upload"} 128',
    )
  })
})

describe('histogram', () => {
  it('records buckets, sum and count', () => {
    const registry = createMetricsRegistry()
    registry.httpDuration.observe({ route: 'health', method: 'GET' }, 0.02)
    registry.httpDuration.observe({ route: 'health', method: 'GET' }, 0.3)

    const rendered = registry.render()
    expect(rendered).toContain(
      'sheetbase_http_request_duration_seconds{route="health",method="GET",le="0.05"} 1',
    )
    expect(rendered).toContain(
      'sheetbase_http_request_duration_seconds{route="health",method="GET",le="0.5"} 2',
    )
    expect(rendered).toContain(
      'sheetbase_http_request_duration_seconds_sum{route="health",method="GET"} 0.32',
    )
    expect(rendered).toContain(
      'sheetbase_http_request_duration_seconds_count{route="health",method="GET"} 2',
    )
  })

  it('keeps label sets bounded for histogram dimensions', () => {
    const registry = createMetricsRegistry()
    registry.connectorRunDuration.observe(
      { connector_type: 'instrument', outcome: 'failed' },
      0.5,
    )
    registry.connectorRunDuration.observe(
      { connector_type: 'sheet_xyz_never_cardinality', outcome: 'failed' },
      0.5,
    )
    const rendered = registry.render()
    expect(rendered).not.toContain('sheet_xyz_never_cardinality')
    expect(rendered).toContain('connector_type="other"')
  })
})

describe('method label bounding', () => {
  it('folds unknown HTTP methods to other in counters and histograms', () => {
    const registry = createMetricsRegistry()
    registry.httpRequests.inc({
      route: 'db_proxy',
      method: 'TRACE',
      status: '200',
    })
    registry.dbUpstreamDuration.observe({ method: 'PROPFIND' }, 0.1)

    const rendered = registry.render()
    expect(rendered).not.toContain('"TRACE"')
    expect(rendered).not.toContain('"PROPFIND"')
    expect(rendered).toContain(
      'sheetbase_http_requests_total{route="db_proxy",method="other",status="200"} 1',
    )
    expect(rendered).toContain(
      'sheetbase_db_upstream_duration_seconds_count{method="other"} 1',
    )
  })

  it('keeps canonical methods verbatim', () => {
    const registry = createMetricsRegistry()
    registry.httpRequests.inc({
      route: 'health',
      method: 'GET',
      status: '200',
    })
    expect(registry.render()).toContain(
      'sheetbase_http_requests_total{route="health",method="GET",status="200"} 1',
    )
  })
})

describe('boundedConnectorErrorCode', () => {
  it('maps known codes through and unknown codes to other', () => {
    expect(boundedConnectorErrorCode('parse_failed')).toBe('parse_failed')
    expect(boundedConnectorErrorCode('stale_run_reconciled')).toBe(
      'stale_run_reconciled',
    )
    expect(boundedConnectorErrorCode('some_arbitrary_internal_code')).toBe(
      'other',
    )
    expect(boundedConnectorErrorCode(null)).toBe('unexpected_error')
  })
})

describe('gauge', () => {
  it('sets, increments, decrements and renders the current value', () => {
    const gauge = new Gauge('sheetbase_pipeline_active_runs', 'active runs')
    gauge.inc()
    gauge.inc()
    gauge.dec()
    expect(gauge.render()).toContain('sheetbase_pipeline_active_runs 1')
  })
})

describe('sizeBucketFor', () => {
  it('maps row counts onto the bounded size vocabulary', () => {
    expect(sizeBucketFor(0)).toBe('small')
    expect(sizeBucketFor(999)).toBe('small')
    expect(sizeBucketFor(1_000)).toBe('medium')
    expect(sizeBucketFor(9_999)).toBe('medium')
    expect(sizeBucketFor(10_000)).toBe('large')
    expect(sizeBucketFor(49_999)).toBe('large')
    expect(sizeBucketFor(50_000)).toBe('xlarge')
  })
})

describe('PLAT-05 registry', () => {
  it('exposes the dataset, pipeline, scheduler and search metrics', () => {
    const registry = createMetricsRegistry()
    for (const metric of [
      registry.datasetRpcDuration,
      registry.datasetCommitDuration,
      registry.datasetSnapshotDuration,
      registry.pipelineStageDuration,
      registry.pipelineRuns,
      registry.pipelineActiveRuns,
      registry.schedulerSweepDuration,
      registry.schedulerDueOccurrences,
      registry.schedulerRecoveredOccurrences,
      registry.schedulerEventsProcessed,
      registry.searchDuration,
    ]) {
      expect(metric).toBeDefined()
    }
    const rendered = registry.render()
    expect(rendered).toContain(
      '# TYPE sheetbase_pipeline_stage_duration_seconds histogram',
    )
    expect(rendered).toContain('# TYPE sheetbase_pipeline_active_runs gauge')
    expect(rendered).toContain(
      '# TYPE sheetbase_scheduler_sweep_duration_seconds histogram',
    )
  })
})
