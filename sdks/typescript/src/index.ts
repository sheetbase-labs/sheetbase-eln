/**
 * Sheetbase TypeScript SDK.
 *
 * A typed, isomorphic client for the Sheetbase ELN public API.
 * Application/integration developers can consume the public contract through
 * maintained types rather than internal app code.
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
 * ```
 */
export { VERSION, API_VERSION } from "./version.js";
export { SheetbaseClient } from "./client.js";
export type { SheetbaseClientOptions } from "./client.js";
export { HttpTransport } from "./http.js";
export type { FetchLike, FetchInit, FetchResponse, RequestOptions } from "./http.js";

export {
  SheetbaseError,
  TokenError,
  DataPathError,
  ValidationError,
  NotFoundError,
  PermissionDeniedError,
  UnauthenticatedError,
  StaleVersionError,
  ConflictError,
  MissingLinkError,
  InvalidTransitionError,
  InvalidPropertiesError,
  TemplateNotInstantiableError,
  RateLimitedError,
  ServiceUnavailableError,
  ServerError,
  dataPathError,
} from "./errors.js";

export {
  ProjectsResource,
  RecordsResource,
  DatasetsResource,
  DatasetRowBatch,
  SheetsResource,
  SearchResource,
  CataloguesResource,
} from "./resources/index.js";
export type { DatasetRowOperation } from "./resources/index.js";

export type {
  Project,
  SheetbaseRecord,
  Dataset,
  DatasetVersion,
  DatasetRow,
  SheetInstance,
  SearchResult,
  CommitResult,
  CommitResultRow,
  ValidationResult,
  ValidationFailure,
  DatasetRowPage,
  DatasetVersionRowPage,
  SearchPage,
} from "./types.js";
