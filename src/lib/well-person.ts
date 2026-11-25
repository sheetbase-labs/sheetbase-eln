/**
 * Well position and person values, shared by every surface that reads or
 * writes them (record forms, sheets, imports, the assistant, pipelines).
 *
 * The database is the authority (`internal.lab_well_or_null`,
 * `internal.lab_is_workspace_person`); these helpers apply the same rules so
 * a person sees the problem before saving.
 *
 * - A well position is a plate address stored as `A1` (`a01`, `A01` and
 *   `a 1` are all `A1`), for plates up to 1536 wells: rows A to AF, columns
 *   1 to 48. It sorts row by row, so A2 comes before A10.
 * - A person is someone in the workspace, stored as their user id and shown
 *   by name.
 */

const WELL_RE = /^([A-Z]{1,2})0*([1-9]\d?)$/

/** The largest plate: 32 rows (A to AF) by 48 columns. */
export const MAX_WELL_ROWS = 32
export const MAX_WELL_COLUMNS = 48

function rowNumber(label: string): number {
  let row = 0

  for (const ch of label) row = row * 26 + (ch.charCodeAt(0) - 64)

  return row
}

/** `A1` for a typed well position, or null when it is not one. */
export function parseWellPosition(input: string): string | null {
  const match = WELL_RE.exec(input.replace(/\s/g, '').toUpperCase())

  if (!match) return null

  const row = rowNumber(match[1])
  const column = Number(match[2])

  if (row > MAX_WELL_ROWS || column > MAX_WELL_COLUMNS) return null

  return `${match[1]}${column}`
}

/** True for a stored well position (`A1`, never `A01`). */
export function isWellPosition(value: string): boolean {
  return parseWellPosition(value) === value
}

/** Row-major order: A1, A2 ... A12, B1. */
export function compareWellPositions(a: string, b: string): number {
  return wellSortKey(a) - wellSortKey(b)
}

function wellSortKey(value: string): number {
  const match = /^([A-Z]{1,2})(\d{1,2})$/.exec(value)

  if (!match) return Number.MAX_SAFE_INTEGER

  return rowNumber(match[1]) * 100 + Number(match[2])
}

/** Typed text for a well position field as its stored value, or the text unchanged. */
export function wellFromText(text: string): string {
  return parseWellPosition(text) ?? text
}

/**
 * A person's name for a stored user id. A user id the workspace no longer
 * knows still shows, so history never goes blank.
 */
export function personName(
  userId: string,
  names: ReadonlyMap<string, string> | undefined,
): string {
  return names?.get(userId) ?? userId
}

/** The user id for typed text: an id as it is, or a unique member name. */
export function personFromText(
  text: string,
  names: ReadonlyMap<string, string> | undefined,
): string {
  const trimmed = text.trim()

  if (!names || names.has(trimmed)) return trimmed

  const wanted = trimmed.toLowerCase()

  const matches = [...names].filter(
    ([, name]) => name.trim().toLowerCase() === wanted,
  )

  return matches.length === 1 ? matches[0][0] : trimmed
}
