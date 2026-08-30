"""Search resource — workspace search and model record search."""
from __future__ import annotations

from collections.abc import Iterator
from typing import Any, Optional

from sheetbase._http import HttpTransport
from sheetbase._pagination import iter_rpc
from sheetbase._query_result import SearchPage
from sheetbase.types import SearchResult


class SearchResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    def search(
        self,
        *,
        query: str = "",
        project_id: Optional[str] = None,
        kind: Optional[str] = None,
        status: Optional[str] = None,
        owner_id: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> SearchPage:
        """Workspace search. Returns one page of results."""
        body: dict[str, Any] = {
            "p_query": query,
            "p_limit": limit,
            "p_offset": offset,
        }
        if project_id:
            body["p_project_id"] = project_id
        if kind:
            body["p_kind"] = kind
        if status:
            body["p_status"] = status
        if owner_id:
            body["p_owner_id"] = owner_id
        if date_from:
            body["p_date_from"] = date_from
        if date_to:
            body["p_date_to"] = date_to
        results = self._transport.post(
            "/api/db/rpc/search", json_body=body
        )
        total = results[0]["total_count"] if results else 0
        return SearchPage(results, total)

    def search_sheet_records(
        self,
        *,
        model_key: Optional[str] = None,
        query: str = "",
        include_archived: bool = False,
        limit: int = 25,
    ) -> list[dict[str, Any]]:
        """Search records by model. No offset — single page."""
        body: dict[str, Any] = {
            "p_query": query,
            "p_include_archived": include_archived,
            "p_limit": limit,
        }
        if model_key:
            body["p_model_key"] = model_key
        return self._transport.post(
            "/api/db/rpc/search_sheet_records", json_body=body
        )

    def iter(
        self,
        *,
        query: str = "",
        project_id: Optional[str] = None,
        kind: Optional[str] = None,
        status: Optional[str] = None,
        owner_id: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        page_size: int = 100,
        max_items: Optional[int] = None,
    ) -> Iterator[SearchResult]:
        """Iterate all search results with auto-pagination."""
        def fetch(*, limit: int, offset: int) -> dict[str, Any]:
            body: dict[str, Any] = {
                "p_query": query,
                "p_limit": limit,
                "p_offset": offset,
            }
            if project_id:
                body["p_project_id"] = project_id
            if kind:
                body["p_kind"] = kind
            if status:
                body["p_status"] = status
            if owner_id:
                body["p_owner_id"] = owner_id
            if date_from:
                body["p_date_from"] = date_from
            if date_to:
                body["p_date_to"] = date_to
            results = self._transport.post(
                "/api/db/rpc/search", json_body=body
            )
            # The search RPC returns a flat array with total_count on each row.
            # Wrap it for iter_rpc which expects a dict with "rows" and "hasMore".
            total = results[0]["total_count"] if results else 0
            has_more = (offset + len(results)) < total
            return {"rows": results, "hasMore": has_more}

        for row in iter_rpc(fetch, page_size=page_size, max_items=max_items):
            yield SearchResult.from_dict(row)
