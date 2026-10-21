/**
 * The proxy refuses a query value over 500 characters, so an `in.(…)` filter
 * over many ids is read in groups. Twelve uuids is 443 characters.
 */
export function chunkIds(ids: readonly string[], size = 12): string[][] {
  const groups: string[][] = []
  for (let i = 0; i < ids.length; i += size) groups.push(ids.slice(i, i + size))
  return groups
}
