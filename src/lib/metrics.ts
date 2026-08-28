/**
 * PLAT-02 — application metrics. A small, coherent in-process registry that
 * renders the Prometheus text exposition format (version 0.0.4). No
 * dependencies; aggregation is per-process, which is correct for the single
 * app container deployment topology (per-instance metrics; aggregation and
 * history belong to the scraper, not the app).
 *
 * Cardinality policy: labels are bounded by construction. Every metric
 * declares the allowed values for its bounded labels; an unknown value is
 * folded to 'other' rather than creating a new time series. Request IDs, run
 * IDs, user IDs, workspace IDs, dataset IDs, filenames and scientific values
 * are never label values — they live in logs, correlated by request/run id.
 *
 * Operational surfaces that instrument themselves:
 *   - HTTP (db proxy + file byte routes): requests, status, duration
 *   - DB/PostgREST upstream: latency, public error categories
 *   - Connector runs: started/succeeded/failed, duration, connector type,
 *     bounded error codes
 *   - File operations: uploads/downloads, failures, bytes transferred
 */

export type MetricsEnvironment =
  'development' | 'test' | 'staging' | 'production'

/** HTTP route buckets. Never derived from request paths. */
export const HTTP_ROUTES = [
  'db_proxy',
  'files_upload',
  'files_download',
  'files_upload_authorize',
  'health',
  'metrics',
] as const

export type HttpRoute = (typeof HTTP_ROUTES)[number]

/** Bounded connector error codes; anything else folds to 'other'. */
export const CONNECTOR_ERROR_CODES = [
  'unexpected_error',
  'parse_failed',
  'mapping_failed',
  'validation_failed',
  'commit_failed',
  'connection_failed',
  'authentication_failed',
  'source_not_found',
  'download_failed',
  'query_failed',
  'row_limit_exceeded',
  'stale_run_reconciled',
] as const

export const CONNECTOR_TYPES = [
  'instrument',
  'storage',
  'webhook',
  'database',
  'custom',
] as const

export type ConnectorType = (typeof CONNECTOR_TYPES)[number]

export const FILE_OPERATIONS = ['upload', 'download'] as const
export type FileOperation = (typeof FILE_OPERATIONS)[number]

export const FILE_OUTCOMES = [
  'ok',
  'oversize',
  'checksum_mismatch',
  'conflict',
  'not_found',
  'not_uploadable',
  'missing',
  'error',
] as const
export type FileOutcome = (typeof FILE_OUTCOMES)[number]

interface Labels {
  [key: string]: string
}

function foldBounded(allowed: readonly string[], value: string): string {
  return allowed.includes(value) ? value : 'other'
}

function labelKey(names: readonly string[], values: Labels): string | null {
  if (names.length === 0) return ''
  const parts: string[] = []
  for (const name of names) {
    const value: string | undefined = (
      values as Record<string, string | undefined>
    )[name]
    if (value === undefined) return null
    parts.push(`${name}="${escapeLabel(value)}"`)
  }
  return parts.join(',')
}

/**
 * Looks up a bounded-label declaration. The hasOwn guard gives a genuine
 * `readonly string[] | undefined` (a bare index read is typed non-optional
 * and trips the unnecessary-condition rule).
 */
function bounderFor(
  bounders: Record<string, readonly string[]>,
  name: string,
): readonly string[] | undefined {
  return Object.hasOwn(bounders, name) ? bounders[name] : undefined
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

export class Counter {
  readonly values = new Map<string, number>()
  readonly labelNames: readonly string[]

  constructor(
    readonly name: string,
    readonly help: string,
    labelNames: readonly string[] = [],
    private readonly bounders: Record<string, readonly string[]> = {},
  ) {
    this.labelNames = labelNames
  }

  /** Increments the counter; unknown bounded label values fold to 'other'. */
  inc(values: Labels = {}, by = 1): void {
    const bounded: Labels = {}
    for (const name of this.labelNames) {
      const raw: string | undefined = (
        values as Record<string, string | undefined>
      )[name]
      const allowed = bounderFor(this.bounders, name)
      bounded[name] =
        raw === undefined ? 'other' : allowed ? foldBounded(allowed, raw) : raw
    }
    const key = labelKey(this.labelNames, bounded) ?? ''
    this.values.set(key, (this.values.get(key) ?? 0) + by)
  }

  render(): string {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ]
    if (this.values.size === 0) {
      // Prometheus requires at least a series or nothing; emit the zero
      // series for the unlabelled case so the metric always exists.
      if (this.labelNames.length === 0) lines.push(`${this.name} 0`)
    } else {
      for (const [key, value] of this.values) {
        lines.push(`${this.name}${key ? `{${key}}` : ''} ${value}`)
      }
    }
    return lines.join('\n')
  }
}

const DEFAULT_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
]

export class Histogram {
  readonly series = new Map<
    string,
    { buckets: number[]; sum: number; count: number }
  >()
  readonly labelNames: readonly string[]

  constructor(
    readonly name: string,
    readonly help: string,
    labelNames: readonly string[] = [],
    private readonly bounders: Record<string, readonly string[]> = {},
    readonly buckets: readonly number[] = DEFAULT_BUCKETS,
  ) {
    this.labelNames = labelNames
  }

