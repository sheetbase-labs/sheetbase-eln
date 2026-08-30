"""Pagination iterators for the Sheetbase SDK.

PostgREST table reads use ``limit``/``offset`` query parameters and optionally
``Prefer: count=exact`` for total counts. RPC data windows (``query_dataset_rows``,
``query_sheet_instance_rows``, ``search``) embed ``hasMore`` / ``totalCount`` in
the response body.

This module provides generator-based iterators that abstract over both shapes
so callers can simply ``for row in client.datasets.iter_rows(dataset_id):``.
"""
from __future__ import annotations

from collections.abc import Iterator
from typing import Any, Callable, Optional, Protocol


class TablePageFetcher(Protocol):
    """Fetches one page of table rows from PostgREST."""

    def __call__(
        self,
        *,
        limit: int,
        offset: int,
    ) -> list[dict[str, Any]]: ...


class RpcPageFetcher(Protocol):
    """Fetches one page of RPC rows that include ``hasMore``/``totalCount``."""

    def __call__(
        self,
        *,
        limit: int,
        offset: int,
    ) -> dict[str, Any]: ...


def iter_table(
    fetch_page: TablePageFetcher,
    *,
    page_size: int = 100,
    max_items: Optional[int] = None,
) -> Iterator[dict[str, Any]]:
    """Iterate PostgREST table rows with ``limit``/``offset`` pagination.

    Stops when a page returns fewer than ``page_size`` rows (indicating the
    last page) or when ``max_items`` is reached.
    """
    offset = 0
    yielded = 0
    while True:
        remaining = None if max_items is None else max_items - yielded
        limit = page_size if remaining is None else min(page_size, remaining)
        if limit <= 0:
            break
        page = fetch_page(limit=limit, offset=offset)
        if not page:
            break
        for row in page:
            yield row
            yielded += 1
            if max_items is not None and yielded >= max_items:
                return
        if len(page) < limit:
            break
        offset += len(page)


def iter_rpc(
    fetch_page: RpcPageFetcher,
    *,
    page_size: int = 200,
    max_items: Optional[int] = None,
) -> Iterator[dict[str, Any]]:
    """Iterate RPC rows whose response includes ``hasMore``.

    The ``fetch_page`` callable receives ``limit``/``offset`` and returns the
    full RPC response dict. Rows are read from the ``rows`` key.
    """
    offset = 0
    yielded = 0
    while True:
        remaining = None if max_items is None else max_items - yielded
        limit = page_size if remaining is None else min(page_size, remaining)
        if limit <= 0:
            break
        result = fetch_page(limit=limit, offset=offset)
        rows = result.get("rows", [])
        if not rows:
            break
        for row in rows:
            yield row
            yielded += 1
            if max_items is not None and yielded >= max_items:
                return
        has_more = result.get("hasMore", False)
        if not has_more:
            break
        offset += len(rows)
