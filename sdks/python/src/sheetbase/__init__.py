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

    # Every public table and RPC, typed from the OpenAPI contract
    active = client.tables.projects.list(where={"status": "active"})
    for record in client.tables.records.iter(where={"project_id": "..."}):
        ...
    client.rpc.create_project(title="Assay development")

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
from sheetbase._generated import AsyncRpc, AsyncTables, Rpc, Tables
from sheetbase._unset import UNSET, Unset
from sheetbase.resources.events import (
    EVENT_NAMES,
    WebhookEventPayload,
    WebhookSignatureError,
    parse_webhook,
    verify_webhook_signature,
)
from sheetbase.resources.event_stream import CursorExpiredError, EventStreamResource
from sheetbase.resources.plugins import PluginsResource
from sheetbase.parsers import ParsedFile, ParseError, ParserApp, ParserRequest
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
    "CursorExpiredError",
    "EventStreamResource",
    "PluginsResource",
    "__version__",
    "AsyncRpc",
    "AsyncTables",
    "EVENT_NAMES",
    "Rpc",
    "Tables",
    "UNSET",
    "Unset",
    "WebhookEventPayload",
    "WebhookSignatureError",
    "parse_webhook",
    "verify_webhook_signature",
    "ParsedFile",
    "ParseError",
    "ParserApp",
    "ParserRequest",
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
