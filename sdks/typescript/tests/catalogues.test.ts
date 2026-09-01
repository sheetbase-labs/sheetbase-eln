import { describe, it, expect } from "vitest";
import { SheetbaseClient } from "../src/client.js";
import { BASE_URL, CREDENTIAL, createMockFetch, type MockRoute } from "./helpers.js";

function makeClient(routes: MockRoute[] = []) {
  const fetch = createMockFetch(routes);
  const client = new SheetbaseClient({
    baseUrl: BASE_URL,
    credential: CREDENTIAL,
    scopes: ["datasets:read"],
    fetch,
  });
  return { client, fetch };
}

describe("CataloguesResource", () => {
  it("listSchemaVersionFields filters by schema_version_id", async () => {
    const { client, fetch } = makeClient([
      {
        method: "GET",
        path: "/api/db/dataset_schema_version_fields",
        handler: () => ({ status: 200, json: [] }),
      },
    ]);
    await client.catalogues.listSchemaVersionFields({
      schemaVersionId: "dsv-0001",
    });
    const call = fetch.calls.find((c) =>
      c.url.includes("/api/db/dataset_schema_version_fields"),
    )!;
    expect(call.url).toContain("schema_version_id=eq.dsv-0001");
    expect(call.url).not.toContain("dataset_schema_version_id");
    client.close();
  });

  it("listSchemaVersionFields omits the filter when no schemaVersionId", async () => {
    const { client, fetch } = makeClient([
      {
        method: "GET",
        path: "/api/db/dataset_schema_version_fields",
        handler: () => ({ status: 200, json: [] }),
      },
    ]);
    await client.catalogues.listSchemaVersionFields();
    const call = fetch.calls.find((c) =>
      c.url.includes("/api/db/dataset_schema_version_fields"),
    )!;
    expect(call.url).not.toContain("schema_version_id=");
    expect(call.url).not.toContain("dataset_schema_version_id");
    client.close();
  });
});
