import { describe, expect, it } from "vitest";

import { SheetbaseClient } from "../src/client.js";
import {
  BASE_URL,
  CREDENTIAL,
  createMockFetch,
} from "./helpers.js";

// KNOW-03 — record_links read parity: the public contract already exposes
// link reads (GET/HEAD /api/db/record_links), and both SDKs read them
// through the existing generic table contract. No dedicated link-read
// wrapper exists or is needed; this suite pins the read path so a contract
// or client regression fails here.
const linkRow = {
  id: "link-1",
  source_record_id: "rec-1",
  target_record_id: "rec-2",
  target_kind: "sample",
  target_identifier: "SMP-2026-0001",
  link_type: "sample",
  created_at: "2026-08-03T00:00:00Z",
  created_by_user_id: "user-1",
};

function makeClient() {
  const fetch = createMockFetch([
    {
      method: "GET",
      path: "/api/db/record_links",
      handler: () => ({ status: 200, json: [linkRow] }),
    },
    {
      method: "HEAD",
      path: "/api/db/record_links",
      handler: () => ({
        status: 200,
        headers: { "Content-Range": "0-0/7" },
      }),
    },
  ]);
  const client = new SheetbaseClient({
    baseUrl: BASE_URL,
    credential: CREDENTIAL,
    scopes: ["projects:read"],
    fetch,
  });
  return { client, fetch };
}

describe("record_links reads", () => {
  it("lists links through the existing public table contract", async () => {
    const { client, fetch } = makeClient();
    const rows = await client.tableGet("record_links", {
      params: {
        source_record_id: "eq.rec-1",
        order: "created_at.asc",
      },
    });
    expect(rows).toEqual([linkRow]);
    expect(fetch.calls[1]).toMatchObject({
      method: "GET",
      url: "/api/db/record_links?source_record_id=eq.rec-1&order=created_at.asc",
    });
  });

  it("reads incoming links by target without a new endpoint", async () => {
    const { client, fetch } = makeClient();
    const rows = await client.tableGet("record_links", {
      params: { target_record_id: "eq.rec-1" },
    });
    expect(rows).toEqual([linkRow]);
    expect(fetch.calls[1]).toMatchObject({
      method: "GET",
      url: "/api/db/record_links?target_record_id=eq.rec-1",
    });
  });

  it("counts links for exact relationship totals", async () => {
    const { client } = makeClient();
    await expect(
      client.tableHead("record_links", {
        params: { source_record_id: "eq.rec-1" },
        headers: { Prefer: "count=exact" },
      }),
    ).resolves.toMatchObject({ totalCount: 7 });
  });
});
