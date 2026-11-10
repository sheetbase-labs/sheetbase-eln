/** Server-only client for the isolated Python runner; never execute code in Node. */
import { z } from 'zod'
import {
  EXECUTION_TIMEOUT_SECONDS,
  INPUT_FIELD_LIMIT,
  INPUT_ROW_LIMIT,
  PAYLOAD_BYTE_LIMIT,
  RESULT_CELL_LIMIT,
  formatByteSize,
} from './pipeline-limits'
import type { RunnerLimits } from './extensions/runtime-config'
import { pythonResultRowsSchema } from './pipelines/python'
import type {
  PythonContract,
  PythonEnvironment,
  PythonResultRow,
} from './pipelines/python'
import {
  pipelineJsonObjectSchema,
  pipelineJsonValueSchema,
} from './pipelines/types'

export type { PythonEnvironment }

/** Original scientific values, before serialization enforces the finite-JSON wire contract. */
export type PythonInputValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | Buffer
  | bigint
  | PythonInputValue[]
  | { [key: string]: PythonInputValue }

export const pythonInputValueSchema: z.ZodType<PythonInputValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.nan(),
    z.literal(Infinity),
    z.literal(-Infinity),
    z.boolean(),
    z.null(),
    z.undefined(),
    z.instanceof(Date),
    z.instanceof(Buffer),
    z.bigint(),
    z.array(pythonInputValueSchema),
    pythonInputRowSchema,
  ]),
)

// Return the original object, preserving Date values, absent/undefined properties and own __proto__ keys.
export const pythonInputRowSchema = z.custom<{
  [key: string]: PythonInputValue
}>((value) => {
  const record = rowObjectSchema.safeParse(value)

  return (
    record.success &&
    Object.values(record.data).every(
      (entry) => pythonInputValueSchema.safeParse(entry).success,
    )
  )
})

export type PythonInputRow = z.infer<typeof pythonInputRowSchema>

export const pythonInputRowsSchema = z.array(pythonInputRowSchema)

export type PythonInputRows = z.infer<typeof pythonInputRowsSchema>

export const pythonInputsSchema = z.custom<Record<string, PythonInputRows>>(
  (value) => {
    const inputs = rowObjectSchema.safeParse(value)

    return (
      inputs.success &&
      Object.values(inputs.data).every(
        (rows) => pythonInputRowsSchema.safeParse(rows).success,
      )
    )
  },
)

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
  inputs: z.infer<typeof pythonInputsSchema>
  parameters: PythonInputRow
  /**
   * A plugin call's own limits, set per plugin by an administrator. They replace
   * the fixed pipeline limits for this call: time, memory, processes, scratch
   * disk, bytes each way and rows. Absent for a pipeline step.
   */
  limits?: RunnerLimits
  /** The runner's name for the plugin's installed packages (`pe-…`). */
  environment?: string
  /** Hosts the plugin's code may reach, as approved by an administrator. */
  network?: string[]
}

/** One file a Python step produced, as the runner reports it. */
export interface PythonArtefact {
  name: string
  size: number
}

export interface PythonTransformResult {
  rows: PythonResultRow[]
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

interface PythonFailureDetail {
  logs?: string[]
  line?: number
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
      | 'output_too_large'
      | 'environment_not_ready'
      | 'network_unavailable' = 'transform_failed',
    detail: PythonFailureDetail = {},
  ) {
    super(message)
    this.name = 'PipelinePythonError'
    this.logs = detail.logs ?? []
    this.line = detail.line
  }
}

const MAX_LOG_BYTES = 64 * 1024

/** Log output kept from a plugin call; it only trims what is shown after a failure. */
const PLUGIN_LOG_BYTES = 1024 * 1024
const DIGEST_IMAGE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/

const rawRowRecordSchema = z.record(z.string(), z.unknown())

// Count original own keys, including __proto__; a parsed Zod record drops that key.
const rowObjectSchema = z.custom<object>(
  (value) => rawRowRecordSchema.safeParse(value).success,
)

const callableSchema = z.function()

const serializationNodeSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z
    .instanceof(Object)
    .refine((value) => !callableSchema.safeParse(value).success),
  rawRowRecordSchema,
  z.array(z.unknown()),
])

