import { createHash, randomUUID } from 'node:crypto'

export const ROW_IDENTITY_FORMAT_VERSION = 1 as const

export type RowIdentitySpec = {
  kind: 'source' | 'composite' | 'local'
  columnIds: readonly string[]
  logicalTypes: readonly RowIdentityLogicalType[]
}

export type RowIdentityLogicalType =
  | 'text'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'category'
  | 'reference'

export type RowIdentityError = {
  code: 'missing' | 'invalid' | 'duplicate'
  row: number
  columnId?: string
  key?: string
}

export type RowIdentityBatchResult =
  | { ok: true; rows: Array<{ key: string; localId?: string }> }
  | { ok: false; errors: RowIdentityError[] }

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const nilUuid = '00000000-0000-0000-0000-000000000000'

function scalar(value: unknown): string | null {
  return typeof value === 'string' ? `s:${JSON.stringify(value)}` : null
}

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [, year, month, day] = match
  const numericYear = Number(year)
  const numericMonth = Number(month)
  const numericDay = Number(day)
  const leap =
    numericYear % 4 === 0 &&
    (numericYear % 100 !== 0 || numericYear % 400 === 0)
  return (
    numericYear >= 1 &&
    numericMonth >= 1 &&
    numericMonth <= 12 &&
    numericDay >= 1 &&
    numericDay <=
      [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
        numericMonth - 1
      ]
  )
}

function encode(
  value: unknown,
  logicalType: RowIdentityLogicalType,
): string | null {
  switch (logicalType) {
    case 'text':
      return scalar(value)
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value)
        ? `i:${value}`
        : null
    case 'decimal':
      return typeof value === 'number' && Number.isFinite(value)
        ? `d:${value}`
        : null
    case 'boolean':
      return typeof value === 'boolean' ? `b:${value}` : null
    case 'date':
      return typeof value === 'string' && isCalendarDate(value)
        ? `d:${value}`
        : null
    case 'timestamp': {
      if (typeof value !== 'string') return null
      const match =
        /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
          value,
        )
      return match &&
        isCalendarDate(match[1]) &&
        Number(match[2]) <= 23 &&
        Number(match[3]) <= 59 &&
        Number(match[4]) <= 59 &&
        (value.endsWith('Z') ||
          (Number(match[5]) <= 23 && Number(match[6]) <= 59))
        ? `t:${value}`
        : null
    }
    case 'category':
    case 'reference':
      return typeof value === 'string' && uuid.test(value) && value !== nilUuid
        ? `u:${value.toLowerCase()}`
        : null
  }
}

function canonical(spec: RowIdentitySpec, values: unknown[]) {
  return JSON.stringify({
    v: ROW_IDENTITY_FORMAT_VERSION,
    kind: spec.kind,
    columns: spec.columnIds,
    types: spec.logicalTypes,
    values,
  })
}

export function rowIdentityKey(spec: RowIdentitySpec, values: unknown[]) {
  return `sb-row-v${ROW_IDENTITY_FORMAT_VERSION}:${createHash('sha256').update(canonical(spec, values)).digest('hex')}`
}

/** Resolves a batch without ever deriving identity from input order or labels. */
export function resolveRowIdentityBatch(
  spec: RowIdentitySpec,
  rows: Array<Record<string, unknown> & { localId?: string }>,
): RowIdentityBatchResult {
  const errors: RowIdentityError[] = []
  const validCardinality =
    spec.kind === 'composite'
      ? spec.columnIds.length >= 2 && spec.columnIds.length <= 8
      : spec.columnIds.length === 1
  if (
    !validCardinality ||
    spec.columnIds.length !== spec.logicalTypes.length ||
    new Set(spec.columnIds).size !== spec.columnIds.length ||
    (spec.kind === 'local' && spec.logicalTypes[0] !== 'reference')
  )
    return { ok: false, errors: [{ code: 'invalid', row: 0 }] }
  const keys = new Map<string, number>()
  const resolved: Array<{ key: string; localId?: string }> = []
  for (const [row, input] of rows.entries()) {
    const values: string[] = []
    if (spec.kind === 'local') {
      const localId = input.localId ?? randomUUID()
      if (!uuid.test(localId) || localId === nilUuid) {
        errors.push({ code: 'invalid', row, columnId: spec.columnIds[0] })
        continue
      }
      values.push(`u:${localId.toLowerCase()}`)
      const key = rowIdentityKey(spec, values)
      resolved.push({ key, localId })
      if (keys.has(key)) errors.push({ code: 'duplicate', row, key })
      else keys.set(key, row)
      continue
    }
    for (const [index, columnId] of spec.columnIds.entries()) {
      const value = input[columnId]
      if (value === undefined || value === null) {
        errors.push({ code: 'missing', row, columnId })
        continue
      }
      const encoded = encode(value, spec.logicalTypes[index])
      if (encoded === null) errors.push({ code: 'invalid', row, columnId })
      else values.push(encoded)
    }
    if (errors.some((error) => error.row === row)) continue
    const key = rowIdentityKey(spec, values)
    resolved.push({ key })
    if (keys.has(key)) errors.push({ code: 'duplicate', row, key })
    else keys.set(key, row)
  }
  return errors.length ? { ok: false, errors } : { ok: true, rows: resolved }
}
