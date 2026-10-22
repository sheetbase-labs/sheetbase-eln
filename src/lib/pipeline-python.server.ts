/** Server-only client for the isolated Python runner; never execute code in Node. */
import {
  EXECUTION_TIMEOUT_SECONDS,
  INPUT_FIELD_LIMIT,
  INPUT_ROW_LIMIT,
  PAYLOAD_BYTE_LIMIT,
  RESULT_CELL_LIMIT,
  formatByteSize,
} from './pipeline-limits'
import type { PythonContract, PythonEnvironment } from './pipelines/python'

export type { PythonEnvironment }

export interface PythonTransformInput {
  statement: string
  /**
   * PIPE-04.1: where the runner keeps the files this step returns. Omitted, the step
   * returns no files — the runner only collects a declared output directory when it is
   * told which run the files belong to.
   */
  artefactKey?: string
  runtime?: string
  /** Pinned `name==version` packages the runtime must provide; nothing is installed. */
  requirements?: string[]
  /** The columns the step reads and the DataFrame it must return. */
  contract?: PythonContract
  inputs: Record<string, Record<string, unknown>[]>
  parameters: Record<string, unknown>
}

/** One file a Python step produced, as the runner reports it. */
export interface PythonArtefact {
  name: string
  size: number
}

export interface PythonTransformResult {
  rows: Record<string, unknown>[]
  logs: string[]
  /** Immutable image identity returned by the trusted runner, for run provenance. */
  runtime: string
  /** What the declared requirements resolved to inside that image. */
  environment?: PythonEnvironment
  /**
   * PIPE-04.1: files the step wrote to the declared output directory, with their sizes.
   * The bytes stay with the runner; a run records what was produced and where.
   */
  files?: PythonArtefact[]
  /**
   * Measured payload usage of the step: the serialized request size, the
   * response size, and the result row/cell counts. Always present from the real
   * client; optional so an alternate `executePython` implementation that does
   * not measure can be injected in tests. See PIPE-04.3.
   */
  usage?: PythonTransformUsage
}

/** Measured payload usage of one Python step (bytes and result shape). */
export interface PythonTransformUsage {
  /** Bytes of the JSON request body (pipeline inputs, parameters and code). */
  inputBytes: number
  /** Bytes of the JSON result body returned by the runner. */
  outputBytes: number
  /** Rows returned by the step. */
  rows: number
  /** Cells (field values across all rows) returned by the step. */
  cells: number
}

export class PipelinePythonError extends Error {
  /** What the step printed before it failed. */
  readonly logs: string[]
  /** The line of the step's code the failure came from. */
  readonly line?: number
  constructor(
    message: string,
    readonly code:
      | 'runner_unavailable'
      | 'transform_failed'
      | 'transform_timed_out'
      | 'input_too_large'
      | 'output_too_large' = 'transform_failed',
    detail: { logs?: string[]; line?: number } = {},
  ) {
    super(message)
    this.name = 'PipelinePythonError'
    this.logs = detail.logs ?? []
    this.line = detail.line
  }
}

const MAX_LOG_BYTES = 64 * 1024
const DIGEST_IMAGE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Validate row shape and count rows/cells, naming the measured number in any
 * limit failure so a rejected step reports what was hit, not just that a limit
 * exists.
 */
function measureRows(
  rows: unknown,
  side: 'input' | 'result',
): { rows: number; cells: number } {
  const label = side === 'input' ? 'Python input' : 'Python result'
  const code = side === 'input' ? 'input_too_large' : 'output_too_large'
  if (!Array.isArray(rows))
    throw new PipelinePythonError(
      `${label} must be a list of row objects.`,
      code,
    )
  if (rows.length > INPUT_ROW_LIMIT)
    throw new PipelinePythonError(
      `${label} has ${rows.length} rows, over the ${INPUT_ROW_LIMIT} row limit.`,
      code,
    )
  let cells = 0
  for (const row of rows) {
    if (!isObject(row))
      throw new PipelinePythonError(`${label} must contain row objects.`, code)
    const fields = Object.keys(row).length
    cells += fields
    if (fields > INPUT_FIELD_LIMIT)
      throw new PipelinePythonError(
        `${label} has a row with ${fields} fields, over the ${INPUT_FIELD_LIMIT} field limit.`,
        code,
      )
    if (cells > RESULT_CELL_LIMIT)
      throw new PipelinePythonError(
        `${label} has ${cells} cells, over the ${RESULT_CELL_LIMIT} cell limit.`,
        code,
      )
  }
  return { rows: rows.length, cells }
}

