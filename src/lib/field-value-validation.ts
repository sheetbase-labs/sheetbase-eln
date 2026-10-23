import type { FieldDefinition } from './field-definition'

/**
 * MODEL-02 shared field-value semantics.
 *
 * Single client-side value contract mirroring the server authority
 * (`internal.validate_model_fields` in drizzle/0057). Record input
 * (`parseModelFieldInput`/`validateModelFieldValue`), Sheet cells
 * (`parseSheetCellInput`/`validateCanonicalCell` via `sheetLocalValueError`)
 * and the parity suite all funnel through here — no second rules engine.
 *
 * Canonical-value notes:
 * - Category cells persist the option id (see `parseSheetCellInput`);
 *   the server matches option keys, so the membership check accepts an
 *   active option by id or key. Human labels/keys are normalised to the id
 *   by the Sheet parser before validation.
 * - Reference existence/model compatibility stays an authoritative server
 *   check; here we only enforce the stable-ID shape (UUID, never the
 *   human Record ID or Name).
 * - `validation.pattern` is the kernel name for the server's `regex`
 *   validation key (see `modelFieldValidationForServer`).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export function isValidCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE_RE.exec(value)
  if (!match) return false
  const [, year, month, day] = match.map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <=
      [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  )
}

export function isValidTimestamp(value: string): boolean {
  const match = TIMESTAMP_RE.exec(value)
  if (!match) return false
  return (
    isValidCalendarDate(`${match[1]}-${match[2]}-${match[3]}`) &&
    Number(match[4]) <= 23 &&
    Number(match[5]) <= 59 &&
    Number(match[6]) <= 59 &&
    (value.endsWith('Z') || (Number(match[7]) <= 23 && Number(match[8]) <= 59))
  )
}

/** Only the storage-unit suffix is safe without a unit converter. */
export function fieldUnitSymbols(field: FieldDefinition): string[] {
  return field.quantity?.storageUnit ? [field.quantity.storageUnit] : []
}

/** Raw stored magnitudes must be labelled with their storage unit. */
export function fieldDisplayUnit(
  field: FieldDefinition,
  legacySymbol?: string | null,
): string | null {
  return field.quantity?.storageUnit ?? legacySymbol ?? null
}

function stripUnitSuffix(trimmed: string, symbols: string[]): string {
  const ordered = [...symbols].sort((a, b) => b.length - a.length)
  for (const symbol of ordered) {
    if (!symbol) continue
    if (trimmed.endsWith(symbol)) {
      const head = trimmed.slice(0, trimmed.length - symbol.length).trimEnd()
      if (head !== '' && /[\d.]$/.test(head)) return head
    }
  }
  return trimmed
}

/**
 * Shared numeric coercion for integer/decimal fields. Strips the exact
 * storage-unit suffix (`12.5 mg/mL` → 12.5), then applies the canonical
 * plain/thousands-separated parsing both Record and Sheet inputs share.
 * Other units stay unparsed: allowed/preferred metadata is not a converter.
 * Returns the raw input when it does not coerce so validation fails closed.
 */
export function parseQuantityNumericValue(
  field: FieldDefinition,
  raw: unknown,
): unknown {
  if (typeof raw === 'number') return raw
  if (typeof raw !== 'string') return raw
  const withoutUnit = stripUnitSuffix(
    raw.trim(),
    fieldUnitSymbols(field),
  ).trim()
  if (field.logicalType === 'integer') {
    if (/^-?\d+$/.test(withoutUnit)) return Number(withoutUnit)
    // Thousands-separated clipboard values coerce when the grouping is
    // unambiguous; anything else fails closed.
    if (/^-?\d{1,3}(,\d{3})+$/.test(withoutUnit))
      return Number(withoutUnit.replace(/,/g, ''))
    return raw
  }
  if (field.logicalType === 'decimal') {
    if (withoutUnit !== '' && !Number.isNaN(Number(withoutUnit)))
      return Number(withoutUnit)
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(withoutUnit))
      return Number(withoutUnit.replace(/,/g, ''))
    return raw
  }
  return raw
}

/**
 * Scalar contract for one canonical value. Error codes match the
 * long-standing Sheet local codes so existing surfaces keep their copy:
 * `invalid_value`, `text_validation`, `numeric_validation`,
 * `invalid_category_option`.
 */
export function fieldScalarError(
  field: FieldDefinition,
  value: unknown,
): string | null {
  // A category value is an option id or key (the server matches keys). A
  // non-matching UUID-shaped value names a dead option; any other scalar is
  // not a category value at all, matching the Sheet cell codes.
  if (field.logicalType === 'category') {
    if (typeof value !== 'string') return 'invalid_value'
    const options =
      field.category?.kind === 'embedded' ? field.category.options : []
    const match = options.some(
      (option) =>
        (option.id === value || option.key === value) &&
        option.lifecycle === 'active',
    )
    if (!match)
      return isUuid(value) ? 'invalid_category_option' : 'invalid_value'
    return null
  }
  const valid =
    field.logicalType === 'text'
      ? typeof value === 'string'
      : field.logicalType === 'integer'
        ? typeof value === 'number' && Number.isSafeInteger(value)
        : field.logicalType === 'decimal'
          ? typeof value === 'number' && Number.isFinite(value)
          : field.logicalType === 'boolean'
            ? typeof value === 'boolean'
            : field.logicalType === 'date'
              ? typeof value === 'string' && isValidCalendarDate(value)
              : field.logicalType === 'timestamp'
                ? typeof value === 'string' && isValidTimestamp(value)
                : typeof value === 'string' && isUuid(value)
  if (!valid) return 'invalid_value'
  if (
    field.logicalType === 'text' &&
    typeof value === 'string' &&
    ((field.validation.minLength !== undefined &&
      value.length < field.validation.minLength) ||
      (field.validation.maxLength !== undefined &&
        value.length > field.validation.maxLength) ||
      (field.validation.pattern !== undefined &&
        !new RegExp(field.validation.pattern).test(value)))
  )
    return 'text_validation'
  if (
    (field.logicalType === 'integer' || field.logicalType === 'decimal') &&
    typeof value === 'number' &&
    ((field.validation.min !== undefined && value < field.validation.min) ||
      (field.validation.max !== undefined && value > field.validation.max))
  )
    return 'numeric_validation'
  return null
}

/**
 * Full client-side value contract including nullability/defaults and
 * cardinality, mirroring `internal.validate_model_fields` null/required
 * handling. Reference existence stays server-side.
 */
export function validateFieldValue(
  field: FieldDefinition,
  value: unknown,
): string | null {
  if (value === null)
    return field.nullable || field.defaultValue !== null
      ? null
      : 'required_value'
  const values = field.cardinality === 'many' ? value : [value]
  if (!Array.isArray(values) || values.length === 0 || values.length > 1_000)
    return 'invalid_cardinality'
  if (field.cardinality === 'one' && Array.isArray(value))
    return 'invalid_cardinality'
  for (const item of values) {
    const error = fieldScalarError(field, item)
    if (error) return error
  }
  return null
}
