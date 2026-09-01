import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  API_VERSION,
  ERROR_CATEGORIES,
  SheetbaseClient,
  TOKEN_ERROR_CODES,
} from "../src/index.js";
import {
  BASE_URL,
  CREDENTIAL,
  createMockFetch,
  type MockRoute,
} from "./helpers.js";

// SDK-03 compatibility: this package pins one public API contract version.
// The committed contract and support matrix are the authoritative sources;
// if the contract advances without this SDK following, the suite fails.
const sdksRoot = new URL("../../", import.meta.url);
const openApiInfo = (
  JSON.parse(
    readFileSync(
      new URL("../docs/openapi/external-api-v0.json", sdksRoot),
      "utf8",
    ),
  ) as { info: { version: string } }
).info;
const matrixContract = (
  JSON.parse(
    readFileSync(new URL("support-matrix.json", sdksRoot), "utf8"),
  ) as {
    contract: {
      apiVersion: string;
      tokenErrorCodes: string[];
      errorCategories: string[];
    };
  }
).contract;

function makeClient(paths: string[]) {
  const routes: MockRoute[] = paths.map((path) => ({
    method: "POST",
    path,
    handler: () => ({ status: 200, json: {} }),
  }));
  const fetch = createMockFetch(routes);
  const client = new SheetbaseClient({
    baseUrl: BASE_URL,
    credential: CREDENTIAL,
    scopes: [],
    fetch,
  });
  const body = (path: string) =>
    JSON.parse(fetch.calls.find((call) => call.url === path)!.body!);
  return { client, fetch, body };
}

const provenance = {
  agentId: "agent-1",
  tool: { name: "sheetbase.dataset_schema.draft" },
  model: { provider: "example", name: "model" },
  invocationId: "invocation-1",
};

describe("public contract parity", () => {
  it("exports the exact API version and stable error vocabularies", () => {
    const { client } = makeClient([]);
    expect(API_VERSION).toBe("0.1.0");
    expect(client.apiVersion).toBe(API_VERSION);
    expect(TOKEN_ERROR_CODES).toEqual([
      "invalid_request",
      "invalid_scope",
      "invalid_credential",
      "revoked",
      "expired",
      "insufficient_scope",
      "rate_limited",
      "server_error",
    ]);
    expect(ERROR_CATEGORIES).toEqual([
      "validation_error",
      "not_found",
      "permission_denied",
      "conflict",
      "stale_version",
      "missing_link",
      "invalid_transition",
      "invalid_properties",
      "template_not_instantiable",
      "unauthenticated",
      "rate_limited",
      "service_unavailable",
      "server_error",
    ]);
  });

  it("targets the committed public contract version and matrix taxonomy", () => {
    expect(API_VERSION).toBe(openApiInfo.version);
    expect(API_VERSION).toBe(matrixContract.apiVersion);
    expect([...TOKEN_ERROR_CODES]).toEqual(matrixContract.tokenErrorCodes);
    expect([...ERROR_CATEGORIES]).toEqual(matrixContract.errorCategories);
  });

  it("parses table HEAD count and request metadata", async () => {
    const fetch = createMockFetch([
      {
        method: "HEAD",
        path: "/api/db/records",
        handler: () => ({
          status: 200,
          headers: {
            "Content-Range": "0-24/143",
            "X-Request-Id": "request-1",
          },
        }),
      },
    ]);
    const client = new SheetbaseClient({
      baseUrl: BASE_URL,
      credential: CREDENTIAL,
      scopes: ["projects:read"],
      fetch,
    });

    await expect(
      client.tableHead("records", {
        params: { project_id: "eq.project-1" },
        headers: { Prefer: "count=exact" },
      }),
    ).resolves.toEqual({
      status: 200,
      contentRange: "0-24/143",
      totalCount: 143,
      requestId: "request-1",
    });
    expect(fetch.calls[1]).toMatchObject({
      method: "HEAD",
      url: "/api/db/records?project_id=eq.project-1",
      headers: { Prefer: "count=exact" },
    });
  });

  it("forwards canonical agent proposal and workflow JSON", async () => {
    const paths = [
      "/api/db/rpc/propose_agent_operation",
      "/api/db/rpc/create_agent_workflow",
    ];
    const { client, body } = makeClient(paths);
    const operation = {
      kind: "dataset_rows.commit",
      datasetId: "dataset-1",
      expectedRevision: 2,
      rows: [{ operation: "create", rowId: "row-1", values: {} }],
    };
    await client.agentOperations.propose({
      workspaceId: "workspace-1",
      title: "Commit rows",
      summary: "Commit one bounded row batch",
      operation,
      provenance,
      idempotencyKey: "proposal-1",
    });
    const plan = {
      formatVersion: 1 as const,
      steps: [
        {
          key: "commit-a",
          title: "Commit A",
          summary: "Commit first batch",
          tool: "sheetbase.dataset_rows.commit",
          operation,
          inputReferences: [],
        },
        {
          key: "commit-b",
          title: "Commit B",
          summary: "Commit second batch",
          tool: "sheetbase.dataset_rows.commit",
          operation,
          inputReferences: [],
        },
      ],
    };
    await client.agentOperations.createWorkflow({
      workspaceId: "workspace-1",
      goal: "Commit both batches",
      plan,
      budget: { maxOperations: 2, maxTokens: 100, maxCostMicrousd: 500 },
      initialUsage: { tokens: 0, costMicrousd: 0 },
      provenance,
      idempotencyKey: "workflow-1",
    });

    expect(body(paths[0])).toEqual({
      p_workspace_id: "workspace-1",
      p_title: "Commit rows",
      p_summary: "Commit one bounded row batch",
      p_operation: operation,
      p_provenance: provenance,
      p_idempotency_key: "proposal-1",
    });
    expect(body(paths[1])).toEqual({
      p_workspace_id: "workspace-1",
      p_goal: "Commit both batches",
      p_plan: plan,
      p_budget: { maxOperations: 2, maxTokens: 100, maxCostMicrousd: 500 },
      p_initial_usage: { tokens: 0, costMicrousd: 0 },
      p_provenance: provenance,
      p_idempotency_key: "workflow-1",
    });
  });

  it("omits absent optional webhook parameters and keeps pagination", async () => {
    const paths = [
      "/api/db/rpc/create_webhook_subscription",
      "/api/db/rpc/list_webhook_deliveries",
    ];
    const { client, body } = makeClient(paths);
    await client.webhooks.createSubscription({
      workspaceId: "workspace-1",
      key: "analysis-complete",
      url: "https://integration.example/hook",
    });
    await client.webhooks.listDeliveries({
      workspaceId: "workspace-1",
      subscriptionId: "subscription-1",
      status: "failed",
      limit: 25,
      offset: 50,
    });

    expect(body(paths[0])).toEqual({
      p_workspace_id: "workspace-1",
      p_key: "analysis-complete",
      p_url: "https://integration.example/hook",
    });
    expect(body(paths[1])).toEqual({
      p_workspace_id: "workspace-1",
      p_subscription_id: "subscription-1",
      p_status: "failed",
      p_limit: 25,
      p_offset: 50,
    });
  });
});
