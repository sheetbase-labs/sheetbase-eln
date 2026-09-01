/**
 * Async pagination iterators for the Sheetbase SDK.
 *
 * PostgREST table reads use `limit`/`offset` query parameters.
 * RPC data windows embed pagination markers in the response body:
 * `query_dataset_rows` / `search` report `hasMore`, while
 * `query_dataset_version_rows` reports `totalCount` only.
 */

export type TablePageFetcher = (limit: number, offset: number) => Promise<Record<string, any>[]>;
export type RpcPageFetcher = (limit: number, offset: number) => Promise<Record<string, any>>;

export async function* iterTable(
  fetchPage: TablePageFetcher,
  options?: { pageSize?: number; maxItems?: number },
): AsyncGenerator<Record<string, any>> {
  const pageSize = options?.pageSize ?? 100;
  const maxItems = options?.maxItems ?? null;
  let offset = 0;
  let yielded = 0;

  while (true) {
    const remaining = maxItems === null ? null : maxItems - yielded;
    const limit = remaining === null ? pageSize : Math.min(pageSize, remaining);
    if (limit <= 0) break;

    const page = await fetchPage(limit, offset);
    if (page.length === 0) break;

    for (const row of page) {
      yield row;
      yielded++;
      if (maxItems !== null && yielded >= maxItems) return;
    }

    if (page.length < limit) break;
    offset += page.length;
  }
}

export async function* iterRpc(
  fetchPage: RpcPageFetcher,
  options?: { pageSize?: number; maxItems?: number },
): AsyncGenerator<Record<string, any>> {
  const pageSize = options?.pageSize ?? 200;
  const maxItems = options?.maxItems ?? null;
  let offset = 0;
  let yielded = 0;

  while (true) {
    const remaining = maxItems === null ? null : maxItems - yielded;
    const limit = remaining === null ? pageSize : Math.min(pageSize, remaining);
    if (limit <= 0) break;

    const result = await fetchPage(limit, offset);
    const rows: Record<string, any>[] = result.rows ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      yield row;
      yielded++;
      if (maxItems !== null && yielded >= maxItems) return;
    }

    const hasMore = result.hasMore ?? false;
    if (!hasMore) break;
    offset += rows.length;
  }
}

export async function* iterRpcByTotalCount(
  fetchPage: RpcPageFetcher,
  options?: { pageSize?: number; maxItems?: number },
): AsyncGenerator<Record<string, any>> {
  const pageSize = options?.pageSize ?? 200;
  const maxItems = options?.maxItems ?? null;
  let offset = 0;
  let yielded = 0;

  while (true) {
    const remaining = maxItems === null ? null : maxItems - yielded;
    const limit = remaining === null ? pageSize : Math.min(pageSize, remaining);
    if (limit <= 0) break;

    const result = await fetchPage(limit, offset);
    const rows: Record<string, any>[] = result.rows ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      yield row;
      yielded++;
      if (maxItems !== null && yielded >= maxItems) return;
    }

    // Continue while rows remain, judged against totalCount (the version
    // RPC reports totalCount but no hasMore). Without a totalCount, fall
    // back to the short-page heuristic so a missing count still terminates.
    const totalCount =
      typeof result.totalCount === "number" ? result.totalCount : null;
    if (totalCount === null) {
      if (rows.length < limit) break;
    } else if (offset + rows.length >= totalCount) {
      break;
    }
    offset += rows.length;
  }
}