function serialize(input: PythonTransformInput): string {
  if (
    !input.statement.trim() ||
    input.statement.length > 128_000 ||
    !isObject(input.inputs) ||
    !isObject(input.parameters)
  )
    throw new PipelinePythonError(
      'Provide Python code, named input rows and parameters.',
    )
  let rows = 0
  let cells = 0
  for (const values of Object.values(input.inputs)) {
    const measured = measureRows(values, 'input')
    cells += measured.cells
    rows += measured.rows
  }
  if (rows > INPUT_ROW_LIMIT || cells > RESULT_CELL_LIMIT)
    throw new PipelinePythonError(
      `Python input has ${rows} rows and ${cells} cells, over the ${INPUT_ROW_LIMIT} row or ${RESULT_CELL_LIMIT} cell limit.`,
      'input_too_large',
    )
  let body: string
  try {
    body = JSON.stringify(input, (_key, value: unknown) => {
      if (
        (typeof value === 'number' && !Number.isFinite(value)) ||
        value === undefined ||
        typeof value === 'bigint' ||
        typeof value === 'function' ||
        typeof value === 'symbol'
      )
        throw new Error('non-JSON value')
      return value
    })
  } catch {
    throw new PipelinePythonError(
      'Python inputs and parameters must contain finite JSON values.',
    )
  }
  const bytes = Buffer.byteLength(body)
  if (bytes > PAYLOAD_BYTE_LIMIT)
    throw new PipelinePythonError(
      `Python input is ${formatByteSize(bytes)}, over the ${formatByteSize(PAYLOAD_BYTE_LIMIT)} limit.`,
      'input_too_large',
    )
  return body
}

/** The logs and line a failed step reported, kept only in the expected shape and size. */
function failureDetail(result: unknown): { logs?: string[]; line?: number } {
  if (!isObject(result)) return {}
  const detail: { logs?: string[]; line?: number } = {}
  if (
    Array.isArray(result.logs) &&
    result.logs.every((line): line is string => typeof line === 'string') &&
    Buffer.byteLength(result.logs.join('\n')) <= MAX_LOG_BYTES
  )
    detail.logs = result.logs
  if (
    typeof result.line === 'number' &&
    Number.isInteger(result.line) &&
    result.line > 0
  )
    detail.line = result.line
  return detail
}

function readEnvironment(value: unknown): PythonEnvironment | undefined {
  if (
    !isObject(value) ||
    typeof value.python !== 'string' ||
    !isObject(value.packages)
  )
    return undefined
  const packages: Record<string, string> = {}
  for (const [name, version] of Object.entries(value.packages)) {
    if (typeof version !== 'string') return undefined
    packages[name] = version
  }
  return { python: value.python, packages }
}

async function boundedJson(
  response: Response,
): Promise<{ value: unknown; bytes: number }> {
  const declared = Number(response.headers.get('content-length'))
  if (declared > PAYLOAD_BYTE_LIMIT)
    throw new PipelinePythonError(
      `Python response declares ${formatByteSize(declared)}, over the ${formatByteSize(PAYLOAD_BYTE_LIMIT)} limit.`,
      'output_too_large',
    )
  if (!response.body)
    throw new PipelinePythonError(
      'Python runner returned an empty response.',
      'runner_unavailable',
    )
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > PAYLOAD_BYTE_LIMIT) {
        await reader.cancel()
        throw new PipelinePythonError(
          `Python response is ${formatByteSize(bytes)}, over the ${formatByteSize(PAYLOAD_BYTE_LIMIT)} limit.`,
          'output_too_large',
        )
      }
      chunks.push(next.value)
    }
    return {
      value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
      bytes,
    }
  } catch (error) {
    if (error instanceof PipelinePythonError) throw error
    if (
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name)
    )
      throw new PipelinePythonError(
        'Python execution timed out.',
        'transform_timed_out',
      )
    throw new PipelinePythonError(
      'Python runner returned an invalid response.',
      'runner_unavailable',
    )
  } finally {
    reader.releaseLock()
  }
}

/**
 * PIPE-04.2 — release a run's artefacts, keeping them only if the run says so.
 *
 * A failure here is reported, not swallowed: artefacts that were meant to be discarded and
 * were not are a privacy problem, and artefacts that were meant to be kept and were not are a
 * lost figure. The caller decides what to do about it; this only says what happened.
 */
export async function releasePythonArtefacts(
  artefactKey: string,
  keep: boolean,
): Promise<void> {
  const runnerUrl = process.env.PIPELINE_PYTHON_RUNNER_URL
  const token = process.env.PIPELINE_PYTHON_RUNNER_TOKEN
  if (!runnerUrl || !token || token.length < 32) return
  const url = new URL(runnerUrl)
  url.pathname = '/artefacts/release'
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ key: artefactKey, keep }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok)
    throw new PipelinePythonError(
      `The Python runner did not release this run's files (${response.status}).`,
      'runner_unavailable',
    )
}

