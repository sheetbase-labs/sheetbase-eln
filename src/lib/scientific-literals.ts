import { z } from 'zod'
import type { ScientificLogicalType } from './scientific-sheet-data'

export const SHEETBASE_LITERAL_PROFILE = 'sheetbase-literal-v1' as const

export type ScientificScalar = string | number | boolean | null

export type LiteralCodecResult =
  | { ok: true; value: ScientificScalar }
  | { ok: false; code: 'VALUE'; message: string }

const DAY = 86_400_000

/** Excel serial epoch (`nullDate` 1899-12-30) shared with the package engine. */
export const SCIENTIFIC_SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30)
const NULL_DATE = SCIENTIFIC_SERIAL_EPOCH_MS
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/

const timestampPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/

const literalTextInput = z.unknown().transform((value) => String(value))
const stringInput = z.string()
const booleanInput = z.boolean()

const numberInput = z.union([
  z.number(),
  z.nan(),
  z.literal(Infinity),
  z.literal(-Infinity),
])

function isString(value: unknown): value is string {
  return stringInput.safeParse(value).success
}

function isBoolean(value: unknown): value is boolean {
  return booleanInput.safeParse(value).success
}

function isNumber(value: unknown): value is number {
  return numberInput.safeParse(value).success
}

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

function safeNumber(text: string, integer: boolean) {
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

/** Converts authoritative values to the engine's scalar input. Dates and timestamps become serials. */
export function encodeScientificLiteral(
  type: ScientificLogicalType,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the raw literal codec boundary: each logical type below applies its historical native String coercion or exact Boolean check without restricting scientific input beforehand.
  value: unknown,
): ScientificScalar {
  if (value === null || value === undefined) return null

  switch (type) {
    case 'text':
    case 'category':
    case 'reference':
      return literalTextInput.parse(value)
    case 'integer':
      return safeNumber(literalTextInput.parse(value), true)
    case 'decimal':
      return safeNumber(literalTextInput.parse(value), false)
    case 'boolean':
      if (!isBoolean(value)) throw new Error('Boolean input must be a Boolean.')

      return value
    case 'date':
      return dateSerial(literalTextInput.parse(value))
    case 'timestamp':
      return timestampSerial(literalTextInput.parse(value))
  }
}

/**
 * Normalizes an engine scalar to the persisted scalar shape. The engine carries
 * constructed dates as `Date`; storage and citation carry the Excel serial, so
 * the adapter converts at this boundary and never changes the persisted value.
 */
export function normalizeEngineScalar(
  value: ScientificScalar | Date,
): ScientificScalar
export function normalizeEngineScalar<Value>(value: Value): Value | number
export function normalizeEngineScalar<Value>(value: Value): Value | number {
  if (value instanceof Date) return (value.getTime() - NULL_DATE) / DAY

  return value
}

const isoDate = (serial: number) =>
  new Date(NULL_DATE + serial * DAY).toISOString().slice(0, 10)

const isoTimestamp = (serial: number) =>
  new Date(NULL_DATE + serial * DAY).toISOString()

/** Validates a derived scalar against its logical SQL target; never implicitly casts. */
export function decodeScientificResult(
  type: ScientificLogicalType,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Engine outputs enter here before logical SQL-target validation; schema-backed scalar checks below preserve ordered type-specific VALUE diagnostics for malformed native results.
  value: unknown,
  categoryOptionIds?: readonly string[],
): LiteralCodecResult {
  if (value === null) return { ok: true, value: null }

  try {
    switch (type) {
      case 'text':
        if (!isString(value)) throw new Error('Expected text result.')

        return { ok: true, value }
      case 'reference':
        if (!isString(value)) throw new Error('Expected reference UUID result.')

        return { ok: true, value }
      case 'category':
        if (!isString(value)) throw new Error('Expected category UUID result.')

        if (!categoryOptionIds?.includes(value))
          throw new Error('Expected an active option of the target category.')

        return { ok: true, value }
      case 'boolean':
        if (!isBoolean(value)) throw new Error('Expected Boolean result.')

        return { ok: true, value }
      case 'integer':
        if (!isNumber(value) || !Number.isSafeInteger(value))
          throw new Error('Expected a safe integer result.')

        return { ok: true, value }
      case 'decimal':
        if (
          !isNumber(value) ||
          !Number.isFinite(value) ||
          String(value).replace(/\D/g, '').length > 15
        )
          throw new Error('Expected a safe decimal result.')

        return { ok: true, value }
      case 'date':
        if (
          !isNumber(value) ||
          !Number.isFinite(value) ||
          !Number.isInteger(value)
        )
          throw new Error('Expected an integral date serial.')

        return { ok: true, value: isoDate(value) }
      case 'timestamp':
        if (!isNumber(value) || !Number.isFinite(value))
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
