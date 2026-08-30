/**
 * Dataset resource — the primary data-plane surface.
 *
 * Covers querying live and versioned rows with pagination iterators,
 * validating and committing row batches with idempotency and optimistic
 * concurrency, snapshotting, archiving and restoring datasets.
 */
import type { HttpTransport } from "../http.js";
import { iterRpc } from "../pagination.js";
import {
  fromDataset,
  fromDatasetVersion,
  fromDatasetRowPage,
  fromDatasetVersionRowPage,
  fromCommitResult,
  fromValidationResult,
  type Dataset,
  type DatasetVersion,
  type DatasetRowPage,
  type DatasetVersionRowPage,
  type CommitResult,
  type ValidationResult,
} from "../types.js";
import { NotFoundError, StaleVersionError } from "../errors.js";

// ── Row batch builder ──────────────────────────────────────────────────────

export interface DatasetRowOperation {
  operation: "create" | "update";
  rowId: string;
  values: Record<string, unknown>;
  expectedRevision?: number;
}

export class DatasetRowBatch {
  private _rows: DatasetRowOperation[] = [];

  create(values: Record<string, unknown>, rowId?: string): this {
    this._rows.push({
      operation: "create",
      rowId: rowId ?? cryptoRandomUUID(),
      values,
    });
    return this;
  }

  update(
    rowId: string,
    expectedRevision: number,
    values: Record<string, unknown>,
  ): this {
    this._rows.push({
      operation: "update",
      rowId,
      expectedRevision,
      values,
    });
    return this;
  }

  toPayload(): DatasetRowOperation[] {
    return [...this._rows];
  }

  get rows(): DatasetRowOperation[] {
    return [...this._rows];
  }

  get length(): number {
    return this._rows.length;
  }
}