export async function executePythonTransform(
  input: PythonTransformInput,
): Promise<PythonTransformResult> {
  const runnerUrl = process.env.PIPELINE_PYTHON_RUNNER_URL
  const token = process.env.PIPELINE_PYTHON_RUNNER_TOKEN
  if (!runnerUrl || !token || token.length < 32)
    throw new PipelinePythonError(
      'Python execution is not configured. Ask an administrator to configure the Python runner.',
      'runner_unavailable',
    )
  let url: URL
  try {
    url = new URL(runnerUrl)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '')
    )
      throw new Error('invalid URL')
    url.pathname = '/execute'
  } catch {
    throw new PipelinePythonError(
      'The Python runner address is invalid.',
      'runner_unavailable',
    )
  }
  const body = serialize(input)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body,
      // The job has 60 seconds; allow bounded Docker create/remove overhead.
      signal: AbortSignal.timeout((EXECUTION_TIMEOUT_SECONDS + 30) * 1000),
    })
  } catch (error) {
    if (
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name)
    )
      throw new PipelinePythonError(
        'Python execution timed out.',
        'transform_timed_out',
      )
    throw new PipelinePythonError(
      'Python runner is unavailable. Try again later.',
      'runner_unavailable',
    )
  }
  const { value: result, bytes: outputBytes } = await boundedJson(response)
  if (!response.ok) {
    const message =
      isObject(result) && typeof result.error === 'string'
        ? result.error.slice(0, 2000)
        : 'Python execution failed.'
    throw new PipelinePythonError(
      message,
      response.status === 504
        ? 'transform_timed_out'
        : response.status === 503 || response.status === 401
          ? 'runner_unavailable'
          : 'transform_failed',
      failureDetail(result),
    )
  }
  if (
    !isObject(result) ||
    typeof result.runtime !== 'string' ||
    !DIGEST_IMAGE.test(result.runtime)
  )
    throw new PipelinePythonError(
      'Python runner did not report a pinned runtime.',
      'runner_unavailable',
    )
  if (input.runtime && input.runtime !== result.runtime)
    throw new PipelinePythonError(
      'The runner returned a different Python runtime than the pinned version.',
      'runner_unavailable',
    )
  // PIPE-04.1: the runner reports the files it collected, if the step declared a key.
  const files = Array.isArray(result.files)
    ? (result.files as unknown[]).map((entry) => {
        if (
          !isObject(entry) ||
          typeof entry.name !== 'string' ||
          typeof entry.size !== 'number'
        )
          throw new PipelinePythonError(
            'Python runner reported a malformed file entry.',
          )
        return { name: entry.name, size: entry.size }
      })
    : []

  const measured = measureRows(result.rows, 'result')
  const logBytes = Array.isArray(result.logs)
    ? Buffer.byteLength(result.logs.join('\n'))
    : 0
  if (
    !Array.isArray(result.logs) ||
    result.logs.some((line) => typeof line !== 'string') ||
    logBytes > MAX_LOG_BYTES
  )
    throw new PipelinePythonError(
      `Python log output is ${formatByteSize(logBytes)}, over the ${formatByteSize(MAX_LOG_BYTES)} limit.`,
      'output_too_large',
    )
  return {
    rows: result.rows as Record<string, unknown>[],
    logs: result.logs as string[],
    runtime: result.runtime,
    environment: readEnvironment(result.environment),
    files,
    usage: {
      inputBytes: Buffer.byteLength(body),
      outputBytes,
      rows: measured.rows,
      cells: measured.cells,
    },
  }
}

/** What the runner offers: the immutable image, and when it could be read, its contents. */
export interface PythonRuntimeInfo {
  runtime: string
  python?: string
  packages?: Record<string, string>
}

/** Fetch the configured immutable runtime only after the runner checks it is installed. */
export async function getPythonRuntimeInfo(): Promise<PythonRuntimeInfo> {
  const runnerUrl = process.env.PIPELINE_PYTHON_RUNNER_URL
  const token = process.env.PIPELINE_PYTHON_RUNNER_TOKEN
  if (!runnerUrl || !token || token.length < 32)
    throw new PipelinePythonError(
      'Python execution is not configured.',
      'runner_unavailable',
    )
  try {
    const url = new URL(runnerUrl)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error('invalid runner address')
    url.pathname = '/runtime'
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    const { value: result } = await boundedJson(response)
    if (
      !response.ok ||
      !isObject(result) ||
      typeof result.runtime !== 'string' ||
      !DIGEST_IMAGE.test(result.runtime)
    )
      throw new Error('runtime unavailable')
    const packages: Record<string, string> = {}
    if (isObject(result.packages))
      for (const [name, version] of Object.entries(result.packages))
        if (typeof version === 'string') packages[name] = version
    return {
      runtime: result.runtime,
      ...(typeof result.python === 'string' ? { python: result.python } : {}),
      ...(isObject(result.packages) ? { packages } : {}),
    }
  } catch {
    throw new PipelinePythonError(
      'Python runner is unavailable. Ask an administrator to configure the runtime.',
      'runner_unavailable',
    )
  }
}

export async function getPythonRuntime(): Promise<string> {
  return (await getPythonRuntimeInfo()).runtime
}
