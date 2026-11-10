/** The sorts a list offers when it has no dates or counts of its own. */
export const nameSorts = ['Name', 'ID'] as const

export type NameSort = (typeof nameSorts)[number]

/** A copy ordered by name or identifier, with numbers in natural order. */
export function sortByName<T>(
  rows: readonly T[],
  sort: NameSort,
  name: (row: T) => string,
  id: (row: T) => string,
): T[] {
  const key = sort === 'ID' ? id : name

  return [...rows].sort((a, b) =>
    key(a).localeCompare(key(b), 'en-GB', { numeric: true }),
  )
}

/** The same count and qualifier the list shows in its footer. */
export function footerCount({
  shown,
  total,
  one,
  many = `${one}s`,
  tab,
  query,
}: {
  shown: number
  total: number
  one: string
  many?: string
  tab?: string
  query?: string
}) {
  const noun = total === 1 ? one : many

  const qualifier =
    tab && tab.toLowerCase() !== 'all' ? ` · ${tab.toLowerCase()}` : ''

  if (query)
    return `${shown} matching “${query}” of ${total} ${noun}${qualifier}`

  if (shown !== total) return `${shown} of ${total} ${noun}${qualifier}`

  return `${total} ${noun}${qualifier}`
}
