/**
 * Stable exception hierarchy for the Sheetbase TypeScript SDK.
 *
 * The public API contract (docs/api/public-api-contract.md §6) defines two error
 * surfaces:
 *
 * - **Token path** (`POST /api/token`): `{ error: { code, message } }`
 * - **Data path** (`/api/db/*`): `{ error: { category, message, request_id? } }`
 *
 * This module maps both surfaces to a typed exception hierarchy so callers
 * can catch by semantic meaning rather than parsing strings.
 */

export const TOKEN_ERROR_CODES = [
  "invalid_request",
  "invalid_scope",
  "invalid_credential",
  "revoked",
  "expired",
  "insufficient_scope",
  "rate_limited",
  "server_error",
] as const;

export type TokenErrorCode = (typeof TOKEN_ERROR_CODES)[number];

export const ERROR_CATEGORIES = [
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
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export class SheetbaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetbaseError";
  }
}

// ── Token-path errors ──────────────────────────────────────────────────────

export class TokenError extends SheetbaseError {
  readonly code: TokenErrorCode | string;

  constructor(code: TokenErrorCode | string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "TokenError";
    this.code = code;
  }
}

// ── Data-path errors ───────────────────────────────────────────────────────

export class DataPathError extends SheetbaseError {
  readonly category: ErrorCategory | string;
  readonly requestId: string | null;

  constructor(
    category: ErrorCategory | string,
    message: string,
    requestId?: string | null,
  ) {
    const detail = requestId
      ? `[${category}] ${message} (request_id=${requestId})`
      : `[${category}] ${message}`;
    super(detail);
    this.name = "DataPathError";
    this.category = category;
    this.requestId = requestId ?? null;
  }
}

// Concrete data-path categories, matching the contract §6.2.

export class ValidationError extends DataPathError {}
export class NotFoundError extends DataPathError {}
export class PermissionDeniedError extends DataPathError {}
export class UnauthenticatedError extends DataPathError {}
export class StaleVersionError extends DataPathError {}
export class ConflictError extends DataPathError {}
export class MissingLinkError extends DataPathError {}
export class InvalidTransitionError extends DataPathError {}
export class InvalidPropertiesError extends DataPathError {}
export class TemplateNotInstantiableError extends DataPathError {}
export class RateLimitedError extends DataPathError {}
export class ServiceUnavailableError extends DataPathError {}
export class ServerError extends DataPathError {}

const CATEGORY_MAP: Record<
  string,
  new (
    category: string,
    message: string,
    requestId?: string | null,
  ) => DataPathError
> = {
  validation_error: ValidationError,
  not_found: NotFoundError,
  permission_denied: PermissionDeniedError,
  unauthenticated: UnauthenticatedError,
  stale_version: StaleVersionError,
  conflict: ConflictError,
  missing_link: MissingLinkError,
  invalid_transition: InvalidTransitionError,
  invalid_properties: InvalidPropertiesError,
  template_not_instantiable: TemplateNotInstantiableError,
  rate_limited: RateLimitedError,
  service_unavailable: ServiceUnavailableError,
  server_error: ServerError,
};

export function dataPathError(
  category: string,
  message: string,
  requestId?: string | null,
): DataPathError {
  const Cls = CATEGORY_MAP[category] ?? DataPathError;
  return new Cls(category, message, requestId);
}
