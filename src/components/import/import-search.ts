/**
 * R5-SURF-04 — the flow's addressable state. The path identifies the retained
 * import file (the identity the commit path pins as `p_file_id`); the search
 * pins the same target the commit uses (Dataset, parser, mapping) plus the
 * experiment and instrument the receipt records. Everything the server needs
 * to re-derive validity is either on the file row or in these pins, so a link
 * reloads the same step with the same mapping, and the server stays the
 * authority on whether it is valid.
 */
export interface ImportSearch {
  step?: 'map' | 'check'
  dataset?: string
  experiment?: string
  instrument?: string
  parser?: string
  map?: string
}

/** Parse the raw search record; unknown or malformed values are dropped. */
export function parseImportSearch(
  search: Record<string, unknown>,
): ImportSearch {
  const text = (value: unknown) =>
    typeof value === 'string' && value ? value : undefined
  return {
    step:
      search.step === 'check'
        ? 'check'
        : search.step === 'map'
          ? 'map'
          : undefined,
    dataset: text(search.dataset),
    experiment: text(search.experiment),
    instrument: text(search.instrument),
    parser: text(search.parser),
    map: text(search.map),
  }
}

/** Compact, URL-safe `source:field` pairs; skipped columns carry no pair. */
export function serializeImportMapping(values: Record<string, string>): string {
  return Object.entries(values)
    .filter(([, fieldId]) => Boolean(fieldId))
    .map(
      ([source, fieldId]) =>
        `${encodeURIComponent(source)}:${encodeURIComponent(fieldId)}`,
    )
    .join(',')
}

export function parseImportMapping(
  value: string | undefined,
): Record<string, string> {
  if (!value) return {}
  const values: Record<string, string> = {}
  for (const pair of value.split(',')) {
    const separator = pair.indexOf(':')
    if (separator <= 0) continue
    try {
      const source = decodeURIComponent(pair.slice(0, separator))
      const fieldId = decodeURIComponent(pair.slice(separator + 1))
      if (source && fieldId) values[source] = fieldId
    } catch {
      // A malformed pair is ignored rather than failing the whole link.
    }
  }
  return values
}
