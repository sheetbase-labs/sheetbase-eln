/**
 * What an instrument file says about each sample, as the run's results.
 *
 * A file that names samples (a "Sample" column) gives each of them a link to
 * the run that measured it, and one result per reading or verdict. The release
 * gate reads these, so a sample's checks can pass from real instrument data
 * instead of values typed in. Nothing here guesses: a column is a reading only
 * when its cells are numbers, and a verdict only when its cells say pass, fail
 * or warning.
 */
import type { DataClient } from '../data-client'
import type { ParsedInstrumentPayload } from './registry'

export interface SampleCheck {
  name: string
  type: 'pass' | 'warning' | 'fail' | 'info'
  value?: number
  unit?: string
  message?: string
}

export interface SampleResult {
  sample: string
  checks: SampleCheck[]
}

export interface RunResultsOutcome {
  /** Samples now linked to the run. */
  linked: number
  checks: number
  /** Identifiers in the file that match no sample the person can see. */
  unknown: string[]
}

const SAMPLE_HEADER =
  /^(sample([\s_-]?(id|name|no|number|code))?|specimen|tube)$/i
const VERDICT_HEADER =
  /^(qc([\s_-]?(status|result|flag|verdict))?|pass[\s/_-]?fail|verdict|result|status|flag)$/i
/** Columns that are about the row, not a reading of the sample. */
const NOT_A_READING =
  /^(time|timestamp|date|datetime|well|position|row|col|column|index|id|no|number|dilution|dilution factor|operator|notes?|comments?|replicate|run|batch|lot)s?$/i
const NUMBER = /^[-+]?(\d+([.,]\d+)?|[.,]\d+)([eE][-+]?\d+)?$/

function verdictOf(cell: string): SampleCheck['type'] | null {
  const word = cell.trim().toLowerCase()
  if (/^(pass|passed|ok|accept|accepted|in spec|in range)$/.test(word))
    return 'pass'
  if (/^(fail|failed|reject|rejected|out of spec|out of range|oos)$/.test(word))
    return 'fail'
  if (/^(warn|warning|flag|flagged|check|review)$/.test(word)) return 'warning'
  return null
}

function readingOf(cell: string): number | null {
  const text = cell.trim()
  if (!NUMBER.test(text)) return null
  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

/**
 * The per-sample results in a parsed file: empty when the file doesn't name its
 * samples. The unit of a reading comes from the file's own details
 * ("Turbidity unit"), when the parser kept one.
 */
export function sampleResultsFromPayload(
  payload: ParsedInstrumentPayload,
): SampleResult[] {
  const sampleColumn = payload.headers.find((header) =>
    SAMPLE_HEADER.test(header.trim()),
  )
  if (!sampleColumn) return []
  const verdictColumn = payload.headers.find(
    (header) => header !== sampleColumn && VERDICT_HEADER.test(header.trim()),
  )
  const candidates = payload.headers.filter(
    (header) =>
      header !== sampleColumn &&
      header !== verdictColumn &&
      !NOT_A_READING.test(header.trim()),
  )
  // A column is a reading only if every filled cell in it is a number.
  const readings = candidates.filter((header) => {
    const filled = payload.rows
      .map((row) => (row[header] ?? '').trim())
      .filter(Boolean)
    return filled.length > 0 && filled.every((cell) => readingOf(cell) !== null)
  })

  const bySample = new Map<string, SampleCheck[]>()
  for (const row of payload.rows) {
    const sample = (row[sampleColumn] ?? '').trim()
    if (!sample) continue
    const checks = bySample.get(sample) ?? []
    for (const header of readings) {
      const value = readingOf(row[header] ?? '')
      if (value === null) continue
      const unit = payload.metadata[`${header} unit`]
      checks.push({
        name: header.trim(),
        type: 'info',
        value,
        ...(unit ? { unit } : {}),
      })
    }
    if (verdictColumn) {
      const cell = (row[verdictColumn] ?? '').trim()
      const type = verdictOf(cell)
      if (type)
        checks.push({
          name: verdictColumn.trim(),
          type,
          ...(type === 'pass' ? {} : { message: cell }),
        })
    }
    bySample.set(sample, checks)
  }
  return [...bySample.entries()].map(([sample, checks]) => ({ sample, checks }))
}

const CHUNK = 400

/** Links the run to its samples and records their results, in a few calls. */
export async function recordRunSampleResults(
  client: DataClient,
  input: { workspaceId: string; runId: string; results: SampleResult[] },
): Promise<RunResultsOutcome> {
  const outcome: RunResultsOutcome = { linked: 0, checks: 0, unknown: [] }
  for (let at = 0; at < input.results.length; at += CHUNK) {
    const part = await client.rpc<RunResultsOutcome>(
      'record_run_sample_results',
      {
        p_workspace_id: input.workspaceId,
        p_run_id: input.runId,
        p_results: input.results.slice(at, at + CHUNK),
      },
    )
    outcome.linked += part.linked
    outcome.checks += part.checks
    outcome.unknown.push(...part.unknown)
  }
  return outcome
}
