/**
 * Shared scientific number formatting for notebook previews (ELN-004).
 *
 * Keeps metric values, table cells and counts readable and consistent with
 * the product mockups: thousands separators for integers (`23,100,000`),
 * scientific notation for very large or very small non-integers, sensible
 * precision for decimals, and human-readable file sizes (`12.6 MB`).
 *
 * The chart axis formatter (`formatScientific` in `chart-spec`) is a
 * separate, axis-tuned formatter; this module serves the document blocks.
 */
import { z } from 'zod'

/**
 * Format a numeric value for display in a metric, table cell or count.
 *
 * - Integers → thousands separators (`23,100,000`, `28`, `0`).
 * - Very large / very small non-integers → exponential with 2 sig figs.
 * - Other decimals → up to 3 significant digits.
 * - Non-finite → em dash.
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—'

  if (value === 0) return '0'

  if (Number.isInteger(value)) return value.toLocaleString('en-US')
  const abs = Math.abs(value)

  if (abs >= 1e6 || abs < 1e-3) {
    return value.toExponential(2).replace('e+', 'e').replace('e-0', 'e-')
  }

  if (abs >= 100) return value.toFixed(1)

  return Number(value.toPrecision(3)).toString()
}

/**
 * Format a numeric string the way a metric reads, or leave it exactly as it is
 * when it is not a number (`"4 °C"`, `"EXP-2025-0014"`).
 */
function formatNumericText(value: string): string {
  const trimmed = value.trim()

  if (trimmed === '') return value

  const parsed = Number(trimmed)

  return Number.isFinite(parsed) ? formatCount(parsed) : value
}

/** A stored value decoded into the alternatives these formatters render. */
type DisplayValue =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'other'; text: string }
  | { kind: 'absent' }

const storedScalar = z.union([
  z.number().transform((value): DisplayValue => ({ kind: 'number', value })),
  z.string().transform((value): DisplayValue => ({ kind: 'text', value })),
])

/** Decode a raw cell or metric value; anything else renders as its string form. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the decode step itself: it is the one place raw notebook JSON turns into the DisplayValue union.
function decodeDisplayValue(raw: unknown): DisplayValue {
  const parsed = storedScalar.safeParse(raw)

  if (parsed.success) return parsed.data

  if (raw == null) return { kind: 'absent' }

  // oxlint-disable-next-line typescript/no-base-to-string -- Booleans, arrays and structured cells have always rendered through their native string form here.
  return { kind: 'other', text: String(raw) }
}

/**
 * Format a metric value that may be stored as a number or a string.
 *
 * Numeric strings (e.g. `"23100000"`) are parsed and formatted; values that
 * are already human-readable strings (`"4 °C"`, `"EXP-2025-0014"`) are
 * returned unchanged so units and identifiers keep their original form.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Metric block values arrive as raw notebook JSON, which is what this formatter exists to render.
export function formatMetricValue(raw: unknown): string {
  const value = decodeDisplayValue(raw)

  switch (value.kind) {
    case 'number':
      return Number.isFinite(value.value) ? formatCount(value.value) : '—'
    case 'text':
      return formatNumericText(value.value)
    case 'other':
      return value.text
    case 'absent':
      return ''
  }
}

/**
 * Format a table cell value. Numbers are formatted with `formatCount`;
 * everything else is stringified. `null`/`undefined` → empty string so the
 * cell stays a stable, queryable element.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Cell values arrive as raw notebook JSON, which is what this formatter exists to render.
export function formatCellValue(raw: unknown): string {
  const value = decodeDisplayValue(raw)

  switch (value.kind) {
    case 'number':
      return Number.isFinite(value.value) ? formatCount(value.value) : '—'
    case 'text':
      return value.value
    case 'other':
      return value.text
    case 'absent':
      return ''
  }
}

/**
 * Human-readable file size using decimal-style units matching the product
 * mockups (`340 KB`, `12.6 MB`, `1.4 GB`). Bytes below 1 KiB show the raw
 * byte count.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'

  if (bytes < 1024) return `${bytes} B`

  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const SUPERSCRIPT = new Map([
  ['-', '⁻'],
  ['0', '⁰'],
  ['1', '¹'],
  ['2', '²'],
  ['3', '³'],
  ['4', '⁴'],
  ['5', '⁵'],
  ['6', '⁶'],
  ['7', '⁷'],
  ['8', '⁸'],
  ['9', '⁹'],
])

/** A number or numeric string, decoded once for the magnitude check below. */
const magnitudeValue = z.union([
  z.number(),
  z
    .string()
    .trim()
    .min(1)
    .transform((value) => Number(value)),
])

/**
 * A very large or very small number the way a scientist writes it
 * (`7.8 × 10¹¹`), or `undefined` for every number that reads fine as it is, so
 * the grid keeps its own rendering for those. Used for cells and the inspector,
 * where `780000000000` is unreadable.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Grid cells and inspector values arrive as raw notebook JSON, which is what this formatter exists to check.
export function formatMagnitude(raw: unknown): string | undefined {
  const parsed = magnitudeValue.safeParse(raw)
  const numeric = parsed.success ? parsed.data : Number.NaN

  if (!Number.isFinite(numeric) || numeric === 0) return undefined
  const abs = Math.abs(numeric)

  if (abs < 1e9 && abs >= 1e-4) return undefined

  const [mantissa, exponent] = numeric
    .toExponential(2)
    .replace(/\.?0+e/, 'e')
    .split('e')

  const power = String(Number(exponent))
  const superscript = Array.from(power, (c) => SUPERSCRIPT.get(c) ?? c).join('')

  return `${mantissa} × 10${superscript}`
}
