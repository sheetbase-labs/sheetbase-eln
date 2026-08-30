/**
 * Test helpers — mock fetch for the Sheetbase TypeScript SDK.
 */
import type { FetchLike, FetchResponse } from "../src/http.js";

export const BASE_URL = "https://api.example.com";
export const CREDENTIAL = "sb_01234567_abcdef0123456789abcdef0123456789abcdef";
export const TOKEN = "fake-jwt-token";

export interface MockRoute {
  method: string;
  path: string;
  handler: (call: { url: string; method: string; body: string | undefined }) => {
    status: number;
    json?: unknown;
    text?: string;
  };
}

/**
 * Creates a mock fetch that:
 * - always returns 200 + { token } for POST /api/token
 * - routes other requests based on the provided routes
 */
export function createMockFetch(routes: MockRoute[] = []): FetchLike & {
  calls: { url: string; method: string; body: string | undefined }[];
} {
  const calls: { url: string; method: string; body: string | undefined }[] = [];

  const fn: FetchLike = async (input: string, init?: any) => {
    const url = new URL(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body as string | undefined;
    calls.push({ url: url.pathname + url.search, method, body });

    // Token exchange — always succeeds.
    if (url.pathname === "/api/token" && method === "POST") {
      return makeResponse(200, { token: TOKEN });
    }

    // Find matching route.
    for (const route of routes) {
      if (route.method !== method) continue;
      // Match exact path (without query string) or path pattern.
      const routePath = route.path;
      const requestPath = url.pathname;
      if (requestPath === routePath) {
        const result = route.handler({ url: url.pathname + url.search, method, body });
        return makeResponse(result.status, result.json, result.text);
      }
    }

    // Default: 404
    return makeResponse(404, { error: { category: "not_found", message: "Not found" } });
  };

  return Object.assign(fn, { calls });
}

function makeResponse(
  status: number,
  json?: unknown,
  text?: string,
): FetchResponse {
  const body = json !== undefined ? JSON.stringify(json) : (text ?? "");
  return {
    ok: status < 400,
    status,
    async json() {
      return JSON.parse(body);
    },
    async text() {
      return body;
    },
  };
}

// ── response side_effect helper (like respx side_effect) ───────────────────

export function responses(
  ...responses: { status: number; json?: unknown; text?: string }[]
) {
  let i = 0;
  return () => {
    if (i >= responses.length) {
      throw new Error(`Mock responses exhausted (got ${responses.length} calls)`);
    }
    return responses[i++];
  };
}

// ── test fixtures ──────────────────────────────────────────────────────────

export const projectRow = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  workspace_id: "550e8400-e29b-41d4-a716-446655440001",
  key: "lenti-purification",
  title: "Lentivector Purification",
  status: "active",
  created_at: "2026-01-15T10:30:00Z",
  updated_at: "2026-01-16T08:00:00Z",
  archived_at: null,
  custom_fields: { protocol: "Protocol A" },
};

export const recordRow = {
  id: "660e8400-e29b-41d4-a716-446655440010",
  workspace_id: "550e8400-e29b-41d4-a716-446655440001",
  project_id: "550e8400-e29b-41d4-a716-446655440000",
  folder_id: null,
  kind: "experiment",
  identifier: "EXP-2026-0001",
  title: "Purification Run 1",
  status: "in-progress",
  tags: ["lentivector", "purification"],
  structure_version: 1,
  metadata_version: 1,
  created_at: "2026-01-15T10:30:00Z",
  updated_at: "2026-01-16T08:00:00Z",
  archived_at: null,
  deleted_at: null,
  created_by_user_id: "user-001",
  updated_by_user_id: null,
  updated_by_credential_id: null,
  calculation_input_revision: 0,
  properties: { concentration: 1.2e9 },
  locked_at: null,
  locked_by_revision_id: null,
  custom_fields: { cell_line: "HEK293T" },
  source_notebook_template_version_id: null,
};

export const datasetRow = {
  id: "770e8400-e29b-41d4-a716-446655440020",
  workspace_id: "550e8400-e29b-41d4-a716-446655440001",
  schema_version_id: "880e8400-e29b-41d4-a716-446655440030",
  name: "Purification Data",
  description: "Lentivector purification runs",
  lifecycle: "active",
  revision: 3,
  created_at: "2026-01-15T10:30:00Z",
  updated_at: "2026-01-16T08:00:00Z",
  primary_project_id: "550e8400-e29b-41d4-a716-446655440000",
  created_by_user_id: "user-001",
  created_by_credential_id: null,
};

export const datasetRowsResponse = {
  datasetId: "770e8400-e29b-41d4-a716-446655440020",
  datasetRevision: 3,
  offset: 0,
  limit: 200,
  totalCount: 2,
  hasMore: false,
  rows: [
    {
      rowId: "aaa11111-2222-3333-4444-555555555501",
      revision: 1,
      values: {
        "fff00000-0000-0000-0000-000000000001": 1.2e9,
        "fff00000-0000-0000-0000-000000000002": "HEK293T",
      },
    },
    {
      rowId: "aaa11111-2222-3333-4444-555555555502",
      revision: 1,
      values: {
        "fff00000-0000-0000-0000-000000000001": 8.5e8,
        "fff00000-0000-0000-0000-000000000002": "Vero",
      },
    },
  ],
};

export const commitResponse = {
  ok: true,
  datasetId: "770e8400-e29b-41d4-a716-446655440020",
  datasetRevision: 4,
  rows: [
    {
      rowId: "bbb11111-2222-3333-4444-555555555501",
      revision: 1,
      operation: "create",
    },
  ],
  idempotent: false,
};
