import { t } from '#/copy'
/**
 * Sample rows for a test run, typed or pasted by a person: a JSON array of row
 * objects, one JSON object per line, or CSV with a header row. CSV has no types,
 * so numbers and true/false are read as such and an empty cell is a missing
 * value; anything else stays text. Dates stay strings, as they do in a run.
 */

export type SampleResult =
  { rows: Array<Record<string, unknown>> } | { error: string }

const MAX_SAMPLE_CHARS = 1_000_000
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

function csvCell(text: string): unknown {
  if (text === '') return null
  if (text === 'true') return true
  if (text === 'false') return false
  if (NUMBER_RE.test(text)) {
    const n = Number(text)
    // Keep what would lose digits as a string, the way a run keeps decimals.
    return Number.isFinite(n) &&
      String(n).length >= text.replace(/^\+/, '').length
      ? n
      : text
  }
  return text
}

function csvRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"' && cell === '') quoted = true
    else if (char === ',') {
      record.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      record.push(cell)
      records.push(record)
      record = []
      cell = ''
    } else cell += char
  }
  if (quoted)
    throw new SyntaxError(t('data.pipelineSample.quotedCsvValueNever'))
  if (cell !== '' || record.length) {
    record.push(cell)
    records.push(record)
  }
  return records.filter((r) => r.some((c) => c !== ''))
}

const isRow = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export function parseSample(text: string): SampleResult {
  const trimmed = text.trim()
  if (!trimmed) return { rows: [] }
  if (trimmed.length > MAX_SAMPLE_CHARS)
    return { error: t('data.pipelineSample.sampleTooLongPaste') }
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (!Array.isArray(parsed) || !parsed.every(isRow))
        return {
          error: t('data.pipelineSample.useListRowObjects', {
            sample: '[{"value": 1}]',
          }),
        }
      return { rows: parsed }
    } catch {
      return { error: t('data.pipelineSample.validJson') }
    }
  }
  if (trimmed.startsWith('{')) {
    const rows: Array<Record<string, unknown>> = []
    for (const [index, line] of trimmed.split('\n').entries()) {
      if (!line.trim()) continue
      try {
        const parsed: unknown = JSON.parse(line)
        if (!isRow(parsed))
          throw new Error(t('data.pipelineSample.notAnObject'))
        rows.push(parsed)
      } catch {
        return {
          error: t('data.pipelineSample.lineJsonObject', { value: index + 1 }),
        }
      }
    }
    return { rows }
  }
  let records: string[][]
  try {
    records = csvRecords(trimmed)
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : t('data.pipelineSample.badCsv'),
    }
  }
  const [header, ...body] = records
  if (!header.every((name) => name.trim()))
    return { error: t('data.pipelineSample.everyCsvColumnNeeds') }
  const names = header.map((name) => name.trim())
  if (new Set(names).size !== names.length)
    return { error: t('data.pipelineSample.csvColumnNamesMust') }
  const rows: Array<Record<string, unknown>> = []
  for (const [index, record] of body.entries()) {
    if (record.length !== names.length)
      return {
        error: t('data.pipelineSample.csvRowHasValues', {
          value: index + 2,
          length: record.length,
          length2: names.length,
        }),
      }
    rows.push(
      Object.fromEntries(names.map((name, i) => [name, csvCell(record[i])])),
    )
  }
  return { rows }
}
