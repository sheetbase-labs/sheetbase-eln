/**
 * Dataset resource — the primary data-plane surface.
 *
 * Covers querying live and versioned rows with pagination iterators,
 * validating and committing row batches with idempotency and optimistic
 * concurrency, snapshotting, archiving and restoring datasets.
 */
import type { HttpTransport } from "../http.js";
import { iterRpcByTotalCount, iterTable } from "../pagination.js";
import {
  fromDataset,
  fromDatasetVersion,
  fromDatasetRowPage,
  fromDatasetVersionRowPage,
  fromCommitResult,
  fromValidationResult,
  fromSchemaField,
  type Dataset,
  type DatasetVersion,
  type DatasetRowPage,
  type DatasetVersionRowPage,
  type CommitResult,
  type ValidationResult,
  type SchemaField,
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

// ── Expanded records ───────────────────────────────────────────────────────

/**
 * A dataset row expanded for analysis: metadata keys `rowId` and `revision`
 * plus one key per field ID. Field labels can optionally rename field keys;
 * stable field IDs remain the canonical identifiers.
 */
export interface DatasetRecord {
  rowId: string;
  revision: number;
  [fieldId: string]: unknown;
}

function expandRows(
  rawRows: Record<string, any>[],
  fieldLabels?: Record<string, string>,
): DatasetRecord[] {
  return rawRows.map((row) => {
    const record: DatasetRecord = {
      rowId: row.rowId,
      revision: row.revision,
    };
    const values = row.values ?? {};
    for (const [fieldId, value] of Object.entries(values)) {
      record[fieldLabels?.[fieldId] ?? fieldId] = value;
    }
    return record;
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
    if (params.primaryProjectId !== undefined)
      body.primary_project_id = params.primaryProjectId;
    const rows = await this.transport.post("/api/db/datasets", {
      jsonBody: body,
      headers: { Prefer: "return=representation" },
    });
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
    yield* iterRpcByTotalCount(fetchPage, {
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
    yield* iterRpcByTotalCount(fetchPage, {
      pageSize: options?.pageSize ?? 1000,
      maxItems: options?.maxItems,
    });
  }

  // ── version access ──────────────────────────────────────────────────

  async listVersions(
    datasetId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<DatasetVersion[]> {
    const rows = await this.transport.get("/api/db/dataset_versions", {
      params: {
        dataset_id: `eq.${datasetId}`,
        order: "created_at.desc",
        limit: options?.limit ?? 100,
        offset: options?.offset ?? 0,
      },
    });
    return rows.map(fromDatasetVersion);
  }

  async *iterVersions(
    datasetId: string,
    options?: { pageSize?: number; maxItems?: number },
  ): AsyncGenerator<DatasetVersion> {
    const fetchPage = (limit: number, offset: number) =>
      this.transport.get("/api/db/dataset_versions", {
        params: {
          dataset_id: `eq.${datasetId}`,
          order: "created_at.desc",
          limit,
          offset,
        },
      });
    for await (const row of iterTable(fetchPage, {
      pageSize: options?.pageSize ?? 100,
      maxItems: options?.maxItems,
    })) {
      yield fromDatasetVersion(row);
    }
  }

  // ── schema fields (analysis ergonomics) ─────────────────────────────

  async schemaFields(
    schemaVersionId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<SchemaField[]> {
    const rows = await this.transport.get(
      "/api/db/dataset_schema_version_fields",
      {
        params: {
          schema_version_id: `eq.${schemaVersionId}`,
          order: "display_order.asc",
          limit: options?.limit ?? 1000,
          offset: options?.offset ?? 0,
        },
      },
    );
    return rows.map(fromSchemaField);
  }

  async fieldLabelMap(schemaVersionId: string): Promise<Record<string, string>> {
    const fields = await this.schemaFields(schemaVersionId);
    return Object.fromEntries(fields.map((f) => [f.fieldId, f.label]));
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
    const result = await this.transport.post("/api/db/rpc/snapshot_dataset", {
      jsonBody: {
        p_dataset_id: datasetId,
        p_expected_dataset_revision: expectedRevision,
        p_label: label,
      },
    });
    if (Array.isArray(result)) return fromDatasetVersion(result[0]);
    return fromDatasetVersion(result);
  }

  async archive(datasetId: string, expectedRevision: number): Promise<any> {
    return this.transport.post("/api/db/rpc/archive_dataset", {
      jsonBody: {
        p_dataset_id: datasetId,
        p_expected_revision: expectedRevision,
      },
    });
  }

  async restore(datasetId: string, expectedRevision: number): Promise<any> {
    return this.transport.post("/api/db/rpc/restore_dataset", {
      jsonBody: {
        p_dataset_id: datasetId,
        p_expected_revision: expectedRevision,
      },
    });
  }

  // ── bulk transfer ───────────────────────────────────────────────────

  /**
   * Download all matching live rows as expanded records, auto-paginating.
   *
   * `fieldLabels` optionally renames field-ID keys (see `fieldLabelMap`);
   * field IDs remain the canonical identifiers.
   */
  async downloadRecords(
    datasetId: string,
    options?: {
      filters?: Record<string, any>[];
      sort?: Record<string, string>;
      fieldLabels?: Record<string, string>;
      maxItems?: number;
    },
  ): Promise<DatasetRecord[]> {
    const rawRows: Record<string, any>[] = [];
    for await (const row of this.iterRows(datasetId, {
      filters: options?.filters,
      sort: options?.sort,
      maxItems: options?.maxItems,
    })) {
      rawRows.push(row);
    }
    return expandRows(rawRows, options?.fieldLabels);
  }

  /**
   * Download all rows from an immutable Dataset Version as expanded records.
   * Version rows reconstruct exactly the pinned revision — the
   * analysis-safe view that never shifts with live data.
   */
  async downloadVersionRecords(
    datasetVersionId: string,
    options?: {
      fieldLabels?: Record<string, string>;
      maxItems?: number;
    },
  ): Promise<DatasetRecord[]> {
    const rawRows: Record<string, any>[] = [];
    for await (const row of this.iterVersionRows(datasetVersionId, {
      maxItems: options?.maxItems,
    })) {
      rawRows.push(row);
    }
    return expandRows(rawRows, options?.fieldLabels);
  }

  /**
   * Upload records as create operations in batched commits.
   *
   * Each batch commits with its own idempotency key and the revision
   * returned by the previous batch, so large transfers stay safe under
   * optimistic concurrency. Returns one `CommitResult` per batch.
   */
  async uploadRecords(
    datasetId: string,
    expectedRevision: number,
    records: Array<Record<string, unknown>>,
    options?: {
      batchSize?: number;
      idempotencyKey?: string;
    },
  ): Promise<CommitResult[]> {
    const batchSize = options?.batchSize ?? 500;
    const results: CommitResult[] = [];
    let revision = expectedRevision;
    for (let start = 0; start < records.length; start += batchSize) {
      const batch = new DatasetRowBatch();
      for (const record of records.slice(start, start + batchSize)) {
        const { rowId, revision: _rev, ...values } = record;
        batch.create(values, rowId as string | undefined);
      }
      const result = await this.commitRows(datasetId, revision, batch, {
        idempotencyKey: options?.idempotencyKey
          ? `${options.idempotencyKey}-${start / batchSize}`
          : undefined,
      });
      results.push(result);
      revision = result.datasetRevision;
    }
    return results;
  }
}
