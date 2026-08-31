import { describe, it, expect } from "vitest";
import { SheetbaseClient } from "../src/client.js";
import {
  BASE_URL,
  CREDENTIAL,
  createMockFetch,
  recordRow,
  revisionRow,
  type MockRoute,
} from "./helpers.js";
import { NotFoundError } from "../src/errors.js";

function makeClient(routes: MockRoute[] = []) {
  const fetch = createMockFetch(routes);
  const client = new SheetbaseClient({
    baseUrl: BASE_URL,
    credential: CREDENTIAL,
    scopes: ["projects:read", "projects:write"],
    fetch,
  });
  return { client, fetch };
}

describe("RecordsResource", () => {
  it("list returns typed records", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/records",
        handler: () => ({ status: 200, json: [recordRow] }),
      },
    ]);
    const records = await client.records.list();
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe("experiment");
    expect(records[0].identifier).toBe("EXP-2026-0001");
    client.close();
  });

  it("list with filters passes query params", async () => {
    const { client, fetch } = makeClient([
      {
        method: "GET",
        path: "/api/db/records",
        handler: () => ({ status: 200, json: [recordRow] }),
      },
    ]);
    await client.records.list({ kind: "experiment", projectId: "proj-001" });
    const dataCall = fetch.calls.find((c) => c.url.includes("/api/db/records"));
    expect(dataCall!.url).toContain("kind=eq.experiment");
    expect(dataCall!.url).toContain("project_id=eq.proj-001");
    client.close();
  });

  it("get returns record by id", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/records",
        handler: () => ({ status: 200, json: [recordRow] }),
      },
    ]);
    const record = await client.records.get(recordRow.id);
    expect(record.id).toBe(recordRow.id);
    expect(record.kind).toBe("experiment");
    client.close();
  });

  it("get throws NotFoundError when empty", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/records",
        handler: () => ({ status: 200, json: [] }),
      },
    ]);
    await expect(client.records.get("nonexistent")).rejects.toThrow(NotFoundError);
    client.close();
  });

  it("create returns typed record", async () => {
    const { client } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/create_record",
        handler: () => ({ status: 200, json: [recordRow] }),
      },
    ]);
    const record = await client.records.create({
      projectId: "550e8400-e29b-41d4-a716-446655440000",
      kind: "experiment",
      title: "Purification Run 1",
      status: "in-progress",
      tags: ["lentivector"],
    });
    expect(record.title).toBe("Purification Run 1");
    client.close();
  });

  it("update patches record", async () => {
    const { client } = makeClient([
      {
        method: "PATCH",
        path: "/api/db/records",
        handler: () => ({
          status: 200,
          json: [{ ...recordRow, title: "Updated Title" }],
        }),
      },
    ]);
    const result = await client.records.update(recordRow.id, { title: "Updated Title" });
    expect(result[0].title).toBe("Updated Title");
    client.close();
  });

  it("iter paginates records", async () => {
    const responses = [
      { status: 200, json: [recordRow, { ...recordRow, id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", identifier: "EXP-002" }] },
      { status: 200, json: [] },
    ];
    let callIndex = 0;

    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/records",
        handler: () => responses[callIndex++],
      },
    ]);
    const records = [];
    for await (const r of client.records.iter({ pageSize: 2 })) {
      records.push(r);
    }
    expect(records).toHaveLength(2);
    client.close();
  });
});

describe("RecordsResource history", () => {
  it("history returns typed revisions", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/revisions",
        handler: () => ({ status: 200, json: [revisionRow] }),
      },
    ]);
    const history = await client.records.history(revisionRow.record_id);
    expect(history).toHaveLength(1);
    expect(history[0].reason).toBe("update");
    expect(history[0].integrityAlgorithm).toBe("sha256");
    expect(history[0].integrityDigest).toBe("abc123");
    expect(history[0].metadataSnapshot).toEqual({ title: "Purification run 1" });
    client.close();
  });

  it("iterHistory paginates revisions", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/revisions",
        handler: () => ({ status: 200, json: [revisionRow] }),
      },
    ]);
    const revisions = [];
    for await (const rev of client.records.iterHistory(revisionRow.record_id)) {
      revisions.push(rev);
    }
    expect(revisions).toHaveLength(1);
    expect(revisions[0].recordId).toBe(revisionRow.record_id);
    client.close();
  });
});
