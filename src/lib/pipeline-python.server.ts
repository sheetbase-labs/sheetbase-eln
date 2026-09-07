/** Server-only client for the isolated Python runner; never execute code in Node. */
import {
  EXECUTION_TIMEOUT_SECONDS,
  INPUT_FIELD_LIMIT,
  INPUT_ROW_LIMIT,
  RESULT_CELL_LIMIT,
} from './pipeline-limits'

export interface PythonTransformInput {
  statement: string
  runtime?: string
  inputs: Record<string, Record<string, unknown>[]>
  parameters: Record<string, unknown>
}

export interface PythonTransformResult {
  rows: Record<string, unknown>[]
  logs: string[]
  /** Immutable image identity returned by the trusted runner, for run provenance. */
  runtime: string
}

export class PipelinePythonError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'runner_unavailable'
      | 'transform_failed'
      | 'transform_timed_out'
      | 'input_too_large'
      | 'output_too_large' = 'transform_failed',
  ) {
    super(message)
    this.name = 'PipelinePythonError'
  }
}

const MAX_BYTES = 32 * 1024 * 1024
const MAX_LOG_BYTES = 64 * 1024
const DIGEST_IMAGE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function countCells(rows: unknown): number {
  if (!Array.isArray(rows) || rows.length > INPUT_ROW_LIMIT)
    throw new PipelinePythonError('Python row limit exceeded.')
  let count = 0
  for (const row of rows) {
    if (!isObject(row))
      throw new PipelinePythonError('Python must return row objects.')
    const fields = Object.keys(row).length
    count += fields
    if (fields > INPUT_FIELD_LIMIT || count > RESULT_CELL_LIMIT)
      throw new PipelinePythonError('Python field or cell limit exceeded.')
  }
  return count
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
    cells += countCells(values)
    rows += values.length
  }
  if (rows > INPUT_ROW_LIMIT || cells > RESULT_CELL_LIMIT)
    throw new PipelinePythonError(
      'Python input exceeds row or cell limit.',
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
  if (Buffer.byteLength(body) > MAX_BYTES)
    throw new PipelinePythonError(
      'Python input exceeds 32 MiB.',
      'input_too_large',
    )
  return body
}

async function boundedJson(response: Response): Promise<unknown> {
  if (
    !response.body ||
    Number(response.headers.get('content-length')) > MAX_BYTES
  )
    throw new PipelinePythonError(
      'Python response exceeds its size limit.',
      'output_too_large',
    )
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > MAX_BYTES) {
        await reader.cancel()
        throw new PipelinePythonError(
          'Python response exceeds 32 MiB.',
          'output_too_large',
        )
      }
      chunks.push(next.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
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
  const result = await boundedJson(response)
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
  countCells(result.rows)
  if (
    !Array.isArray(result.logs) ||
    result.logs.some((line) => typeof line !== 'string') ||
    Buffer.byteLength(result.logs.join('\n')) > MAX_LOG_BYTES
  )
    throw new PipelinePythonError(
      'Python log output exceeds its limit.',
      'output_too_large',
    )
  return {
    rows: result.rows as Record<string, unknown>[],
    logs: result.logs as string[],
    runtime: result.runtime,
  }
}

/** Fetch the configured immutable runtime only after the runner checks it is installed. */
export async function getPythonRuntime(): Promise<string> {
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
    const result = await boundedJson(response)
    if (
      !response.ok ||
      !isObject(result) ||
      typeof result.runtime !== 'string' ||
      !DIGEST_IMAGE.test(result.runtime)
    )
      throw new Error('runtime unavailable')
    return result.runtime
  } catch {
    throw new PipelinePythonError(
      'Python runner is unavailable. Ask an administrator to configure the runtime.',
      'runner_unavailable',
    )
  }
}
