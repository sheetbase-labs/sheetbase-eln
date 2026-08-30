/**
 * HTTP transport for the Sheetbase SDK.
 *
 * Uses the global `fetch` API (available in Node 18+ and all modern browsers).
 * Handles:
 * - credential exchange and automatic token refresh;
 * - the `Authorization: Bearer` header on every data request;
 * - stable error envelope parsing (token path vs data path);
 * - PostgREST query-parameter serialisation for table reads.
 */
import { VERSION } from "./version.js";
import { TokenError, dataPathError } from "./errors.js";

export interface FetchLike {
  (input: string, init?: FetchInit): Promise<FetchResponse>;
}

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface RequestOptions {
  params?: Record<string, string | number | undefined>;
  jsonBody?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export class HttpTransport {
  readonly baseUrl: string;
  readonly credential: string;
  readonly scopes: string[];

  private readonly tokenTtlBuffer: number;
  private readonly fetchFn: FetchLike;
  private token: string | null = null;
  private tokenExpires = 0;

  constructor(
    baseUrl: string,
    credential: string,
    scopes: string[],
    options?: {
      timeout?: number;
      tokenTtlBuffer?: number;
      fetch?: FetchLike;
    },
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.credential = credential;
    this.scopes = scopes;

    this.tokenTtlBuffer = options?.tokenTtlBuffer ?? 30;
    this.fetchFn = options?.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // ── token management ────────────────────────────────────────────────

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpires) {
      return this.token;
    }
    await this.exchange();
    return this.token!;
  }

  private async exchange(): Promise<void> {
    const resp = await this.fetchFn(`${this.baseUrl}/api/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `sheetbase-ts/${VERSION}`,
      },
      body: JSON.stringify({
        credential: this.credential,
        scopes: this.scopes,
      }),
    });

    if (!resp.ok) {
      const body = await safeJson(resp);
      const err = (body as Record<string, any>)?.error ?? {};
      throw new TokenError(
        err.code ?? "server_error",
        err.message ?? "Token exchange failed.",
      );
    }

    const data = (await resp.json()) as Record<string, any>;
    this.token = data.token;
    // Default TTL is 300s; refresh early to avoid edge-case expiry.
    this.tokenExpires = Date.now() + (300 - this.tokenTtlBuffer) * 1000;
  }

  // ── data requests ───────────────────────────────────────────────────

  async request(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<any> {
    const token = await this.ensureToken();
    const url = buildUrl(`${this.baseUrl}${path}`, options?.params);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "User-Agent": `sheetbase-ts/${VERSION}`,
    };
    if (options?.jsonBody) {
      headers["Content-Type"] = "application/json";
    }
    if (options?.headers) {
      Object.assign(headers, options.headers);
    }

    const resp = await this.fetchFn(url, {
      method,
      headers,
      body: options?.jsonBody ? JSON.stringify(options.jsonBody) : undefined,
    });

    return handleResponse(resp);
  }

  async get(
    path: string,
    options?: RequestOptions,
  ): Promise<any> {
    return this.request("GET", path, options);
  }

  async post(
    path: string,
    options?: RequestOptions,
  ): Promise<any> {
    return this.request("POST", path, options);
  }

  async patch(
    path: string,
    options?: RequestOptions,
  ): Promise<any> {
    return this.request("PATCH", path, options);
  }

  async delete(
    path: string,
    options?: RequestOptions,
  ): Promise<any> {
    return this.request("DELETE", path, options);
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function buildUrl(
  base: string,
  params?: Record<string, string | number | undefined>,
): string {
  if (!params) return base;
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return base;
  const qs = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${base}?${qs}`;
}

async function safeJson(resp: FetchResponse): Promise<unknown> {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

async function handleResponse(resp: FetchResponse): Promise<any> {
  if (resp.status < 400) {
    if (resp.status === 204) return null;
    const text = await resp.text();
    if (!text) return null;
    return JSON.parse(text);
  }

  const body = (await safeJson(resp)) as Record<string, any> | null;
  const err = body?.error ?? {};

  // Token path errors have `code`; data path errors have `category`.
  if (err.code) {
    throw new TokenError(err.code, err.message ?? "Request failed.");
  }
  if (err.category) {
    throw dataPathError(err.category, err.message ?? "Request failed.", err.request_id);
  }
  // Unknown error shape — fall back to a generic data-path error.
  throw dataPathError("server_error", err.message ?? `HTTP ${resp.status}`);
}
