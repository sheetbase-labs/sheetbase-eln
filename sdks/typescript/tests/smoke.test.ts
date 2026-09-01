/**
 * SDK-03 end-to-end smoke test.
 *
 * Exercises the full critical path against a mock transport, exactly as an
 * integrator would drive the package standalone: token exchange → query
 * dataset rows → commit with an idempotency key (including the stale-version
 * retry), asserting the wire contract at every step.
 */
import { describe, expect, it } from "vitest";

import { API_VERSION, SheetbaseClient } from "../src/index.js";
import {
  BASE_URL,
  CREDENTIAL,
  commitResponse,
  createMockFetch,
  datasetRow,
  datasetRowsResponse,
  type MockRoute,
} from "./helpers.js";

describe("smoke: token exchange → query rows → idempotent commit", () => {
  it("drives the critical path end to end", async () => {
    const datasetId = datasetRow.id;
    const routes: MockRoute[] = [
      {
        method: "POST",
        path: "/api/db/rpc/query_dataset_rows",
        handler: () => ({ status: 200, json: datasetRowsResponse }),
      },
      {
        method: "POST",
        path: "/api/db/rpc/commit_dataset_row_batch",
        handler: () => ({ status: 200, json: commitResponse }),
      },
    ];
    const fetch = createMockFetch(routes);
    const client = new SheetbaseClient({
      baseUrl: BASE_URL,
      credential: CREDENTIAL,
      scopes: ["datasets:read", "datasets:write"],
      fetch,
    });

    // 1. Token exchange happens automatically, exactly once, up front.
    expect(client.apiVersion).toBe(API_VERSION);

    // 2. Query rows through the typed resource.
    const page = await client.datasets.queryRows({ datasetId });
    expect(page.totalCount).toBe(2);
    expect(page.rows[0].values).toMatchObject({
      "fff00000-0000-0000-0000-000000000001": 1.2e9,
      "fff00000-0000-0000-0000-000000000002": "HEK293T",
    });

    // 3. Commit with an explicit idempotency key.
    const result = await client.datasets.commitRows(
      datasetId,
      3,
      [
        {
          operation: "create",
          rowId: "bbb11111-2222-3333-4444-555555555501",
          values: { "fff00000-0000-0000-0000-000000000001": 9.9e8 },
        },
      ],
      { idempotencyKey: "smoke-commit-1" },
    );
    expect(result.ok).toBe(true);
    expect(result.datasetRevision).toBe(4);
    expect(result.idempotent).toBe(false);

    client.close();

    // Wire assertions: token first, bearer on data calls, p_ envelope.
    const [token, query, commit] = fetch.calls;
    expect(token.method).toBe("POST");
    expect(token.url).toBe("/api/token");
    expect(JSON.parse(token.body!)).toMatchObject({ credential: CREDENTIAL });
    expect(query.url).toBe("/api/db/rpc/query_dataset_rows");
    expect(query.headers).toMatchObject({
      Authorization: `Bearer fake-jwt-token`,
    });
    expect(JSON.parse(query.body!)).toEqual({
      p_dataset_id: datasetId,
      p_limit: 200,
      p_offset: 0,
    });
    expect(commit.url).toBe("/api/db/rpc/commit_dataset_row_batch");
    expect(JSON.parse(commit.body!)).toEqual({
      p_dataset_id: datasetId,
      p_expected_dataset_revision: 3,
      p_rows: [
        {
          operation: "create",
          rowId: "bbb11111-2222-3333-4444-555555555501",
          values: { "fff00000-0000-0000-0000-000000000001": 9.9e8 },
        },
      ],
      p_idempotency_key: "smoke-commit-1",
    });
  });

  it("retries a stale commit with a fresh idempotency key", async () => {
    let commitCalls = 0;
    const fetch = createMockFetch([
      {
        method: "GET",
        path: "/api/db/datasets",
        handler: () => ({ status: 200, json: [datasetRow] }),
      },
      {
        method: "POST",
        path: "/api/db/rpc/commit_dataset_row_batch",
        handler: () => {
          commitCalls++;
          if (commitCalls === 1) {
            return {
              status: 409,
              json: {
                error: {
                  category: "stale_version",
                  message: "revision mismatch",
                  request_id: "request-stale-1",
                },
              },
            };
          }
          return { status: 200, json: commitResponse };
        },
      },
    ]);
    const client = new SheetbaseClient({
      baseUrl: BASE_URL,
      credential: CREDENTIAL,
      scopes: ["datasets:read", "datasets:write"],
      fetch,
    });

    const result = await client.datasets.commitRows(
      datasetRow.id,
      99,
      [
        {
          operation: "create",
          rowId: "bbb11111-2222-3333-4444-555555555501",
          values: {},
        },
      ],
      { idempotencyKey: "smoke-stale-1" },
    );
    expect(result.ok).toBe(true);
    client.close();

    const commitCalls1 = fetch.calls.filter(
      (call) => call.url === "/api/db/rpc/commit_dataset_row_batch",
    );
    expect(commitCalls1).toHaveLength(2);
    const firstKey = JSON.parse(commitCalls1[0].body!).p_idempotency_key;
    const secondKey = JSON.parse(commitCalls1[1].body!).p_idempotency_key;
    expect(firstKey).toBe("smoke-stale-1");
    expect(secondKey).not.toBe(firstKey);
    // The retry re-read the authoritative revision from the server.
    expect(JSON.parse(commitCalls1[1].body!).p_expected_dataset_revision).toBe(
      3,
    );
  });
});
