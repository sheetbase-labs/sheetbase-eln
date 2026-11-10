import { z } from 'zod'

import type { FieldDefinition } from './field-definition'

/**
 * MODEL-02 shared field-value semantics.
 *
 * Single client-side value contract mirroring the server authority
 * (`internal.validate_model_fields` in former migration 0057). Record input
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

/** The decoded alternatives of one canonical value, matching JSON scalars. */
const scalarSchemas = {
  boolean: z.boolean(),
  decimal: z.number(),
  integer: z.int(),
  text: z.string(),
} as const

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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Record inputs and Sheet cells enter here as raw copied text or JSON; anything that does not coerce is returned unchanged so validation fails closed.
  raw: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- The uncoerced raw input is returned as it arrived (`raw` below); narrowing it would fabricate a value the caller did not supply.
): unknown {
  const numeric = scalarSchemas.decimal.safeParse(raw)

  if (numeric.success) return numeric.data

  const text = scalarSchemas.text.safeParse(raw)

  if (!text.success) return raw

  const withoutUnit = stripUnitSuffix(
    text.data.trim(),
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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the shared client-side canonical-value boundary: it decides acceptance of raw record and Sheet input, so the raw value enters unparsed by design.
  value: unknown,
): string | null {
  switch (field.logicalType) {
    // A category value is an option id or key (the server matches keys). A
    // non-matching UUID-shaped value names a dead option; any other scalar is
    // not a category value at all, matching the Sheet cell codes.
    case 'category': {
      const categoryValue = scalarSchemas.text.safeParse(value)

      if (!categoryValue.success) return 'invalid_value'

      const options =
        field.category?.kind === 'embedded' ? field.category.options : []

      const match = options.some(
        (option) =>
          (option.id === categoryValue.data ||
            option.key === categoryValue.data) &&
          option.lifecycle === 'active',
      )

      if (!match)
        return isUuid(categoryValue.data)
          ? 'invalid_category_option'
          : 'invalid_value'

      return null
    }

    case 'text': {
      const text = scalarSchemas.text.safeParse(value)

      if (!text.success) return 'invalid_value'

      if (
        (field.validation.minLength !== undefined &&
          text.data.length < field.validation.minLength) ||
        (field.validation.maxLength !== undefined &&
          text.data.length > field.validation.maxLength) ||
        (field.validation.pattern !== undefined &&
          !new RegExp(field.validation.pattern).test(text.data))
      )
        return 'text_validation'

      return null
    }

    case 'integer': {
      const integer = scalarSchemas.integer.safeParse(value)

      if (!integer.success) return 'invalid_value'

      return outsideNumericRange(field, integer.data)
        ? 'numeric_validation'
        : null
    }

    case 'decimal': {
      const decimal = scalarSchemas.decimal.safeParse(value)

      if (!decimal.success) return 'invalid_value'

      return outsideNumericRange(field, decimal.data)
        ? 'numeric_validation'
        : null
    }

    case 'boolean':
      return scalarSchemas.boolean.safeParse(value).success
        ? null
        : 'invalid_value'
    case 'date': {
      const date = scalarSchemas.text.safeParse(value)

      return date.success && isValidCalendarDate(date.data)
        ? null
        : 'invalid_value'
    }

    case 'timestamp': {
      const timestamp = scalarSchemas.text.safeParse(value)

      return timestamp.success && isValidTimestamp(timestamp.data)
        ? null
        : 'invalid_value'
    }

    case 'reference': {
      const reference = scalarSchemas.text.safeParse(value)

      return reference.success && isUuid(reference.data)
        ? null
        : 'invalid_value'
    }
  }
}

function outsideNumericRange(field: FieldDefinition, value: number): boolean {
  return (
    (field.validation.min !== undefined && value < field.validation.min) ||
    (field.validation.max !== undefined && value > field.validation.max)
  )
}

/**
 * Full client-side value contract including nullability/defaults and
 * cardinality, mirroring `internal.validate_model_fields` null/required
 * handling. Reference existence stays server-side.
 */
export function validateFieldValue(
  field: FieldDefinition,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the shared client-side field-value boundary; nullability, cardinality and scalar acceptance are decided here for raw record and Sheet input.
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
