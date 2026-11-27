import { z } from 'zod'

import { chunkIds } from '#/lib/chunk-ids'

/** The proxy refuses a query value over 500 characters; stay under it. */
const MAX_VALUE = 480

/**
 * Split a list query whose `column=in.(…)` filter is too long for the proxy
 * into several queries, so no screen has to remember to group its ids. Returns
 * null when the query does not need it (or cannot be split safely).
 */
export function splitLongInQuery(query: string): string[] | null {
  if (!query.startsWith('?') || query.length < MAX_VALUE) return null
  const params = new URLSearchParams(query.slice(1))
  let target: string | null = null

  for (const [key, value] of params) {
    if (
      value.length > MAX_VALUE &&
      value.startsWith('in.(') &&
      value.endsWith(')') &&
      !value.slice(4, -1).includes('(')
    ) {
      // Two oversize filters would multiply; leave those to the caller.
      if (target) return null
      target = key
    } else if (value.length > MAX_VALUE) {
      return null
    }
  }

  if (!target) return null
  const raw = params.get(target) ?? ''
  const ids = raw.slice(4, -1).split(',')
  const queries: string[] = []

  for (const group of chunkIds(ids, 10)) {
    const next = new URLSearchParams()

    for (const [key, value] of params)
      next.append(key, key === target ? `in.(${group.join(',')})` : value)
    // PostgREST filters are plain `key=value`; keep `in.(…)` and commas readable.
    queries.push(
      `?${next.toString().replace(/%28/g, '(').replace(/%29/g, ')').replace(/%2C/gi, ',')}`,
    )
  }

  return queries
}

const rowSchema = z.record(z.string(), z.unknown())
const cellSchema = z.union([z.string(), z.number()]).nullable().catch(null)

type Cell = z.infer<typeof cellSchema>

type Row = z.infer<typeof rowSchema>

/** One named column of a row, as text, a number or nothing. */
function cell(row: Row, column: string): Cell {
  return cellSchema.parse(row[column])
}

function compare(a: Cell, b: Cell): number {
  if (a === b) return 0

  if (a === null) return 1

  if (b === null) return -1

  const numbers = z.tuple([z.number(), z.number()]).safeParse([a, b])

  if (numbers.success) return numbers.data[0] - numbers.data[1]

  return String(a) < String(b) ? -1 : 1
}

/** Put merged chunks back in the order the query asked for, when it can. */
export function mergeChunkedRows<T extends object>(
  query: string,
  parts: T[][],
): T[] {
  const rows = parts.flat()
  const params = new URLSearchParams(query.slice(1))
  const order = params.get('order')
  const limit = Number(params.get('limit'))

  if (order) {
    const keys = order.split(',').map((part) => {
      const [column = '', direction = 'asc'] = part.split('.')

      return { column, desc: direction === 'desc' }
    })

    const paired = rows.map((row) => ({
      row,
      data: rowSchema.safeParse(row).data ?? {},
    }))

    const sortable =
      paired[0] && keys.every((key) => key.column in paired[0].data)

    if (sortable) {
      paired.sort((a, b) => {
        for (const key of keys) {
          const result = compare(
            cell(a.data, key.column),
            cell(b.data, key.column),
          )

          if (result !== 0) return key.desc ? -result : result
        }

        return 0
      })

      return limited(
        paired.map((pair) => pair.row),
        limit,
      )
    }
  }

  return limited(rows, limit)
}

function limited<T>(rows: T[], limit: number): T[] {
  return Number.isFinite(limit) && limit > 0 ? rows.slice(0, limit) : rows
}