function cryptoRandomUUID(): string {
  // Use crypto.randomUUID when available (Node 19+, browsers), else fallback.
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Resource ───────────────────────────────────────────────────────────────

export class DatasetsResource {
  constructor(private transport: HttpTransport) {}

  // ── catalogue ──────────────────────────────────────────────────────

  async list(options?: {
    select?: string;
    order?: string;
    limit?: number;
    offset?: number;
  }): Promise<Dataset[]> {
    const params: Record<string, string | number | undefined> = {
      limit: options?.limit ?? 100,
      offset: options?.offset ?? 0,
    };
    if (options?.select) params.select = options.select;
    if (options?.order) params.order = options.order;
    const rows = await this.transport.get("/api/db/datasets", { params });
    return rows.map(fromDataset);
  }

  async get(datasetId: string): Promise<Dataset> {
    const rows = await this.transport.get("/api/db/datasets", {
      params: { id: `eq.${datasetId}`, limit: 1 },
    });
    if (rows.length === 0) {
      throw new NotFoundError("not_found", `Dataset ${datasetId} not found.`);
    }
    return fromDataset(rows[0]);
  }

  async create(params: {
    workspaceId: string;
    schemaVersionId: string;
    name: string;
    description?: string;
    primaryProjectId?: string;
  }): Promise<Dataset> {
    const body: Record<string, unknown> = {
      workspace_id: params.workspaceId,
      schema_version_id: params.schemaVersionId,
      name: params.name,
    };
    if (params.description !== undefined) body.description = params.description;
    if (params.primaryProjectId !== undefined) body.primary_project_id = params.primaryProjectId;
    const rows = await this.transport.post("/api/db/datasets", { jsonBody: body });
    if (Array.isArray(rows)) return fromDataset(rows[0]);
    return fromDataset(rows);
  }

  // ── row queries ─────────────────────────────────────────────────────

  async queryRows(params: {
    datasetId: string;
    filters?: Record<string, any>[];
    sort?: Record<string, string>;
    limit?: number;
    offset?: number;
  }): Promise<DatasetRowPage> {
    const body: Record<string, unknown> = {
      p_dataset_id: params.datasetId,
      p_limit: params.limit ?? 200,
      p_offset: params.offset ?? 0,
    };
    const pQuery: Record<string, unknown> = {};
    if (params.filters) pQuery.filters = params.filters;
    if (params.sort) pQuery.sort = params.sort;
    if (Object.keys(pQuery).length > 0) body.p_query = pQuery;
    const result = await this.transport.post("/api/db/rpc/query_dataset_rows", {
      jsonBody: body,
    });
    return fromDatasetRowPage(result);
  }

  async queryVersionRows(params: {
    datasetVersionId: string;
    limit?: number;
    offset?: number;
  }): Promise<DatasetVersionRowPage> {
    const result = await this.transport.post(
      "/api/db/rpc/query_dataset_version_rows",
      {
        jsonBody: {
          p_dataset_version_id: params.datasetVersionId,
          p_limit: params.limit ?? 200,
          p_offset: params.offset ?? 0,
        },
      },
    );
    return fromDatasetVersionRowPage(result);
  }

  async *iterRows(
    datasetId: string,
    options?: {
      filters?: Record<string, any>[];
      sort?: Record<string, string>;
      pageSize?: number;
      maxItems?: number;
    },
  ): AsyncGenerator<Record<string, any>> {
    const fetchPage = (limit: number, offset: number) => {
      const body: Record<string, unknown> = {
        p_dataset_id: datasetId,
        p_limit: limit,
        p_offset: offset,
      };
      const pQuery: Record<string, unknown> = {};
      if (options?.filters) pQuery.filters = options.filters;
      if (options?.sort) pQuery.sort = options.sort;
      if (Object.keys(pQuery).length > 0) body.p_query = pQuery;
      return this.transport.post("/api/db/rpc/query_dataset_rows", {
        jsonBody: body,
      });
    };
    yield* iterRpc(fetchPage, {
      pageSize: options?.pageSize ?? 1000,
      maxItems: options?.maxItems,
    });
  }

  async *iterVersionRows(
    datasetVersionId: string,
    options?: { pageSize?: number; maxItems?: number },
  ): AsyncGenerator<Record<string, any>> {
    const fetchPage = (limit: number, offset: number) =>
      this.transport.post("/api/db/rpc/query_dataset_version_rows", {
        jsonBody: {
          p_dataset_version_id: datasetVersionId,
          p_limit: limit,
          p_offset: offset,
        },
      });
    yield* iterRpc(fetchPage, {
      pageSize: options?.pageSize ?? 1000,
      maxItems: options?.maxItems,
    });
  }

  // ── validation ──────────────────────────────────────────────────────

  async validateRows(
    datasetId: string,
    expectedDatasetRevision: number,
    rows: DatasetRowOperation[] | DatasetRowBatch,
  ): Promise<ValidationResult> {
    const payload = rows instanceof DatasetRowBatch ? rows.toPayload() : rows;
    const result = await this.transport.post(
      "/api/db/rpc/validate_dataset_row_batch",
      {
        jsonBody: {
          p_dataset_id: datasetId,
          p_expected_dataset_revision: expectedDatasetRevision,
          p_rows: payload,
        },
      },
    );
    return fromValidationResult(result);
  }

  // ── commit with idempotency and stale-version retry ─────────────────

  async commitRows(
    datasetId: string,
    expectedRevision: number,
    rows: DatasetRowOperation[] | DatasetRowBatch,
    options?: {
      idempotencyKey?: string;
      retryOnStale?: boolean;
      maxRetries?: number;
    },
  ): Promise<CommitResult> {
    const payload = rows instanceof DatasetRowBatch ? rows.toPayload() : rows;
    const retryOnStale = options?.retryOnStale ?? true;
    const maxRetries = options?.maxRetries ?? 3;

    let attempt = 0;
    let currentRevision = expectedRevision;
    let currentKey = options?.idempotencyKey ?? cryptoRandomUUID();

    while (true) {
      try {
        const result = await this.transport.post(
          "/api/db/rpc/commit_dataset_row_batch",
          {
            jsonBody: {
              p_dataset_id: datasetId,
              p_expected_dataset_revision: currentRevision,
              p_rows: payload,
              p_idempotency_key: currentKey,
            },
          },
        );
        return fromCommitResult(result);
      } catch (err) {
        if (err instanceof StaleVersionError) {
          if (!retryOnStale || attempt >= maxRetries) throw err;
          attempt++;
          const ds = await this.get(datasetId);
          currentRevision = ds.revision;
          currentKey = cryptoRandomUUID();
        } else {
          throw err;
        }
      }
    }
  }

  // ── snapshot / archive / restore ────────────────────────────────────

  async snapshot(
    datasetId: string,
    expectedRevision: number,
    label: string,
  ): Promise<DatasetVersion> {
    const result = await this.transport.post(
      "/api/db/rpc/snapshot_dataset",
      {
        jsonBody: {
          p_dataset_id: datasetId,
          p_expected_dataset_revision: expectedRevision,
          p_label: label,
        },
      },
    );
    if (Array.isArray(result)) return fromDatasetVersion(result[0]);
    return fromDatasetVersion(result);
  }

  async archive(datasetId: string): Promise<any> {
    return this.transport.post("/api/db/rpc/archive_dataset", {
      jsonBody: { p_dataset_id: datasetId },
    });
  }

  async restore(datasetId: string): Promise<any> {
    return this.transport.post("/api/db/rpc/restore_dataset", {
      jsonBody: { p_dataset_id: datasetId },
    });
  }
}
