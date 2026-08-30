"""Synchronous Sheetbase client.

The main entry point for the SDK. Handles credential exchange, automatic
token refresh, and exposes typed resource accessors.

Usage::

    from sheetbase import SheetbaseClient

    client = SheetbaseClient(
        base_url="https://app.sheetbase.co.uk",
        credential="sb_01234567_...",
        scopes=["datasets:read", "datasets:write"],
    )

    # List projects
    projects = client.projects.list()

    # Query dataset rows
    page = client.datasets.query_rows(dataset_id="...")
    df = page.to_dataframe()

    # Commit with idempotency
    client.datasets.commit_rows(
        dataset_id="...",
        expected_revision=3,
        rows=[{"operation": "create", "rowId": str(uuid.uuid4()), "values": {...}}],
    )

    # Context manager closes the HTTP connection pool
    with SheetbaseClient(...) as client:
        ...
"""
from __future__ import annotations

from typing import Any, Optional, Sequence

import httpx

from sheetbase._http import HttpTransport, TableHead
from sheetbase._version import API_VERSION, __version__
from sheetbase.resources import (
    AgentOperationsResource,
    CataloguesResource,
    DatasetsResource,
    ProjectsResource,
    RecordsResource,
    SearchResource,
    SheetsResource,
    WebhooksResource,
)


class SheetbaseClient:
    """Synchronous Sheetbase API client.

    Args:
        base_url: Sheetbase instance URL (e.g. ``https://app.sheetbase.co.uk``).
        credential: Full credential string ``sb_<prefix>_<secret>``.
        scopes: List of canonical scope strings (e.g. ``["datasets:read"]``).
        timeout: Request timeout in seconds.
        client: Optional pre-configured ``httpx.Client``.
    """

    def __init__(
        self,
        base_url: str,
        credential: str,
        scopes: Sequence[str],
        *,
        timeout: float = 30.0,
        client: Optional[httpx.Client] = None,
    ) -> None:
        self._transport = HttpTransport(
            base_url=base_url,
            credential=credential,
            scopes=scopes,
            timeout=timeout,
            client=client,
        )

        self.projects = ProjectsResource(self._transport)
        self.records = RecordsResource(self._transport)
        self.datasets = DatasetsResource(self._transport)
        self.sheets = SheetsResource(self._transport)
        self.search = SearchResource(self._transport)
        self.catalogues = CataloguesResource(self._transport)
        self.agent_operations = AgentOperationsResource(self._transport)
        self.webhooks = WebhooksResource(self._transport)

    # ── raw access ──────────────────────────────────────────────────────

    def rpc(self, name: str, **params: Any) -> Any:
        """Call an allowlisted RPC directly with ``p_*`` parameters.

        ``client.rpc("query_dataset_rows", p_dataset_id="...", p_limit=100)``
        is equivalent to ``client.datasets.query_rows(dataset_id="...", limit=100)``
        but provides an escape hatch for RPCs not yet wrapped by a resource.
        """
        body = {f"p_{k}" if not k.startswith("p_") else k: v for k, v in params.items()}
        return self._transport.post(f"/api/db/rpc/{name}", json_body=body)

    def table_get(
        self,
        resource: str,
        *,
        params: Optional[dict[str, Any]] = None,
    ) -> Any:
        """Raw GET on a PostgREST table resource."""
        return self._transport.get(f"/api/db/{resource}", params=params)

    def table_post(
        self,
        resource: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json_body: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        """Raw POST on a PostgREST table resource."""
        return self._transport.post(
            f"/api/db/{resource}",
            params=params,
            json_body=json_body,
            headers=headers,
        )

    def table_patch(
        self,
        resource: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json_body: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        """Raw PATCH on a PostgREST table resource."""
        return self._transport.patch(
            f"/api/db/{resource}",
            params=params,
            json_body=json_body,
            headers=headers,
        )

    def table_head(
        self,
        resource: str,
        *,
        params: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> TableHead:
        """HEAD a table, including ``Content-Range`` count metadata."""
        return self._transport.head(
            f"/api/db/{resource}", params=params, headers=headers
        )

    # ── properties ──────────────────────────────────────────────────────

    @property
    def version(self) -> str:
        """SDK version."""
        return __version__

    @property
    def api_version(self) -> str:
        """Exact targeted OpenAPI contract version."""
        return API_VERSION

    # ── lifecycle ───────────────────────────────────────────────────────

    def close(self) -> None:
        """Close the underlying HTTP connection pool."""
        self._transport.close()

    def __enter__(self) -> SheetbaseClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
