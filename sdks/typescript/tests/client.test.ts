import { describe, it, expect } from "vitest";
import { SheetbaseClient } from "../src/client.js";
import {
  BASE_URL,
  CREDENTIAL,
  createMockFetch,
  type MockRoute,
} from "./helpers.js";
import { TokenError, NotFoundError } from "../src/errors.js";

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

describe("SheetbaseClient", () => {
  it("rejects non-HTTPS non-loopback base URLs", () => {
    expect(
      () =>
        new SheetbaseClient({
          baseUrl: "http://api.example.com",
          credential: CREDENTIAL,
          scopes: [],
        }),
    ).toThrow("must be HTTPS");
  });

  it("passes a timeout signal to token and data fetches", async () => {
    const fetch = createMockFetch([
      {
        method: "GET",
        path: "/api/db/projects",
        handler: () => ({ status: 200, json: [] }),
      },
    ]);
    const client = new SheetbaseClient({
      baseUrl: BASE_URL,
      credential: CREDENTIAL,
      scopes: ["projects:read"],
      timeout: 1000,
      fetch,
    });
    await client.projects.list();
    expect(fetch.calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(fetch.calls[1].signal).toBeInstanceOf(AbortSignal);
  });

  it("exchanges token on first request", async () => {
    const { client, fetch } = makeClient([
      {
        method: "GET",
        path: "/api/db/projects",
        handler: () => ({ status: 200, json: [] }),
      },
    ]);
    await client.projects.list();
    // First call should be token exchange.
    expect(fetch.calls[0].url).toBe("/api/token");
    expect(fetch.calls[0].method).toBe("POST");
    // Second call should be the data request with Bearer token.
    expect(fetch.calls[1].url).toBe("/api/db/projects?limit=100&offset=0");
    client.close();
  });

  it("caches token between requests", async () => {
    const { client, fetch } = makeClient([
      {
        method: "GET",
        path: "/api/db/projects",
        handler: () => ({ status: 200, json: [] }),
      },
    ]);
    await client.projects.list();
    await client.projects.list();
    // Only one token exchange (call 0), then two data requests.
    expect(fetch.calls.filter((c) => c.url === "/api/token")).toHaveLength(1);
    expect(fetch.calls.filter((c) => c.url.includes("/api/db/projects"))).toHaveLength(2);
    client.close();
  });

  it("raises TokenError on bad credential", async () => {
    // Custom fetch that rejects the token exchange.
    const customFetch = async (input: string) => {
      if (input.includes("/api/token")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: { code: "invalid_credential", message: "Bad key" } }),
          text: async () => JSON.stringify({ error: { code: "invalid_credential", message: "Bad key" } }),
        };
      }
      throw new Error("unexpected");
    };

    const client = new SheetbaseClient({
      baseUrl: BASE_URL,
      credential: CREDENTIAL,
      scopes: ["projects:read"],
      fetch: customFetch,
    });

    await expect(client.projects.list()).rejects.toThrow(TokenError);
    client.close();
  });

  it("raises DataPathError on 4xx", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/projects",
        handler: () => ({
          status: 403,
          json: { error: { category: "permission_denied", message: "No scope" } },
        }),
      },
    ]);
    await expect(client.projects.list()).rejects.toThrow("permission_denied");
    client.close();
  });

  it("raises NotFoundError on not_found category", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/projects",
        handler: () => ({
          status: 404,
          json: { error: { category: "not_found", message: "Not found" } },
        }),
      },
    ]);
    await expect(client.projects.get("nonexistent")).rejects.toThrow(NotFoundError);
    client.close();
  });

  it("rpc escape hatch works", async () => {
    const { client, fetch } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/search",
        handler: () => ({ status: 200, json: [] }),
      },
    ]);
    await client.rpc("search", { query: "test", limit: 10 });
    const dataCall = fetch.calls.find((c) => c.url.includes("/api/db/rpc/search"));
    expect(dataCall).toBeDefined();
    const body = JSON.parse(dataCall!.body!);
    expect(body.p_query).toBe("test");
    expect(body.p_limit).toBe(10);
    client.close();
  });

  it("raw tableGet works", async () => {
    const { client, fetch } = makeClient([
      {
        method: "GET",
        path: "/api/db/projects",
        handler: () => ({ status: 200, json: [] }),
      },
    ]);
    await client.tableGet("projects", { params: { select: "key,title" } });
    const dataCall = fetch.calls.find((c) => c.url.includes("/api/db/projects"));
    expect(dataCall).toBeDefined();
    expect(dataCall!.url).toContain("select=key%2Ctitle");
    client.close();
  });

  it("version property returns SDK version", () => {
    const { client } = makeClient();
    expect(client.version).toBe("0.1.0");
    client.close();
  });
});
