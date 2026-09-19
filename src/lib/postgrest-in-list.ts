/**
 * Chunked `in.()` id-list queries for the /api/db boundary.
 *
 * The same-origin proxy rejects any query-param value longer than
 * MAX_QUERY_VALUE_LENGTH (500 chars — postgrest-path.ts, a deliberate
 * mutation-safety bound). UUIDs are 36 chars, so an `in.()` list of more
 * than ~a dozen ids overflows the cap and the request 400s with
 * `invalid_path`. Chunking keeps every request under the cap; the per-chunk
 * pages are merged (and deduped when a filter can match a row twice).
 */
import type { DataClient } from './data-client'

/**
 * Default ids per request for single-column `in.()` filters: ten 36-char
 * UUIDs keep the filter value around 370 chars — comfortably under the
 * proxy's 500-char cap.
 */
export const IN_LIST_CHUNK_SIZE = 10

/**
 * Chunk size for filters that repeat the id list inside one value
 * (`or=(a.in.(…),b.in.(…))`): half the default keeps the doubled list
 * under the same cap.
 */
export const IN_LIST_OR_CHUNK_SIZE = 5

/** Split an id set into chunks small enough for one proxy-safe filter. */
export function chunkIds<T>(
  items: readonly T[],
  size: number = IN_LIST_CHUNK_SIZE,
): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/**
 * Issue one `list` request per id chunk and merge the pages in chunk order.
 * `buildQuery` receives the chunk's URL-encoded, comma-separated id list.
 *
 * Pass `dedupeBy` when a filter can match the same row from several chunks
 * (an `or` over two columns: a link whose source is in one chunk and target
 * in another is returned by both). Single-column `in.()` chunks are
 * disjoint and cannot duplicate rows, so they skip the key function.
 */
export async function listInIdChunks<T>(
  client: DataClient,
  resource: string,
  ids: readonly string[],
  buildQuery: (idList: string) => string,
  options: {
    chunkSize?: number
    dedupeBy?: (row: T) => string
  } = {},
): Promise<T[]> {
  const { chunkSize = IN_LIST_CHUNK_SIZE, dedupeBy } = options
  const pages = await Promise.all(
    chunkIds(ids, chunkSize).map((chunk) =>
      client.list<T>(
        resource,
        buildQuery(chunk.map((id) => encodeURIComponent(id)).join(',')),
      ),
    ),
  )
  const rows = pages.flat()
  if (!dedupeBy) return rows
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = dedupeBy(row)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
