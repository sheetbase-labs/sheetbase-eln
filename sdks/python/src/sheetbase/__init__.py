"""Sheetbase Python SDK.

A typed client for the Sheetbase ELN public API. Scientific Python users can
query datasets, commit rows, manage projects/records and search the workspace
without hand-writing HTTP.

Usage::

    from sheetbase import SheetbaseClient

    client = SheetbaseClient(
        base_url="https://app.sheetbase.co.uk",
        credential="sb_01234567_...",
        scopes=["datasets:read", "datasets:write"],
    )

    rows = client.datasets.query_rows(dataset_id="...")
    df = rows.to_dataframe()

    client.datasets.commit_rows(
        dataset_id="...",
        expected_revision=3,
        rows=[{"operation": "create", "rowId": str(uuid.uuid4()), "values": {...}}],
    )
"""
from sheetbase._http import TableHead
from sheetbase._version import API_VERSION, __version__
from sheetbase.client import SheetbaseClient
from sheetbase.async_client import AsyncSheetbaseClient
from sheetbase._pipeline_source import (
    apply_step_source,
    notebook_to_python,
    parse_requirements,
)
from sheetbase.errors import (
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
    ERROR_CATEGORIES,
    TOKEN_ERROR_CODES,
)

__all__ = [
    "__version__",
    "API_VERSION",
    "TableHead",
    "SheetbaseClient",
    "AsyncSheetbaseClient",
    "SheetbaseError",
    "TokenError",
    "DataPathError",
    "ValidationError",
    "NotFoundError",
    "PermissionDeniedError",
    "UnauthenticatedError",
    "StaleVersionError",
    "ConflictError",
    "MissingLinkError",
    "InvalidTransitionError",
    "InvalidPropertiesError",
    "TemplateNotInstantiableError",
    "RateLimitedError",
    "ServiceUnavailableError",
    "ServerError",
    "ERROR_CATEGORIES",
    "TOKEN_ERROR_CODES",
    "apply_step_source",
    "notebook_to_python",
    "parse_requirements",
]
