/**
 * Synchronous-style async Sheetbase client.
 *
 * The main entry point for the SDK. All methods are async (fetch is
 * inherently async). Handles credential exchange, automatic token refresh,
 * and exposes typed resource accessors.
 *
 * Usage:
 *
 * ```ts
 * import { SheetbaseClient } from "@sheetbase/eln-sdk";
 *
 * const client = new SheetbaseClient({
 *   baseUrl: "https://app.sheetbase.co.uk",
 *   credential: "sb_01234567_...",
 *   scopes: ["datasets:read", "datasets:write"],
 * });
 *
 * const projects = await client.projects.list();
 * const page = await client.datasets.queryRows({ datasetId: "..." });
 *
 * client.close();
 * ```
 */
import {
  HttpTransport,
  type FetchLike,
  type RequestOptions,
  type TableHead,
} from "./http.js";
import { API_VERSION, VERSION } from "./version.js";
import {
  AgentOperationsResource,
  ProjectsResource,
  RecordsResource,
  DatasetsResource,
  SheetsResource,
  SearchResource,
  CataloguesResource,
  WebhooksResource,
} from "./resources/index.js";

export interface SheetbaseClientOptions {
  baseUrl: string;
  credential: string;
  scopes: string[];
  timeout?: number;
  fetch?: FetchLike;
}

export class SheetbaseClient {
  private transport: HttpTransport;

  readonly projects: ProjectsResource;
  readonly records: RecordsResource;
  readonly datasets: DatasetsResource;
  readonly sheets: SheetsResource;
  readonly search: SearchResource;
  readonly catalogues: CataloguesResource;
  readonly agentOperations: AgentOperationsResource;
  readonly webhooks: WebhooksResource;

  constructor(options: SheetbaseClientOptions) {
    this.transport = new HttpTransport(
      options.baseUrl,
      options.credential,
      options.scopes,
      {
        timeout: options.timeout,
        fetch: options.fetch,
      },
    );

    this.projects = new ProjectsResource(this.transport);
    this.records = new RecordsResource(this.transport);
    this.datasets = new DatasetsResource(this.transport);
    this.sheets = new SheetsResource(this.transport);
    this.search = new SearchResource(this.transport);
    this.catalogues = new CataloguesResource(this.transport);
    this.agentOperations = new AgentOperationsResource(this.transport);
    this.webhooks = new WebhooksResource(this.transport);
  }

  // ── raw access ──────────────────────────────────────────────────────

  async rpc(name: string, params: Record<string, unknown>): Promise<any> {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      body[k.startsWith("p_") ? k : `p_${k}`] = v;
    }
    return this.transport.post(`/api/db/rpc/${name}`, { jsonBody: body });
  }

  async tableGet(
    resource: string,
    options?: { params?: Record<string, string | number | undefined> },
  ): Promise<any> {
    return this.transport.get(`/api/db/${resource}`, options);
  }

  async tablePost(resource: string, options?: RequestOptions): Promise<any> {
    return this.transport.post(`/api/db/${resource}`, options);
  }

  async tablePatch(resource: string, options?: RequestOptions): Promise<any> {
    return this.transport.patch(`/api/db/${resource}`, options);
  }

  async tableHead(
    resource: string,
    options?: RequestOptions,
  ): Promise<TableHead> {
    return this.transport.head(`/api/db/${resource}`, options);
  }

  // ── properties ──────────────────────────────────────────────────────

  get version(): string {
    return VERSION;
  }

  get apiVersion(): string {
    return API_VERSION;
  }

  // ── lifecycle ───────────────────────────────────────────────────────

  close(): void {
    // fetch has no persistent connection pool to close.
    // This method exists for API symmetry with the Python SDK
    // and to allow future transport implementations.
  }
}