const workerObjectSchema = z.object({
  runtime: pipelineJsonValueSchema.optional(),
  rows: pipelineJsonValueSchema.optional(),
  logs: pipelineJsonValueSchema.optional(),
  line: pipelineJsonValueSchema.optional(),
  error: pipelineJsonValueSchema.optional(),
  code: pipelineJsonValueSchema.optional(),
  files: pipelineJsonValueSchema.optional(),
  environment: pipelineJsonValueSchema.optional(),
  python: pipelineJsonValueSchema.optional(),
  packages: pipelineJsonValueSchema.optional(),
  id: pipelineJsonValueSchema.optional(),
  state: pipelineJsonValueSchema.optional(),
})

type WorkerObject = z.infer<typeof workerObjectSchema>

const environmentSchema = z.object({
  python: z.string(),
  packages: z.custom<Record<string, string>>((value) => {
    const packages = pipelineJsonObjectSchema.safeParse(value)

    return (
      packages.success &&
      Object.values(packages.data).every(
        (version) => z.string().safeParse(version).success,
      )
    )
  }),
})

function readPackages(value: WorkerObject['packages']) {
  const parsed = pipelineJsonObjectSchema.safeParse(value)

  if (!parsed.success) return undefined

  return Object.fromEntries(
    Object.entries(parsed.data).flatMap(([name, version]) => {
      const text = z.string().safeParse(version)

      return text.success ? [[name, text.data] satisfies [string, string]] : []
    }),
  )
}

/**
 * Validate row shape and count rows/cells, naming the measured number in any
 * limit failure so a rejected step reports what was hit, not just that a limit
 * exists.
 */
function measureRows(
  rows: PythonInputRow[] | z.infer<typeof pipelineJsonValueSchema> | undefined,
  side: 'input' | 'result',
  limits?: RunnerLimits,
) {
  const label = side === 'input' ? 'Python input' : 'Python result'
  const code = side === 'input' ? 'input_too_large' : 'output_too_large'
  // A plugin call is bounded by its rows and bytes alone; a pipeline step also
  // by the width of a row and the number of cells.
  const rowLimit = limits?.rows ?? INPUT_ROW_LIMIT
  const fieldLimit = limits ? Infinity : INPUT_FIELD_LIMIT
  const cellLimit = limits ? Infinity : RESULT_CELL_LIMIT

  if (!Array.isArray(rows))
    throw new PipelinePythonError(
      `${label} must be a list of row objects.`,
      code,
    )

  if (rows.length > rowLimit)
    throw new PipelinePythonError(
      `${label} has ${rows.length} rows, over the ${rowLimit} row limit.`,
      code,
    )
  let cells = 0

  for (const row of rows) {
    const record = rowObjectSchema.safeParse(row)

    if (!record.success)
      throw new PipelinePythonError(`${label} must contain row objects.`, code)
    const fields = Object.keys(record.data).length
    cells += fields

    if (fields > fieldLimit)
      throw new PipelinePythonError(
        `${label} has a row with ${fields} fields, over the ${INPUT_FIELD_LIMIT} field limit.`,
        code,
      )

    if (cells > cellLimit)
      throw new PipelinePythonError(
        `${label} has ${cells} cells, over the ${RESULT_CELL_LIMIT} cell limit.`,
        code,
      )
  }

  return { rows: rows.length, cells }
}

function serialize(input: PythonTransformInput): string {
  const limits = input.limits
  const byteLimit = limits?.bytes ?? PAYLOAD_BYTE_LIMIT
  const rowLimit = limits?.rows ?? INPUT_ROW_LIMIT
  const cellLimit = limits ? Infinity : RESULT_CELL_LIMIT

  if (
    !input.statement.trim() ||
    // A plugin's files travel inside its steps, bounded by its data limit instead.
    (!limits && input.statement.length > 128_000) ||
    !rowObjectSchema.safeParse(input.inputs).success ||
    !rowObjectSchema.safeParse(input.parameters).success
  )
    throw new PipelinePythonError(
      'Provide Python code, named input rows and parameters.',
    )
  let rows = 0
  let cells = 0

  for (const values of Object.values(input.inputs)) {
    const measured = measureRows(values, 'input', limits)
    cells += measured.cells
    rows += measured.rows
  }

  if (rows > rowLimit || cells > cellLimit)
    throw new PipelinePythonError(
      limits
        ? `Python input has ${rows} rows, over the ${rowLimit} row limit.`
        : `Python input has ${rows} rows and ${cells} cells, over the ${INPUT_ROW_LIMIT} row or ${RESULT_CELL_LIMIT} cell limit.`,
      'input_too_large',
    )
  let body: string

  try {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON.stringify supplies raw post-toJSON nodes; reject unsupported values without cloning scientific keys.
    body = JSON.stringify(input, (_key, value: unknown) => {
      serializationNodeSchema.parse(value)

      return value
    })
  } catch {
    throw new PipelinePythonError(
      'Python inputs and parameters must contain finite JSON values.',
    )
  }

  const bytes = Buffer.byteLength(body)

  if (bytes > byteLimit)
    throw new PipelinePythonError(
      `Python input is ${formatByteSize(bytes)}, over the ${formatByteSize(byteLimit)} limit.`,
      'input_too_large',
    )

  return body
}

