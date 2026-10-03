/**
 * DATA-02 delimited (CSV/TSV) serializers.
 *
 * These helpers are dependency-free so client code can build a CSV without
 * pulling the node-only export stack (`zip.ts` uses `node:zlib`) into the
 * browser bundle. `serializers.ts` re-exports them for the server export path.
 */

export interface ExportField {
  /** Stable field identity (uuid) — doubles as the raw values key. */
  id: string
  key: string
  label: string
  logicalType: string
  nullable: boolean
  /** Display unit from canonical quantity metadata (e.g. storageUnit). */
  unit: string | null
}

/** Canonical Dataset row mapped onto machine-readable field keys. */
export interface ExportRow {
  rowId: string
  revision: number | string
  values: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Value formatting.
// ---------------------------------------------------------------------------

/**
 * Render one typed cell for delimited output. Category/reference values stay
 * as their stable option/target ids; resolving them to display labels would
 * require a second read path, so exports keep stable identities.
 */
export function formatCell(field: ExportField, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (field.logicalType === 'boolean') {
    if (value === true) return 'true'
    if (value === false) return 'false'
  }
  return typeof value === 'string' ? value : String(value)
}

export function csvEscape(text: string, delimiter: string): string {
  if (
    text.includes('"') ||
    text.includes(delimiter) ||
    text.includes('\n') ||
    text.includes('\r')
  ) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

export function delimitedHeaderLine(
  fields: ExportField[],
  delimiter: string,
): string {
  return fields.map((f) => csvEscape(f.label, delimiter)).join(delimiter)
}

export function delimitedRowLine(
  fields: ExportField[],
  row: ExportRow,
  delimiter: string,
): string {
  return fields
    .map((f) => csvEscape(formatCell(f, row.values[f.id]), delimiter))
    .join(delimiter)
}
