import { safeReturnTo } from '#/lib/create-context-search'
import { z } from 'zod'

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
  sheet?: string
  units?: string
  /** The project the import was started from (shared create-context param). */
  project?: string
  /** An in-app path the finished or cancelled import goes back to. */
  returnTo?: string
}

const optionalText = z.string().min(1).optional().catch(undefined)

const searchSchema = z.object({
  step: z.enum(['map', 'check']).optional().catch(undefined),
  dataset: optionalText,
  experiment: optionalText,
  instrument: optionalText,
  parser: optionalText,
  map: optionalText,
  sheet: optionalText,
  units: optionalText,
  project: optionalText,
  returnTo: z.unknown().transform(safeReturnTo).optional(),
})

/** Parse the raw search record; unknown or malformed values are dropped. */
export const parseImportSearch = searchSchema.parse.bind(searchSchema)

/** Compact, URL-safe `source:field` pairs; skipped columns carry no pair. */
export function serializeImportMapping(
  values: Record<string, string>,
  keepEmpty = false,
): string {
  return Object.entries(values)
    .filter(([, fieldId]) => keepEmpty || Boolean(fieldId))
    .map(
      ([source, fieldId]) =>
        `${encodeURIComponent(source)}:${encodeURIComponent(fieldId)}`,
    )
    .join(',')
}

export function parseImportMapping(value: string | undefined) {
  if (!value) return {}
  const values: Record<string, string> = {}

  for (const pair of value.split(',')) {
    const separator = pair.indexOf(':')

    if (separator <= 0) continue

    try {
      const source = decodeURIComponent(pair.slice(0, separator))
      const fieldId = decodeURIComponent(pair.slice(separator + 1))

      if (source) values[source] = fieldId
    } catch {
      // A malformed pair is ignored rather than failing the whole link.
    }
  }

  return values
}
