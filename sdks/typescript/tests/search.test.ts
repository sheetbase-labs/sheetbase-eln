import { describe, it, expect } from "vitest";
import { SheetbaseClient } from "../src/client.js";
import {
  BASE_URL,
  CREDENTIAL,
  createMockFetch,
  type MockRoute,
} from "./helpers.js";

function makeClient(routes: MockRoute[] = []) {
  const fetch = createMockFetch(routes);
  const client = new SheetbaseClient({
    baseUrl: BASE_URL,
    credential: CREDENTIAL,
    scopes: ["projects:read"],
    fetch,
  });
  return { client, fetch };
}

describe("SearchResource", () => {
  it("search returns typed results", async () => {
    const results = [
      {
        result_type: "record",
        record_id: "550e8400-e29b-41d4-a716-446655440000",
        kind: "experiment",
        identifier: "EXP-2026-0001",
        title: "Lentivector Purification",
        status: "in-progress",
        total_count: 2,
        rank: 0.95,
      },
      {
        result_type: "record",
        record_id: "550e8400-e29b-41d4-a716-446655440001",
        kind: "sample",
        identifier: "SMP-2026-0001",
        title: "Sample A",
        status: "draft",
        total_count: 2,
      },
    ];
    const { client } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/search",
        handler: () => ({ status: 200, json: results }),
      },
    ]);
    const page = await client.search.search({ query: "lentivector" });
    expect(page.totalCount).toBe(2);
    expect(page.results).toHaveLength(2);
    expect(page.results[0].kind).toBe("experiment");
    expect(page.results[0].rank).toBe(0.95);
    client.close();
  });

  it("search with filters passes params", async () => {
    const { client, fetch } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/search",
        handler: () => ({ status: 200, json: [] }),
      },
    ]);
    await client.search.search({ query: "test", kind: "experiment", status: "in-progress" });
    const call = fetch.calls.find((c) => c.url.includes("/api/db/rpc/search"));
    const body = JSON.parse(call!.body!);
    expect(body.p_query).toBe("test");
    expect(body.p_kind).toBe("experiment");
    expect(body.p_status).toBe("in-progress");
    client.close();
  });

  it("searchSheetRecords returns array", async () => {
    const { client } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/search_sheet_records",
        handler: () => ({
          status: 200,
          json: [{ record_id: "r1", identifier: "SMP-001", title: "Sample A" }],
        }),
      },
    ]);
    const results = await client.search.searchSheetRecords({ modelKey: "sample", query: "A" });
    expect(results).toHaveLength(1);
    expect(results[0].identifier).toBe("SMP-001");
    client.close();
  });

  it("iter paginates search results", async () => {
    const page1 = Array.from({ length: 3 }, (_, i) => ({
      result_type: "record",
      record_id: `550e8400-e29b-41d4-a716-44665544000${i}`,
      kind: "experiment",
      identifier: `EXP-${i.toString().padStart(4, "0")}`,
      title: `Experiment ${i}`,
      total_count: 5,
    }));
    const page2 = Array.from({ length: 2 }, (_, i) => ({
      result_type: "record",
      record_id: `550e8400-e29b-41d4-a716-44665544000${i + 3}`,
      kind: "experiment",
      identifier: `EXP-${(i + 3).toString().padStart(4, "0")}`,
      title: `Experiment ${i + 3}`,
      total_count: 5,
    }));
    const responses = [{ status: 200, json: page1 }, { status: 200, json: page2 }];
    let callIndex = 0;
    const { client } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/search",
        handler: () => responses[callIndex++],
      },
    ]);
    const results = [];
    for await (const r of client.search.iter({ query: "exp", pageSize: 3 })) {
      results.push(r);
    }
    expect(results).toHaveLength(5);
    client.close();
  });
});
