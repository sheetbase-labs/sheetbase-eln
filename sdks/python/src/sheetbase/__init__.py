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
from sheetbase._version import __version__
from sheetbase.client import SheetbaseClient
from sheetbase.async_client import AsyncSheetbaseClient
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
)

__all__ = [
    "__version__",
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
]