  /** Observes one value in seconds; unknown bounded label values fold. */
  observe(values: Labels, seconds: number): void {
    const bounded: Labels = {}
    for (const name of this.labelNames) {
      const raw: string | undefined = (
        values as Record<string, string | undefined>
      )[name]
      const allowed = bounderFor(this.bounders, name)
      bounded[name] =
        raw === undefined ? 'other' : allowed ? foldBounded(allowed, raw) : raw
    }
    const key = labelKey(this.labelNames, bounded) ?? ''
    let series = this.series.get(key)
    if (!series) {
      series = {
        buckets: new Array(this.buckets.length).fill(0),
        sum: 0,
        count: 0,
      }
      this.series.set(key, series)
    }
    for (let i = 0; i < this.buckets.length; i += 1) {
      if (seconds <= this.buckets[i]) series.buckets[i] += 1
    }
    series.sum += seconds
    series.count += 1
  }

  render(): string {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ]
    for (const [key, series] of this.series) {
      for (let i = 0; i < this.buckets.length; i += 1) {
        const labels = key
          ? `${key},le="${this.buckets[i]}"`
          : `le="${this.buckets[i]}"`
        lines.push(`${this.name}{${labels}} ${series.buckets[i]}`)
      }
      const infLabels = key ? `${key},le="+Inf"` : 'le="+Inf"'
      lines.push(`${this.name}{${infLabels}} ${series.count}`)
      lines.push(`${this.name}_sum${key ? `{${key}}` : ''} ${series.sum}`)
      lines.push(`${this.name}_count${key ? `{${key}}` : ''} ${series.count}`)
    }
    return lines.join('\n')
  }
}

/**
 * The application registry. One instance per process; tests may build their
 * own via `createMetricsRegistry()` for isolation.
 */
export function createMetricsRegistry() {
  const httpRequests = new Counter(
    'sheetbase_http_requests_total',
    'HTTP requests handled by the application server.',
    ['route', 'method', 'status'],
    { route: HTTP_ROUTES },
  )
  const httpDuration = new Histogram(
    'sheetbase_http_request_duration_seconds',
    'HTTP request duration by route and method.',
    ['route', 'method'],
    { route: HTTP_ROUTES },
  )
  const dbUpstreamRequests = new Counter(
    'sheetbase_db_upstream_requests_total',
    'PostgREST upstream responses by public error category.',
    ['category'],
    {
      category: [
        'ok',
        'validation_error',
        'unauthenticated',
        'permission_denied',
        'not_found',
        'conflict',
        'rate_limited',
        'service_unavailable',
        'server_error',
      ],
    },
  )
  const dbUpstreamDuration = new Histogram(
    'sheetbase_db_upstream_duration_seconds',
    'PostgREST upstream duration by HTTP method.',
    ['method'],
  )
  const connectorRuns = new Counter(
    'sheetbase_connector_runs_total',
    'Connector run outcomes by connector type.',
    ['connector_type', 'outcome'],
    {
      connector_type: CONNECTOR_TYPES,
      outcome: ['started', 'succeeded', 'failed', 'stale_reconciled'],
    },
  )
  const connectorRunFailures = new Counter(
    'sheetbase_connector_run_failures_total',
    'Connector run failures by bounded error code.',
    ['connector_type', 'error_code'],
    { connector_type: CONNECTOR_TYPES, error_code: CONNECTOR_ERROR_CODES },
  )
  const connectorRunDuration = new Histogram(
    'sheetbase_connector_run_duration_seconds',
    'Connector run duration by connector type and outcome.',
    ['connector_type', 'outcome'],
    { connector_type: CONNECTOR_TYPES, outcome: ['succeeded', 'failed'] },
    [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60, 300],
  )
  const fileOperations = new Counter(
    'sheetbase_file_operations_total',
    'File upload/download outcomes.',
    ['operation', 'outcome'],
    { operation: FILE_OPERATIONS, outcome: FILE_OUTCOMES },
  )
  const fileBytes = new Counter(
    'sheetbase_file_bytes_total',
    'Bytes transferred through file byte routes.',
    ['operation'],
    { operation: FILE_OPERATIONS },
  )
  const fileDuration = new Histogram(
    'sheetbase_file_operation_duration_seconds',
    'File operation duration.',
    ['operation'],
    { operation: FILE_OPERATIONS },
  )

  const metrics = [
    httpRequests,
    dbUpstreamRequests,
    connectorRuns,
    connectorRunFailures,
    fileOperations,
    fileBytes,
  ]
  const histograms = [
    httpDuration,
    dbUpstreamDuration,
    connectorRunDuration,
    fileDuration,
  ]

  return {
    httpRequests,
    httpDuration,
    dbUpstreamRequests,
    dbUpstreamDuration,
    connectorRuns,
    connectorRunFailures,
    connectorRunDuration,
    fileOperations,
    fileBytes,
    fileDuration,
    /** Renders the Prometheus text exposition format. */
    render(): string {
      const all = [...metrics, ...histograms]
      return all.map((m) => m.render()).join('\n\n') + '\n'
    },
  }
}

export type MetricsRegistry = ReturnType<typeof createMetricsRegistry>

/** Process-wide registry used by instrumented surfaces. */
export const metrics: MetricsRegistry = createMetricsRegistry()

/** Folds an arbitrary connector error code onto the bounded label set. */
export function boundedConnectorErrorCode(
  code: string | null | undefined,
): string {
  if (!code) return 'unexpected_error'
  return foldBounded(CONNECTOR_ERROR_CODES, code)
}
