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
 * Format a metric value that may be stored as a number or a string.
 *
 * Numeric strings (e.g. `"23100000"`) are parsed and formatted; values that
 * are already human-readable strings (`"4 °C"`, `"EXP-2025-0014"`) are
 * returned unchanged so units and identifiers keep their original form.
 */
export function formatMetricValue(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? formatCount(value) : '—'
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed !== '') {
      const parsed = Number(trimmed)
      if (Number.isFinite(parsed)) return formatCount(parsed)
    }
    return value
  }
  return value == null ? '' : String(value)
}

/**
 * Format a table cell value. Numbers are formatted with `formatCount`;
 * everything else is stringified. `null`/`undefined` → empty string so the
 * cell stays a stable, queryable element.
 */
export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') {
    return Number.isFinite(value) ? formatCount(value) : '—'
  }
  return String(value)
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
