/**
 * The proxy refuses a query value over 500 characters, so an `in.(…)` filter
 * over many ids is read in groups. Twelve uuids is 443 characters.
 */
export function chunkIds(ids: readonly string[], size = 12): string[][] {
  const groups: string[][] = []
  for (let i = 0; i < ids.length; i += size) groups.push(ids.slice(i, i + size))
  return groups
}

/**
 * Read one query per group of ids and join the rows, in id order. The callback
 * receives the group as a ready `in.(…)` body (ids already URL-encoded).
 */
export async function listByIds<T>(
  ids: readonly string[],
  read: (inList: string) => Promise<T[]>,
  size = 12,
): Promise<T[]> {
  const groups = chunkIds([...new Set(ids)], size)
  const parts = await Promise.all(
    groups.map((group) => read(group.map(encodeURIComponent).join(','))),
  )
  return parts.flat()
}
