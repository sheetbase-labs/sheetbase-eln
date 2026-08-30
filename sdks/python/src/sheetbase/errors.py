"""Stable exception hierarchy for the Sheetbase SDK.

The public API contract (docs/public-api-contract.md §6) defines two error
surfaces:

- **Token path** (`POST /api/token`): ``{ "error": { "code", "message" } }``
  where ``code`` is one of ``invalid_request``, ``invalid_scope``,
  ``invalid_credential``, ``revoked``, ``expired``, ``insufficient_scope``,
  ``rate_limited``, ``server_error``.

- **Data path** (``/api/db/*``): ``{ "error": { "category", "message",
  "request_id"? } }`` where ``category`` is one of the stable categories
  listed below.

This module maps both surfaces to a typed exception hierarchy so callers can
catch by semantic meaning rather than parsing strings.
"""
from __future__ import annotations

from typing import Optional


TOKEN_ERROR_CODES = (
    "invalid_request",
    "invalid_scope",
    "invalid_credential",
    "revoked",
    "expired",
    "insufficient_scope",
    "rate_limited",
    "server_error",
)

ERROR_CATEGORIES = (
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
)


class SheetbaseError(Exception):
    """Base exception for all SDK errors."""


# ── Token-path errors ──────────────────────────────────────────────────────


class TokenError(SheetbaseError):
    """Error from the token exchange endpoint.

    ``code`` is the stable string from the token error envelope.
    """

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(f"[{code}] {message}")


# ── Data-path errors ───────────────────────────────────────────────────────


class DataPathError(SheetbaseError):
    """Error from a ``/api/db/*`` data request.

    ``category`` is the stable string from the data error envelope.
    ``request_id`` is the server correlation id (may be ``None``).
    """

    def __init__(
        self,
        category: str,
        message: str,
        request_id: Optional[str] = None,
    ) -> None:
        self.category = category
        self.request_id = request_id
        detail = f"[{category}] {message}"
        if request_id:
            detail += f" (request_id={request_id})"
        super().__init__(detail)


# Concrete data-path categories, in the same order as the contract §6.2.


class ValidationError(DataPathError):
    """400 — bad input, constraint violation."""


class NotFoundError(DataPathError):
    """404 — resource missing or filtered by RLS."""


class PermissionDeniedError(DataPathError):
    """403 — RLS, scope, or revoked credential."""


class UnauthenticatedError(DataPathError):
    """401 — missing/invalid session or bearer token."""


class StaleVersionError(DataPathError):
    """409 — optimistic concurrency mismatch (SQLSTATE SB001)."""


class ConflictError(DataPathError):
    """409 — unique violation, serialization failure."""


class MissingLinkError(DataPathError):
    """422 — unresolved record link (SB002)."""


class InvalidTransitionError(DataPathError):
    """422 — disallowed lifecycle transition (SB004)."""


class InvalidPropertiesError(DataPathError):
    """422 — configurable property validation failed (SB005)."""


class TemplateNotInstantiableError(DataPathError):
    """422 — template wrong lifecycle (SB006)."""


class RateLimitedError(DataPathError):
    """429 — rate limited."""


class ServiceUnavailableError(DataPathError):
    """502/503 — PostgREST or upstream down."""


class ServerError(DataPathError):
    """500 — unclassified server error."""


# Mapping from category string to exception class.
_CATEGORY_MAP: dict[str, type[DataPathError]] = {
    "validation_error": ValidationError,
    "not_found": NotFoundError,
    "permission_denied": PermissionDeniedError,
    "unauthenticated": UnauthenticatedError,
    "stale_version": StaleVersionError,
    "conflict": ConflictError,
    "missing_link": MissingLinkError,
    "invalid_transition": InvalidTransitionError,
    "invalid_properties": InvalidPropertiesError,
    "template_not_instantiable": TemplateNotInstantiableError,
    "rate_limited": RateLimitedError,
    "service_unavailable": ServiceUnavailableError,
    "server_error": ServerError,
}

assert set(_CATEGORY_MAP) == set(ERROR_CATEGORIES)


def data_path_error(
    category: str,
    message: str,
    request_id: Optional[str] = None,
) -> DataPathError:
    """Build the correct ``DataPathError`` subclass for ``category``."""
    cls = _CATEGORY_MAP.get(category, DataPathError)
    return cls(category, message, request_id)
