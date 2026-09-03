import type { ScientificLogicalType } from './scientific-sheet-data'

export const SHEETBASE_LITERAL_PROFILE = 'sheetbase-literal-v1' as const
export type ScientificScalar = string | number | boolean | null
export type LiteralCodecResult =
  | { ok: true; value: ScientificScalar }
  | { ok: false; code: 'VALUE'; message: string }
const DAY = 86_400_000
const NULL_DATE = Date.UTC(1899, 11, 30)
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/
const timestampPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/

function utc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
) {
  const value = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  )
  const check = new Date(value)
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    throw new Error('Invalid ISO date/time components.')
  return value
}
function dateSerial(value: string) {
  const match = datePattern.exec(value)
  if (!match) throw new Error('Date must be ISO YYYY-MM-DD.')
  return (
    (utc(Number(match[1]), Number(match[2]), Number(match[3])) - NULL_DATE) /
    DAY
  )
}
function timestampSerial(value: string) {
  const match = timestampPattern.exec(value)
  if (!match)
    throw new Error('Timestamp must be RFC 3339 with an explicit offset.')
  // RegExpExecArray does not model optional capture groups accurately.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const milliseconds = Number((match[7] ?? '').padEnd(3, '0'))
  let instant = utc(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    milliseconds,
  )
  if (match[8] !== 'Z') {
    const offsetHours = Number(match[8].slice(1, 3)),
      offsetMinutes = Number(match[8].slice(4))
    if (offsetHours > 23 || offsetMinutes > 59)
      throw new Error('Timestamp has an invalid UTC offset.')
    const sign = match[8][0] === '+' ? 1 : -1
    instant -= sign * (offsetHours * 60 + offsetMinutes) * 60_000
  }
  return (instant - NULL_DATE) / DAY
}
function safeNumber(value: unknown, integer: boolean) {
  const text = typeof value === 'number' ? String(value) : String(value)
  if (integer && !/^[+-]?\d+$/.test(text))
    throw new Error('Integer input is not an integer.')
  if (!integer && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(text))
    throw new Error('Decimal input is not numeric.')
  const digits = text
    .replace(/^[+-]/, '')
    .split(/[Ee]/)[0]
    .replace('.', '')
    .replace(/^0+/, '')
  if (digits.length > 15)
    throw new Error('Numeric input has more than 15 significant digits.')
  const number = Number(text)
  if (!Number.isFinite(number) || (integer && !Number.isSafeInteger(number)))
    throw new Error('Numeric input is outside the safe range.')
  return number
}

/** Converts authoritative values to safe raw HF input. Apostrophe forces text/category literals. */
export function encodeScientificLiteral(
  type: ScientificLogicalType,
  value: unknown,
): string | number | boolean | null {
  if (value === null || value === undefined) return null
  switch (type) {
    case 'text':
    case 'category':
    case 'reference':
      return `'${String(value)}`
    case 'integer':
      return safeNumber(value, true)
    case 'decimal':
      return safeNumber(value, false)
    case 'boolean':
      if (typeof value !== 'boolean')
        throw new Error('Boolean input must be a Boolean.')
      return value
    case 'date':
      return dateSerial(String(value))
    case 'timestamp':
      return timestampSerial(String(value))
  }
}
const isoDate = (serial: number) =>
  new Date(NULL_DATE + serial * DAY).toISOString().slice(0, 10)
const isoTimestamp = (serial: number) =>
  new Date(NULL_DATE + serial * DAY).toISOString()

/** Validates a derived scalar against its logical SQL target; never implicitly casts. */
export function decodeScientificResult(
  type: ScientificLogicalType,
  value: string | number | boolean | null,
  categoryOptionIds?: readonly string[],
): LiteralCodecResult {
  if (value === null) return { ok: true, value: null }
  try {
    switch (type) {
      case 'text':
        if (typeof value !== 'string') throw new Error('Expected text result.')
        return { ok: true, value }
      case 'reference':
        if (typeof value !== 'string')
          throw new Error('Expected reference UUID result.')
        return { ok: true, value }
      case 'category':
        if (typeof value !== 'string')
          throw new Error('Expected category UUID result.')
        if (!categoryOptionIds?.includes(value))
          throw new Error('Expected an active option of the target category.')
        return { ok: true, value }
      case 'boolean':
        if (typeof value !== 'boolean')
          throw new Error('Expected Boolean result.')
        return { ok: true, value }
      case 'integer':
        if (typeof value !== 'number' || !Number.isSafeInteger(value))
          throw new Error('Expected a safe integer result.')
        return { ok: true, value }
      case 'decimal':
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          String(value).replace(/\D/g, '').length > 15
        )
          throw new Error('Expected a safe decimal result.')
        return { ok: true, value }
      case 'date':
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          !Number.isInteger(value)
        )
          throw new Error('Expected an integral date serial.')
        return { ok: true, value: isoDate(value) }
      case 'timestamp':
        if (typeof value !== 'number' || !Number.isFinite(value))
          throw new Error('Expected a timestamp serial.')
        return { ok: true, value: isoTimestamp(value) }
    }
  } catch (error) {
    return {
      ok: false,
      code: 'VALUE',
      message: error instanceof Error ? error.message : 'Invalid result.',
    }
  }
}
