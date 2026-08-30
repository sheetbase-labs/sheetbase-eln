/** Search resource — workspace search and model record search. */
import type { HttpTransport } from "../http.js";
import { iterRpc } from "../pagination.js";
import {
  fromSearchResult,
  fromSearchPage,
  type SearchResult,
  type SearchPage,
} from "../types.js";

export class SearchResource {
  constructor(private transport: HttpTransport) {}

  async search(options?: {
    query?: string;
    projectId?: string;
    kind?: string;
    status?: string;
    ownerId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    offset?: number;
  }): Promise<SearchPage> {
    const body: Record<string, unknown> = {
      p_query: options?.query ?? "",
      p_limit: options?.limit ?? 20,
      p_offset: options?.offset ?? 0,
    };
    if (options?.projectId) body.p_project_id = options.projectId;
    if (options?.kind) body.p_kind = options.kind;
    if (options?.status) body.p_status = options.status;
    if (options?.ownerId) body.p_owner_id = options.ownerId;
    if (options?.dateFrom) body.p_date_from = options.dateFrom;
    if (options?.dateTo) body.p_date_to = options.dateTo;
    const results = await this.transport.post("/api/db/rpc/search", { jsonBody: body });
    return fromSearchPage(results);
  }

  async searchSheetRecords(options?: {
    modelKey?: string;
    query?: string;
    includeArchived?: boolean;
    limit?: number;
  }): Promise<Record<string, any>[]> {
    const body: Record<string, unknown> = {
      p_query: options?.query ?? "",
      p_include_archived: options?.includeArchived ?? false,
      p_limit: options?.limit ?? 25,
    };
    if (options?.modelKey) body.p_model_key = options.modelKey;
    return this.transport.post("/api/db/rpc/search_sheet_records", { jsonBody: body });
  }

  async *iter(options?: {
    query?: string;
    projectId?: string;
    kind?: string;
    status?: string;
    ownerId?: string;
    dateFrom?: string;
    dateTo?: string;
    pageSize?: number;
    maxItems?: number;
  }): AsyncGenerator<SearchResult> {
    const fetchPage = (limit: number, offset: number) => {
      const body: Record<string, unknown> = {
        p_query: options?.query ?? "",
        p_limit: limit,
        p_offset: offset,
      };
      if (options?.projectId) body.p_project_id = options.projectId;
      if (options?.kind) body.p_kind = options.kind;
      if (options?.status) body.p_status = options.status;
      if (options?.ownerId) body.p_owner_id = options.ownerId;
      if (options?.dateFrom) body.p_date_from = options.dateFrom;
      if (options?.dateTo) body.p_date_to = options.dateTo;
      const results = this.transport.post("/api/db/rpc/search", { jsonBody: body });
      return results.then((r: Record<string, any>[]) => {
        const total = r.length > 0 ? r[0].total_count : 0;
        const hasMore = offset + r.length < total;
        return { rows: r, hasMore };
      });
    };
    for await (const row of iterRpc(fetchPage, {
      pageSize: options?.pageSize ?? 100,
      maxItems: options?.maxItems,
    })) {
      yield fromSearchResult(row);
    }
  }
}
