import { describe, it, expect } from "vitest";
import { SheetbaseClient } from "../src/client.js";
import { DatasetRowBatch } from "../src/resources/datasets.js";
import {
  BASE_URL,
  CREDENTIAL,
  createMockFetch,
  datasetRow,
  datasetRowsResponse,
  commitResponse,
  type MockRoute,
} from "./helpers.js";
import { StaleVersionError } from "../src/errors.js";

function makeClient(routes: MockRoute[] = []) {
  const fetch = createMockFetch(routes);
  const client = new SheetbaseClient({
    baseUrl: BASE_URL,
    credential: CREDENTIAL,
    scopes: ["datasets:read", "datasets:write"],
    fetch,
  });
  return { client, fetch };
}

describe("DatasetsResource", () => {
  it("list returns typed datasets", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/datasets",
        handler: () => ({ status: 200, json: [datasetRow] }),
      },
    ]);
    const datasets = await client.datasets.list();
    expect(datasets).toHaveLength(1);
    expect(datasets[0].name).toBe("Purification Data");
    expect(datasets[0].revision).toBe(3);
    client.close();
  });

  it("get returns dataset by id", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/datasets",
        handler: () => ({ status: 200, json: [datasetRow] }),
      },
    ]);
    const ds = await client.datasets.get(datasetRow.id);
    expect(ds.id).toBe(datasetRow.id);
    expect(ds.revision).toBe(3);
    client.close();
  });

  it("queryRows returns typed page", async () => {
    const { client } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/query_dataset_rows",
        handler: () => ({ status: 200, json: datasetRowsResponse }),
      },
    ]);
    const page = await client.datasets.queryRows({
      datasetId: "770e8400-e29b-41d4-a716-446655440020",
    });
    expect(page.totalCount).toBe(2);
    expect(page.hasMore).toBe(false);
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0].revision).toBe(1);
    client.close();
  });

  it("commitRows returns typed result", async () => {
    const { client } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/commit_dataset_row_batch",
        handler: () => ({ status: 200, json: commitResponse }),
      },
    ]);
    const result = await client.datasets.commitRows(
      "770e8400-e29b-41d4-a716-446655440020",
      3,
      [{ operation: "create", rowId: "aaa", values: { f: 1 } }],
    );
    expect(result.ok).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(result.datasetRevision).toBe(4);
    client.close();
  });

  it("commitRows with batch builder", async () => {
    const { client, fetch } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/commit_dataset_row_batch",
        handler: () => ({ status: 200, json: commitResponse }),
      },
    ]);
    const batch = new DatasetRowBatch();
    batch.create({ "field-uuid": "value1" });
    batch.create({ "field-uuid": "value2" });
    await client.datasets.commitRows(
      "770e8400-e29b-41d4-a716-446655440020",
      3,
      batch,
    );
    const call = fetch.calls.find((c) => c.url.includes("/api/db/rpc/commit_dataset_row_batch"));
    const body = JSON.parse(call!.body!);
    expect(body.p_rows).toHaveLength(2);
    expect(body.p_rows[0].operation).toBe("create");
    expect(body.p_idempotency_key).toBeDefined();
    client.close();
  });

  it("commitRows with explicit idempotency key", async () => {
    const { client, fetch } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/commit_dataset_row_batch",
        handler: () => ({ status: 200, json: commitResponse }),
      },
    ]);
    await client.datasets.commitRows(
      "770e8400-e29b-41d4-a716-446655440020",
      3,
      [{ operation: "create", rowId: "aaa", values: {} }],
      { idempotencyKey: "my-key-001" },
    );
    const call = fetch.calls.find((c) => c.url.includes("/api/db/rpc/commit_dataset_row_batch"));
    const body = JSON.parse(call!.body!);
    expect(body.p_idempotency_key).toBe("my-key-001");
    client.close();
  });

  it("commitRows retries on stale_version", async () => {
    const responses = [
      { status: 409, json: { error: { category: "stale_version", message: "Revision mismatch." } } },
      { status: 200, json: commitResponse },
    ];
    let callIndex = 0;
    const { client, fetch } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/commit_dataset_row_batch",
        handler: () => responses[callIndex++],
      },
      {
        method: "GET",
        path: "/api/db/datasets",
        handler: () => ({ status: 200, json: [datasetRow] }),
      },
    ]);
    const result = await client.datasets.commitRows(
      "770e8400-e29b-41d4-a716-446655440020",
      2, // stale — should retry with revision 3
      [{ operation: "create", rowId: "aaa", values: {} }],
    );
    expect(result.ok).toBe(true);
    const commitCalls = fetch.calls.filter(
      (c) => c.url.includes("/api/db/rpc/commit_dataset_row_batch"),
    );
    expect(commitCalls).toHaveLength(2);
    client.close();
  });

  it("commitRows does not retry when retryOnStale is false", async () => {
    const { client } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/commit_dataset_row_batch",
        handler: () => ({
          status: 409,
          json: { error: { category: "stale_version", message: "Revision mismatch." } },
        }),
      },
    ]);
    await expect(
      client.datasets.commitRows(
        "770e8400-e29b-41d4-a716-446655440020",
        2,
        [{ operation: "create", rowId: "aaa", values: {} }],
        { retryOnStale: false },
      ),
    ).rejects.toThrow(StaleVersionError);
    client.close();
  });

  it("validateRows success", async () => {
    const { client } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/validate_dataset_row_batch",
        handler: () => ({ status: 200, json: { ok: true } }),
      },
    ]);
    const result = await client.datasets.validateRows(
      "770e8400-e29b-41d4-a716-446655440020",
      3,
      [{ operation: "create", rowId: "aaa", values: {} }],
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    client.close();
  });

  it("validateRows with errors", async () => {
    const { client } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/validate_dataset_row_batch",
        handler: () => ({
          status: 200,
          json: {
            ok: false,
            errors: [
              {
                rowIndex: 0,
                rowId: "aaa11111-2222-3333-4444-555555555501",
                fieldId: "fff00000-0000-0000-0000-000000000001",
                code: "invalid_type",
              },
            ],
          },
        }),
      },
    ]);
    const result = await client.datasets.validateRows(
      "770e8400-e29b-41d4-a716-446655440020",
      3,
      [{ operation: "create", rowId: "aaa", values: {} }],
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("invalid_type");
    client.close();
  });

  it("snapshot returns typed dataset version", async () => {
    const versionRow = {
      id: "999e8400-e29b-41d4-a716-446655440040",
      workspace_id: datasetRow.workspace_id,
      dataset_id: datasetRow.id,
      schema_version_id: datasetRow.schema_version_id,
      label: "v1.0",
      source_dataset_revision: 3,
      created_at: "2026-01-17T10:00:00Z",
      created_by_user_id: "user-001",
      created_by_credential_id: null,
    };
    const { client } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/snapshot_dataset",
        handler: () => ({ status: 200, json: [versionRow] }),
      },
    ]);
    const version = await client.datasets.snapshot(datasetRow.id, 3, "v1.0");
    expect(version.label).toBe("v1.0");
    expect(version.sourceDatasetRevision).toBe(3);
    client.close();
  });

  it("iterRows paginates", async () => {
    const page1 = {
      datasetId: "770e8400-e29b-41d4-a716-446655440020",
      datasetRevision: 3,
      offset: 0,
      limit: 2,
      totalCount: 3,
      hasMore: true,
      rows: [
        { rowId: "aaa1", revision: 1, values: { f1: "a" } },
        { rowId: "aaa2", revision: 1, values: { f1: "b" } },
      ],
    };
    const page2 = {
      datasetId: "770e8400-e29b-41d4-a716-446655440020",
      datasetRevision: 3,
      offset: 2,
      limit: 2,
      totalCount: 3,
      hasMore: false,
      rows: [
        { rowId: "aaa3", revision: 1, values: { f1: "c" } },
      ],
    };
    const responses = [{ status: 200, json: page1 }, { status: 200, json: page2 }];
    let callIndex = 0;
    const { client } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/query_dataset_rows",
        handler: () => responses[callIndex++],
      },
    ]);
    const rows = [];
    for await (const row of client.datasets.iterRows(
      "770e8400-e29b-41d4-a716-446655440020",
      { pageSize: 2 },
    )) {
      rows.push(row);
    }
    expect(rows).toHaveLength(3);
    expect(rows[0].values.f1).toBe("a");
    expect(rows[2].values.f1).toBe("c");
    client.close();
  });

  it("iterRows respects maxItems", async () => {
    const page1 = {
      datasetId: "d1",
      datasetRevision: 1,
      offset: 0,
      limit: 10,
      totalCount: 100,
      hasMore: true,
      rows: Array.from({ length: 10 }, (_, i) => ({
        rowId: `aaa${i}`,
        revision: 1,
        values: {},
      })),
    };
    const { client } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/query_dataset_rows",
        handler: () => ({ status: 200, json: page1 }),
      },
    ]);
    const rows = [];
    for await (const row of client.datasets.iterRows("d1", {
      pageSize: 10,
      maxItems: 5,
    })) {
      rows.push(row);
    }
    expect(rows).toHaveLength(5);
    client.close();
  });
});
