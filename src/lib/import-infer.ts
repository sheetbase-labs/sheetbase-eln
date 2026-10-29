/**
 * Working out a table from a file. When nothing in the workspace fits an
 * imported file, the import offers to make a table from its columns: a name,
 * a type and a unit for each, read from the header and the values. Pure, so the
 * server can run it over every row and tests can pin the rules.
 */
import { importHeaderUnit } from '#/lib/import-mapping'

/** Types a table made from a file can have; the database accepts these six. */
export const INFERRED_TYPES = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
] as const
export type InferredType = (typeof INFERRED_TYPES)[number]

export interface InferredColumn {
  /** The header exactly as the file has it; the import maps from this. */
  source: string
  /** The name the column gets: the header without a trailing unit. */
  name: string
  /** A stable machine key derived from the name, unique within the table. */
  key: string
  type: InferredType
  /** A unit read from the header, kept only for numeric columns. */
  unit: string | null
  examples: string[]
  /** How many rows leave this column empty. */
  emptyCount: number
  /** False for a column that is empty in every row. */
  keep: boolean
}

const INTEGER = /^-?\d+$/
const DECIMAL = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const BOOLEAN = new Set(['true', 'false', 'yes', 'no'])

function typeOf(values: string[]): InferredType {
  if (values.length === 0) return 'text'
  // A number written with a leading zero ("0412") is an identifier, not a count.
  const leadingZero = (value: string) => /^-?0\d/.test(value)
  if (values.every((value) => INTEGER.test(value) && !leadingZero(value))) {
    return values.every((value) => Number.isSafeInteger(Number(value)))
      ? 'integer'
      : 'decimal'
  }
  if (values.every((value) => DECIMAL.test(value) && !leadingZero(value))) {
    return 'decimal'
  }
  if (values.every((value) => BOOLEAN.has(value.toLowerCase())))
    return 'boolean'
  if (values.every((value) => DATE.test(value))) return 'date'
  if (
    values.every(
      (value) => TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value)),
    )
  ) {
    return 'timestamp'
  }
  return 'text'
}

/** `Signal (RFU)` → `Signal`; `Conc [nM]` → `Conc`. */
export function columnNameFromHeader(header: string, position: number): string {
  const bare = header
    .replace(/\s*(?:\([^()]+\)|\[[^[\]]+\])\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return bare || `Column ${position + 1}`
}

/** A machine key from a name: lower case, letters, digits and underscores. */
export function columnKeyFromName(name: string, taken: ReadonlySet<string>) {
  let base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!/^[a-z]/.test(base)) base = `c_${base}`.replace(/_$/, '')
  base = base.slice(0, 50) || 'column'
  let key = base
  for (let n = 2; taken.has(key); n += 1) key = `${base}_${n}`
  return key
}

export function inferImportColumns(
  headers: readonly string[],
  rows: ReadonlyArray<Record<string, string>>,
): InferredColumn[] {
  const taken = new Set<string>()
  return headers.map((source, position) => {
    const present: string[] = []
    let emptyCount = 0
    for (const row of rows) {
      const value = (row[source] ?? '').trim()
      if (value === '') emptyCount += 1
      else present.push(value)
    }
    const type = typeOf(present)
    const name = columnNameFromHeader(source, position)
    const key = columnKeyFromName(name, taken)
    taken.add(key)
    const unit =
      type === 'integer' || type === 'decimal' ? importHeaderUnit(source) : null
    return {
      source,
      name,
      key,
      type,
      unit,
      examples: [...new Set(present)].slice(0, 3),
      emptyCount,
      keep: present.length > 0,
    }
  })
}
