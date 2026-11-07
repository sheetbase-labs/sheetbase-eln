/**
 * Running a notebook code cell on the server, and running an earlier run again.
 *
 * Python goes to the pipeline's Python runner (an image pinned by digest); SQL
 * goes to the pipeline SQL sandbox with each input as a temporary table. Either
 * way the inputs are exact dataset versions read as the signed-in person, every
 * run is recorded (`api.record_code_cell_run`) with the code, the inputs'
 * digests and the runtime, and a reproduction says whether the output came out
 * the same (the same digest, or a diff within tolerance).
 */
import { createHash } from 'node:crypto'

import type { DataClient } from '../data-client'
import {
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import { createServerDataClient } from '../connectors/enterprise/execution.server'
import { diffMatches, diffResultRows } from '../pipelines/reproduce-diff'
import type { ReproduceDiff } from '../pipelines/reproduce-diff'
import {
  CODE_CELL_ALIAS,
  MAX_CODE_CELL_INPUTS,
  MAX_CODE_CELL_SOURCE,
  MAX_STORED_OUTPUT_ROWS,
  codeCellReference,
  isCodeCellLanguage,
} from './code-cell'
import type {
  CodeCellLanguage,
  CodeCellOutput,
  CodeCellRunRequest,
} from './code-cell'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INPUT_ROW_LIMIT = 50_000
const SQL_ROW_LIMIT = 10_000
const SQL_TIMEOUT_SECONDS = 15

export class CodeCellError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'CodeCellError'
  }
}

export interface DatasetColumn {
  key: string
  label: string
  type: string
}