/** The logs and line a failed step reported, kept only in the expected shape and size. */
function failureDetail(result: WorkerObject, logLimit: number = MAX_LOG_BYTES) {
  const detail: PythonFailureDetail = {}
  const logs = z.array(z.string()).safeParse(result.logs)
  const line = z.number().int().positive().safeParse(result.line)

  if (logs.success && Buffer.byteLength(logs.data.join('\n')) <= logLimit)
    detail.logs = logs.data

  if (line.success) detail.line = line.data

  return detail
}

async function boundedJson(
  response: Response,
  byteLimit: number = PAYLOAD_BYTE_LIMIT,
) {
  const declared = Number(response.headers.get('content-length'))

  if (declared > byteLimit)
    throw new PipelinePythonError(
      `Python response declares ${formatByteSize(declared)}, over the ${formatByteSize(byteLimit)} limit.`,
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

      if (bytes > byteLimit) {
        await reader.cancel()
        throw new PipelinePythonError(
          `Python response is ${formatByteSize(bytes)}, over the ${formatByteSize(byteLimit)} limit.`,
          'output_too_large',
        )
      }

      chunks.push(next.value)
    }

    return {
      value: pipelineJsonValueSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
      ),
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

  if (!URL.canParse(runnerUrl)) throw new TypeError('Invalid URL')

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
      // The job has its time limit (60 seconds for a pipeline step, the
      // plugin's own setting for a plugin call); allow Docker create/remove overhead.
      signal: AbortSignal.timeout(
        ((input.limits?.timeoutSeconds ?? EXECUTION_TIMEOUT_SECONDS) + 30) *
          1000,
      ),
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

  const logLimit = input.limits ? PLUGIN_LOG_BYTES : MAX_LOG_BYTES

  const { value, bytes: outputBytes } = await boundedJson(
    response,
    // The answer within the plugin's data limit, plus its logs and framing.
    input.limits
      ? input.limits.bytes + PLUGIN_LOG_BYTES + 1024 * 1024
      : undefined,
  )

  const result = workerObjectSchema.catch({}).parse(value)

  if (!response.ok) {
    const error = z.string().safeParse(result.error)

    const message = error.success
      ? error.data.slice(0, 2000)
      : 'Python execution failed.'

    throw new PipelinePythonError(
      message,
      result.code === 'environment_not_ready' ||
        result.code === 'network_unavailable'
        ? result.code
        : response.status === 504
          ? 'transform_timed_out'
          : response.status === 503 || response.status === 401
            ? 'runner_unavailable'
            : 'transform_failed',
      failureDetail(result, logLimit),
    )
  }

  const runtime = z.string().regex(DIGEST_IMAGE).safeParse(result.runtime)

  if (!runtime.success)
    throw new PipelinePythonError(
      'Python runner did not report a pinned runtime.',
      'runner_unavailable',
    )

  if (input.runtime && input.runtime !== runtime.data)
    throw new PipelinePythonError(
      'The runner returned a different Python runtime than the pinned version.',
      'runner_unavailable',
    )

  // PIPE-04.1: the runner reports the files it collected, if the step declared a key.
  const files = Array.isArray(result.files)
    ? result.files.map((entry) => {
        const file = z
          .object({ name: z.string(), size: z.number() })
          .safeParse(entry)

        if (!file.success)
          throw new PipelinePythonError(
            'Python runner reported a malformed file entry.',
          )

        return file.data
      })
    : []

  const measured = measureRows(result.rows, 'result', input.limits)

  const logBytes = Array.isArray(result.logs)
    ? Buffer.byteLength(
        result.logs
          .map((line) => (line === null ? '' : z.coerce.string().parse(line)))
          .join('\n'),
      )
    : 0

  const logs = z.array(z.string()).safeParse(result.logs)

  if (!logs.success || logBytes > logLimit)
    throw new PipelinePythonError(
      `Python log output is ${formatByteSize(logBytes)}, over the ${formatByteSize(logLimit)} limit.`,
      'output_too_large',
    )

  return {
    rows: pythonResultRowsSchema.parse(result.rows),
    logs: logs.data,
    runtime: runtime.data,
    environment: environmentSchema
      .optional()
      .catch(undefined)
      .parse(result.environment),
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

    const { value } = await boundedJson(response)

    const result = workerObjectSchema.catch({}).parse(value)
    const runtime = z.string().regex(DIGEST_IMAGE).safeParse(result.runtime)

    if (!response.ok || !runtime.success) throw new Error('runtime unavailable')
    const info: PythonRuntimeInfo = { runtime: runtime.data }
    const python = z.string().safeParse(result.python)
    const packages = readPackages(result.packages)

    if (python.success) info.python = python.data

    if (packages) info.packages = packages

    return info
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

/** What the runner says about a plugin's installed packages. */
export interface PythonEnvironmentStatus {
  id: string
  state: 'ready' | 'building' | 'failed' | 'missing'
  error?: string
  packages?: Record<string, string>
}

function runnerRequest(path: string, init: RequestInit): Promise<Response> {
  const runnerUrl = process.env.PIPELINE_PYTHON_RUNNER_URL
  const token = process.env.PIPELINE_PYTHON_RUNNER_TOKEN

  if (!runnerUrl || !token || token.length < 32)
    throw new PipelinePythonError(
      'Python execution is not configured. Ask an administrator to configure the Python runner.',
      'runner_unavailable',
    )

  if (!URL.canParse(runnerUrl)) throw new TypeError('Invalid URL')

  const url = new URL(runnerUrl)
  url.pathname = path
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)

  return fetch(url, {
    ...init,
    redirect: 'error',
    headers,
    signal: AbortSignal.timeout(15_000),
  })
}

async function environmentAnswer(
  response: Response,
): Promise<PythonEnvironmentStatus> {
  const { value } = await boundedJson(response, 4 * 1024 * 1024)

  const result = workerObjectSchema.catch({}).parse(value)
  const id = z.string().safeParse(result.id)
  const error = z.string().safeParse(result.error)

  if (!response.ok || !id.success) {
    throw new PipelinePythonError(
      error.success
        ? error.data.slice(0, 2000)
        : 'Python runner is unavailable. Try again later.',
      'runner_unavailable',
    )
  }

  const status: PythonEnvironmentStatus = {
    id: id.data,
    state:
      result.state === 'ready' ||
      result.state === 'building' ||
      result.state === 'failed'
        ? result.state
        : 'missing',
  }

  const packages = readPackages(result.packages)

  if (error.success) status.error = error.data

  if (packages) status.packages = packages

  return status
}

/** Asks the runner to install a plugin's packages (a no-op when they are already there). */
export async function requestPythonEnvironment(
  requirements: string[],
): Promise<PythonEnvironmentStatus> {
  let response: Response

  try {
    response = await runnerRequest('/environments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirements }),
    })
  } catch (error) {
    if (error instanceof PipelinePythonError) throw error
    throw new PipelinePythonError(
      'Python runner is unavailable. Try again later.',
      'runner_unavailable',
    )
  }

  return environmentAnswer(response)
}

/** Where a plugin's packages stand on the runner. */
export async function getPythonEnvironment(
  id: string,
): Promise<PythonEnvironmentStatus> {
  let response: Response

  try {
    response = await runnerRequest(`/environments/${id}`, { method: 'GET' })
  } catch (error) {
    if (error instanceof PipelinePythonError) throw error
    throw new PipelinePythonError(
      'Python runner is unavailable. Try again later.',
      'runner_unavailable',
    )
  }

  return environmentAnswer(response)
}
