/**
 * A list's read has failed, with nothing earlier to show. A refetch that fails
 * over rows already on screen keeps the rows.
 */
export function listFailed(query: {
  isError: boolean
  data: unknown
}): boolean {
  return query.isError && query.data === undefined
}