export interface LoadedInput {
  alias: string
  datasetVersionId: string
  label: string
  columns: DatasetColumn[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  digest: string
}

export interface ExecutionResult {
  rows: Array<Record<string, unknown>>
  logs: string[]
  runtime: string
  environment: Record<string, unknown> | null
}

export interface CodeCellDeps extends SessionAuthDeps {
  createClient?: (token: string) => DataClient
  executePython: (input: {
    source: string
    inputs: Record<string, Array<Record<string, unknown>>>
  }) => Promise<ExecutionResult>
  executeSql: (input: {
    source: string
    inputs: LoadedInput[]
  }) => Promise<ExecutionResult>
  now?: () => number
}

/** Stable JSON: object keys sorted, so the same rows always give the same digest. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

export function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`
}

export function digestRows(
  rows: ReadonlyArray<Record<string, unknown>>,
): string {
  return sha256(canonicalJson(rows))
}

/** The first word of a statement once comments are out of the way. */
function firstWord(sql: string): string {
  return (
    sql
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ')
      .trim()
      .split(/[\s(]/)[0]
      ?.toLowerCase() ?? ''
  )
}

/** One read-only statement, without its trailing semicolon. */
export function singleSelect(source: string): string {
  const statement = source.trim().replace(/;+\s*$/, '')
  if (statement === '') {
    throw new CodeCellError(400, 'invalid_request', 'Write a query to run.')
  }
  if (statement.includes(';')) {
    throw new CodeCellError(
      400,
      'invalid_request',
      'Run one query at a time: use a single SELECT.',
    )
  }
  if (!['select', 'with', 'values', 'table'].includes(firstWord(statement))) {
    throw new CodeCellError(
      400,
      'invalid_request',
      'A SQL cell reads data: start with SELECT or WITH.',
    )
  }
  return statement
}

const SQL_TYPES: Record<string, string> = {
  text: 'text',
  integer: 'bigint',
  decimal: 'numeric',
  boolean: 'boolean',
  date: 'date',
  timestamp: 'timestamptz',
}

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

/** The SQL sandbox: each input becomes a temporary table, the query reads them. */
export async function runSandboxSql(input: {
  source: string
  inputs: LoadedInput[]
}): Promise<ExecutionResult> {
  const statement = singleSelect(input.source)
  const { connectPipelineSandbox, SandboxUnavailableError } =
    await import('../pipeline-sandbox.server')
  let conn
  try {
    conn = await connectPipelineSandbox()
  } catch (error) {
    if (error instanceof SandboxUnavailableError) {
      throw new CodeCellError(503, 'runner_unavailable', error.message)
    }
    throw new CodeCellError(
      503,
      'runner_unavailable',
      'The SQL sandbox is unavailable. Ask an administrator to check it.',
    )
  }
  try {
    await conn.query('BEGIN')
    for (const table of input.inputs) {
      const columns = table.columns.length
        ? table.columns
        : [{ key: 'value', label: 'value', type: 'text' }]
      const name = quote(table.alias)
      await conn.query(
        `CREATE TEMP TABLE ${name} (${columns
          .map((c) => `${quote(c.key)} ${SQL_TYPES[c.type] ?? 'text'}`)
          .join(', ')}) ON COMMIT DROP`,
      )
      for (let i = 0; i < table.rows.length; i += 2_000) {
        await conn.query(
          `INSERT INTO pg_temp.${name}
             SELECT * FROM jsonb_populate_recordset(NULL::pg_temp.${name}, $1::jsonb)`,
          [JSON.stringify(table.rows.slice(i, i + 2_000))],
        )
      }
    }
    await conn.query('SET TRANSACTION READ ONLY')
    await conn.query(`SET LOCAL statement_timeout = '${SQL_TIMEOUT_SECONDS}s'`)
    const result = await conn.query<{ doc: Record<string, unknown> }>(
      `SELECT to_jsonb(q) AS doc FROM (\n${statement}\n) q LIMIT ${SQL_ROW_LIMIT + 1}`,
    )
    await conn.query('ROLLBACK')
    return {
      rows: result.rows.slice(0, SQL_ROW_LIMIT).map((r) => r.doc),
      logs:
        result.rows.length > SQL_ROW_LIMIT
          ? [`Only the first ${SQL_ROW_LIMIT} rows are kept.`]
          : [],
      runtime: 'postgres-sandbox',
      environment: null,
    }
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {})
    if (error instanceof CodeCellError) throw error
    throw new CodeCellError(
      422,
      'code_failed',
      error instanceof Error ? error.message : 'The query failed.',
    )
  } finally {
    await conn.end().catch(() => {})
  }
}

/** The pipeline Python runner. The cell defines `transform(inputs, parameters)`. */
export async function runPython(input: {
  source: string
  inputs: Record<string, Array<Record<string, unknown>>>
}): Promise<ExecutionResult> {
  const { executePythonTransform, PipelinePythonError } =
    await import('../pipeline-python.server')
  try {
    const result = await executePythonTransform({
      statement: input.source,
      inputs: input.inputs,
      parameters: {},
    })
    return {
      rows: result.rows,
      logs: result.logs,
      runtime: result.runtime,
      environment: result.environment
        ? (result.environment as unknown as Record<string, unknown>)
        : null,
    }
  } catch (error) {
    if (error instanceof PipelinePythonError) {
      if (error.code === 'runner_unavailable') {
        throw new CodeCellError(503, 'runner_unavailable', error.message)
      }
      throw new CodeCellError(
        422,
        'code_failed',
        error.line ? `${error.message} (line ${error.line})` : error.message,
      )
    }
    throw error
  }
}

export const realCodeCellDeps: CodeCellDeps = {
  ...realSessionAuthDeps,
  executePython: runPython,
  executeSql: runSandboxSql,
}

interface DatasetJson {
  versionId: string
  datasetId: string
  label: string
  columns: DatasetColumn[]
  rowCount: number
  truncated: boolean
  rows: Array<Record<string, unknown>>
}

async function loadInputs(
  client: DataClient,
  inputs: Array<{ alias: string; datasetVersionId: string }>,
): Promise<LoadedInput[]> {
  const loaded: LoadedInput[] = []
  for (const input of inputs) {
    let doc: DatasetJson
    try {
      doc = await client.rpc<DatasetJson>('dataset_version_rows_json', {
        p_version_id: input.datasetVersionId,
        p_limit: INPUT_ROW_LIMIT,
      })
    } catch (error) {
      throw new CodeCellError(
        404,
        'input_not_found',
        error instanceof Error && error.message
          ? `${input.alias}: ${error.message}`
          : `${input.alias}: that dataset version is not available.`,
      )
    }
    if (doc.truncated) {
      throw new CodeCellError(
        413,
        'input_too_large',
        `${input.alias} has more than ${INPUT_ROW_LIMIT} rows, which is more than a code cell reads.`,
      )
    }
    loaded.push({
      alias: input.alias,
      datasetVersionId: input.datasetVersionId,
      label: doc.label,
      columns: doc.columns,
      rows: doc.rows,
      rowCount: doc.rowCount,
      digest: digestRows(doc.rows),
    })
  }
  return loaded
}

interface RunRow {
  id: string
  number: number
  block_id: string | null
  record_id: string
  language: CodeCellLanguage
  source: string
  inputs: Array<{ alias: string; datasetVersionId: string }>
  output: { rows?: Array<Record<string, unknown>> } | null
  output_digest: string | null
  ran_at: string
}

function parseRequest(raw: unknown): CodeCellRunRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CodeCellError(400, 'invalid_request', 'Send a JSON object.')
  }
  const body = raw as Record<string, unknown>
  const action = body['action']
  if (action !== 'run' && action !== 'reproduce') {
    throw new CodeCellError(
      400,
      'invalid_request',
      'action must be run or reproduce.',
    )
  }
  const recordId = body['recordId']
  if (typeof recordId !== 'string' || !UUID.test(recordId)) {
    throw new CodeCellError(
      400,
      'invalid_request',
      'recordId must be an experiment id.',
    )
  }
  const blockId = body['blockId']
  if (
    blockId !== undefined &&
    blockId !== null &&
    (typeof blockId !== 'string' || !UUID.test(blockId))
  ) {
    throw new CodeCellError(
      400,
      'invalid_request',
      'blockId must be a block id.',
    )
  }
  const out: CodeCellRunRequest = {
    action,
    recordId,
    blockId: blockId ?? null,
  }
  if (action === 'reproduce') {
    const runId = body['runId']
    if (typeof runId !== 'string' || !UUID.test(runId)) {
      throw new CodeCellError(400, 'invalid_request', 'runId must be a run id.')
    }
    out.runId = runId
    return out
  }
  if (!isCodeCellLanguage(body['language'])) {
    throw new CodeCellError(
      400,
      'invalid_request',
      'language must be python or sql.',
    )
  }
  out.language = body['language']
  const source = body['source']
  if (
    typeof source !== 'string' ||
    source.trim() === '' ||
    source.length > MAX_CODE_CELL_SOURCE
  ) {
    throw new CodeCellError(
      400,
      'invalid_request',
      'Write some code to run (up to 50,000 characters).',
    )
  }
  out.source = source
  const inputs = body['inputs'] ?? []
  if (!Array.isArray(inputs) || inputs.length > MAX_CODE_CELL_INPUTS) {
    throw new CodeCellError(
      400,
      'invalid_request',
      `A cell reads up to ${MAX_CODE_CELL_INPUTS} datasets.`,
    )
  }
  const seen = new Set<string>()
  out.inputs = inputs.map((entry: unknown) => {
    const row = (entry ?? {}) as Record<string, unknown>
    const alias = row['alias']
    const versionId = row['datasetVersionId']
    if (typeof alias !== 'string' || !CODE_CELL_ALIAS.test(alias)) {
      throw new CodeCellError(
        400,
        'invalid_request',
        'Name each input with letters, digits and underscores.',
      )
    }
    if (seen.has(alias)) {
      throw new CodeCellError(
        400,
        'invalid_request',
        `The name ${alias} is used twice.`,
      )
    }
    seen.add(alias)
    if (typeof versionId !== 'string' || !UUID.test(versionId)) {
      throw new CodeCellError(
        400,
        'invalid_request',
        `${alias} needs a dataset version.`,
      )
    }
    return { alias, datasetVersionId: versionId }
  })
  return out
}

