/**
 * Notebook code cells: a Python or SQL block bound to dataset versions. The
 * code runs in the pipeline sandbox, and the output is kept in the block next
 * to the code, the inputs' digests and the image it ran in, so a signed
 * notebook shows exactly what was run. See `run.server.ts` for the run.
 */

export const CODE_CELL_LANGUAGES = ['python', 'sql'] as const
export type CodeCellLanguage = (typeof CODE_CELL_LANGUAGES)[number]

export function isCodeCellLanguage(value: unknown): value is CodeCellLanguage {
  return (
    typeof value === 'string' &&
    (CODE_CELL_LANGUAGES as readonly string[]).includes(value)
  )
}

export const MAX_CODE_CELL_SOURCE = 50_000
export const MAX_CODE_CELL_INPUTS = 5
/** Rows of a run's output kept in the block. The digest covers every row. */
export const MAX_STORED_OUTPUT_ROWS = 100
export const CODE_CELL_ALIAS = /^[A-Za-z_][A-Za-z0-9_]{0,30}$/

export interface CodeCellInput {
  /** The name the code reads the dataset by: `inputs['samples']`, or a table in SQL. */
  alias: string
  datasetVersionId: string
  datasetId?: string
  /** How the version was shown when it was chosen, such as "Plate reads · v3". */
  label?: string
}

export interface CodeCellOutput {
  runId: string
  /** "CC-0004". */
  reference: string
  status: 'ok' | 'error'
  ranAt: string
  columns: string[]
  /** The first rows of the result; `rowCount` is how many there were. */
  rows: Array<Record<string, unknown>>
  rowCount: number
  truncated: boolean
  errorMessage?: string | null
  logs?: string[]
  /** The code that produced this output, kept with it. */
  source: string
  language: CodeCellLanguage
  sourceDigest: string
  outputDigest: string | null
  /** The image the code ran in, pinned by digest ("postgres-sandbox" for SQL). */
  runtime: string | null
  inputs: Array<{
    alias: string
    datasetVersionId: string
    label: string
    rowCount: number
    digest: string
  }>
  /** Set when this output was produced by running a run again. */
  reproducedFrom?: { runId: string; reference: string; matches: boolean } | null
}

export interface CodeCellPayload {
  language?: CodeCellLanguage
  source?: string
  inputs?: CodeCellInput[]
  output?: CodeCellOutput | null
}

export const PYTHON_STARTER = `def transform(inputs, parameters):
    # inputs['name'] is a list of rows, one dict per row.
    # Return a list of dicts, or a pandas DataFrame.
    rows = inputs['samples']
    return rows
`

export const SQL_STARTER = `-- Each input is a table with the name you gave it.
SELECT *
FROM samples
LIMIT 100
`

export function starterSource(language: CodeCellLanguage): string {
  return language === 'python' ? PYTHON_STARTER : SQL_STARTER
}

export function codeCellReference(number: number): string {
  return `CC-${String(number).padStart(4, '0')}`
}

/** Whether the block's code or inputs changed after its output was produced. */
export function outputIsStale(payload: CodeCellPayload): boolean {
  const output = payload.output
  if (!output) return false
  if ((payload.source ?? '') !== output.source) return true
  if ((payload.language ?? 'python') !== output.language) return true
  const now = payload.inputs ?? []
  if (now.length !== output.inputs.length) return true
  return now.some(
    (input, index) =>
      input.datasetVersionId !== output.inputs[index]?.datasetVersionId ||
      input.alias !== output.inputs[index]?.alias,
  )
}

export interface CodeCellRunRequest {
  action: 'run' | 'reproduce'
  recordId: string
  blockId?: string | null
  language?: CodeCellLanguage
  source?: string
  inputs?: Array<{ alias: string; datasetVersionId: string }>
  /** For `reproduce`: the run to run again, with its own code and inputs. */
  runId?: string
}

/** Run a cell, or run an earlier run again, on the server. */
export async function requestCodeCellRun(
  request: CodeCellRunRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<CodeCellOutput> {
  const response = await fetchImpl('/api/notebook/code-cell', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  const body = (await response.json().catch(() => null)) as
    CodeCellOutput | { error?: { message?: string } } | null
  if (!response.ok || !body || 'error' in body) {
    const message =
      body && 'error' in body && body.error?.message
        ? body.error.message
        : 'The code could not be run.'
    throw new Error(message)
  }
  return body as CodeCellOutput
}