/** Run one cell, record the run and say what came out. */
export async function runCodeCell(
  client: DataClient,
  request: CodeCellRunRequest,
  deps: Pick<CodeCellDeps, 'executePython' | 'executeSql' | 'now'>,
): Promise<CodeCellOutput> {
  const now = deps.now ?? Date.now
  let original: RunRow | null = null
  let language = request.language
  let source = request.source
  let inputsRequested = request.inputs ?? []
  let blockId = request.blockId ?? null
  if (request.action === 'reproduce') {
    const rows = await client.list<RunRow>(
      'code_cell_runs',
      `select=id,number,block_id,record_id,language,source,inputs,output,output_digest,ran_at&id=eq.${request.runId}&limit=1`,
    )
    original = rows.at(0) ?? null
    if (!original) {
      throw new CodeCellError(404, 'not_found', 'That run is not here.')
    }
    language = original.language
    source = original.source
    inputsRequested = original.inputs.map((i) => ({
      alias: i.alias,
      datasetVersionId: i.datasetVersionId,
    }))
    blockId = original.block_id
  }
  if (!language || source === undefined) {
    throw new CodeCellError(400, 'invalid_request', 'Nothing to run.')
  }

  const inputs = await loadInputs(client, inputsRequested)
  const started = now()
  let execution: ExecutionResult | null = null
  let failure: string | null = null
  try {
    execution =
      language === 'python'
        ? await deps.executePython({
            source,
            inputs: Object.fromEntries(inputs.map((i) => [i.alias, i.rows])),
          })
        : await deps.executeSql({ source, inputs })
  } catch (error) {
    if (error instanceof CodeCellError && error.code === 'code_failed') {
      failure = error.message
    } else {
      throw error
    }
  }
  const duration = Math.max(0, now() - started)
  const rows = execution?.rows ?? []
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const stored = rows.slice(0, MAX_STORED_OUTPUT_ROWS)
  const outputDigest = execution ? digestRows(rows) : null
  const sourceDigest = sha256(source)

  let matches: boolean | null = null
  let diff: ReproduceDiff | null = null
  if (original) {
    if (failure || !execution) {
      matches = false
    } else if (
      original.output_digest &&
      original.output_digest === outputDigest
    ) {
      matches = true
    } else {
      diff = diffResultRows(original.output?.rows ?? [], stored)
      matches = rows.length <= MAX_STORED_OUTPUT_ROWS && diffMatches(diff)
    }
  }

  const recorded = await client.rpc<{
    id: string
    number: number
    ran_at: string
  }>('record_code_cell_run', {
    p_record_id: request.recordId,
    p_block_id: blockId,
    p_language: language,
    p_source: source,
    p_source_sha256: sourceDigest,
    p_inputs: inputs.map((i) => ({
      alias: i.alias,
      datasetVersionId: i.datasetVersionId,
      label: i.label,
      rowCount: i.rowCount,
      digest: i.digest,
    })),
    p_parameters: {},
    p_status: failure ? 'failed' : 'succeeded',
    p_output: execution
      ? {
          columns: columns.map((name) => ({ name })),
          rows: stored,
          rowCount: rows.length,
          truncated: rows.length > stored.length,
        }
      : null,
    p_output_digest: outputDigest,
    p_runtime: execution?.runtime ?? null,
    p_environment: execution?.environment ?? null,
    p_logs: execution?.logs ?? [],
    p_error: failure,
    p_duration_ms: duration,
    p_reproduces_run_id: original?.id ?? null,
    p_matches: matches,
    p_diff: diff,
  })

  return {
    runId: recorded.id,
    reference: codeCellReference(recorded.number),
    status: failure ? 'error' : 'ok',
    ranAt: recorded.ran_at,
    columns,
    rows: stored,
    rowCount: rows.length,
    truncated: rows.length > stored.length,
    errorMessage: failure,
    logs: execution?.logs ?? [],
    source,
    language,
    sourceDigest,
    outputDigest,
    runtime: execution?.runtime ?? null,
    inputs: inputs.map((i) => ({
      alias: i.alias,
      datasetVersionId: i.datasetVersionId,
      label: i.label,
      rowCount: i.rowCount,
      digest: i.digest,
    })),
    reproducedFrom: original
      ? {
          runId: original.id,
          reference: codeCellReference(original.number),
          matches: matches === true,
        }
      : null,
  }
}

/** `POST /api/notebook/code-cell`: run a cell, or run an earlier run again. */
export async function handleCodeCell(
  request: Request,
  deps: CodeCellDeps = realCodeCellDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')
  }
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok) {
    return requestErrorResponse(auth.status, auth.code, auth.message)
  }
  try {
    const parsed = parseRequest(await request.json().catch(() => null))
    const client = (deps.createClient ?? createServerDataClient)(
      auth.context.token,
    )
    return Response.json(await runCodeCell(client, parsed, deps))
  } catch (error) {
    if (error instanceof CodeCellError) {
      return requestErrorResponse(error.status, error.code, error.message)
    }
    return requestErrorResponse(
      422,
      'code_failed',
      error instanceof Error && error.message
        ? error.message
        : 'The code could not be run.',
    )
  }
}
