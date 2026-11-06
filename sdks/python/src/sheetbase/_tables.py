"""Typed PostgREST table access, shared by the generated table classes.

Each public table in the OpenAPI contract gets a generated class in
``sheetbase._generated.tables`` built from the mixins below, so a table only
offers the HTTP methods the contract allows (most are read-only).

Filters:

- ``where`` takes plain equality: ``{"status": "active"}`` sends
  ``status=eq.active``. ``None`` becomes ``is.null``, a list or tuple becomes
  ``in.(a,b)`` and booleans are sent as ``true`` / ``false``.
- ``filters`` takes raw PostgREST operators for anything else:
  ``{"created_at": "gte.2026-01-01"}``.
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Iterator, Mapping, Sequence
from typing import Any, Generic, List, Optional, TypeVar, Union, cast

from sheetbase._http import AsyncHttpTransport, HttpTransport, TableHead
from sheetbase._pagination import iter_table

RowT = TypeVar("RowT")
InsertT = TypeVar("InsertT")
PatchT = TypeVar("PatchT")

Order = Union[str, Sequence[str], None]


def _literal(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _in_item(value: Any) -> str:
    text = _literal(value)
    if any(ch in text for ch in ',()"\\ '):
        escaped = text.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return text


def build_params(
    *,
    where: Optional[Mapping[str, Any]] = None,
    filters: Optional[Mapping[str, str]] = None,
    select: Optional[str] = None,
    order: Order = None,
    limit: Optional[int] = None,
    offset: Optional[int] = None,
) -> dict[str, Any]:
    """PostgREST query parameters for a table call."""
    params: dict[str, Any] = {}
    for column, value in (where or {}).items():
        if value is None:
            params[column] = "is.null"
        elif isinstance(value, (list, tuple, set, frozenset)):
            params[column] = "in.(" + ",".join(_in_item(v) for v in value) + ")"
        else:
            params[column] = f"eq.{_literal(value)}"
    for column, expression in (filters or {}).items():
        params[column] = expression
    if select is not None:
        params["select"] = select
    if order is not None:
        params["order"] = order if isinstance(order, str) else ",".join(order)
    if limit is not None:
        params["limit"] = limit
    if offset is not None:
        params["offset"] = offset
    return params


def _require_filter(where: Optional[Mapping[str, Any]], filters: Optional[Mapping[str, str]]) -> None:
    if not where and not filters:
        raise ValueError(
            "Updates and deletes need a row filter, e.g. where={'id': '...'}."
        )


def _rows(result: Any) -> List[Any]:
    if result is None:
        return []
    if isinstance(result, list):
        return result
    return [result]


class Table(Generic[RowT]):
    """A public table. Subclasses add the methods the contract allows."""

    #: Table name under ``/api/db``.
    name: str = ""

    def __init__(self, transport: HttpTransport, name: Optional[str] = None) -> None:
        self._transport = transport
        if name is not None:
            self.name = name

    @property
    def path(self) -> str:
        return f"/api/db/{self.name}"

    def __repr__(self) -> str:
        return f"<{type(self).__name__} /api/db/{self.name}>"


class ReadableTable(Table[RowT]):
    """``GET`` and ``HEAD`` on a table."""

    def list(
        self,
        *,
        where: Optional[Mapping[str, Any]] = None,
        filters: Optional[Mapping[str, str]] = None,
        select: Optional[str] = None,
        order: Order = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> List[RowT]:
        """One page of rows. Without ``limit`` the server's page size applies."""
        params = build_params(
            where=where, filters=filters, select=select, order=order, limit=limit, offset=offset
        )
        return cast("List[RowT]", _rows(self._transport.get(self.path, params=params)))

    def iter(
        self,
        *,
        where: Optional[Mapping[str, Any]] = None,
        filters: Optional[Mapping[str, str]] = None,
        select: Optional[str] = None,
        order: Order = None,
        page_size: int = 100,
        max_items: Optional[int] = None,
    ) -> Iterator[RowT]:
        """Every matching row, fetched ``page_size`` at a time."""

        def fetch(*, limit: int, offset: int) -> List[dict[str, Any]]:
            return self.list(  # type: ignore[return-value]
                where=where, filters=filters, select=select, order=order, limit=limit, offset=offset
            )

        return cast("Iterator[RowT]", iter_table(fetch, page_size=page_size, max_items=max_items))

    def get(self, id: str, *, select: Optional[str] = None) -> Optional[RowT]:
        """The row with this ``id``, or ``None`` when it is missing or hidden."""
        rows = self.list(where={"id": id}, select=select, limit=1)
        return rows[0] if rows else None

    def first(
        self,
        *,
        where: Optional[Mapping[str, Any]] = None,
        filters: Optional[Mapping[str, str]] = None,
        select: Optional[str] = None,
        order: Order = None,
    ) -> Optional[RowT]:
        """The first matching row, or ``None``."""
        rows = self.list(where=where, filters=filters, select=select, order=order, limit=1)
        return rows[0] if rows else None

    def count(
        self,
        *,
        where: Optional[Mapping[str, Any]] = None,
        filters: Optional[Mapping[str, str]] = None,
    ) -> int:
        """Exact number of matching rows (a ``HEAD`` with ``Prefer: count=exact``)."""
        head = self.head(where=where, filters=filters, headers={"Prefer": "count=exact"})
        return head.total_count or 0

    def head(
        self,
        *,
        where: Optional[Mapping[str, Any]] = None,
        filters: Optional[Mapping[str, str]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> TableHead:
        """Raw ``HEAD`` response metadata."""
        params = build_params(where=where, filters=filters)
        return self._transport.head(self.path, params=params, headers=headers)


class InsertableTable(Table[RowT], Generic[RowT, InsertT]):
    """``POST`` on a table."""

    def insert(self, row: InsertT, *, select: Optional[str] = None) -> RowT:
        """Insert one row and return it as stored."""
        params = build_params(select=select)
        result = self._transport.post(
            self.path,
            params=params or None,
            json_body=cast("dict[str, Any]", row),
            headers={"Prefer": "return=representation"},
        )
        rows = _rows(result)
        return cast(RowT, rows[0] if rows else result)


class UpdatableTable(Table[RowT], Generic[RowT, PatchT]):
    """``PATCH`` on a table. A row filter is required."""

    def update(
        self,
        values: PatchT,
        *,
        where: Optional[Mapping[str, Any]] = None,
        filters: Optional[Mapping[str, str]] = None,
        select: Optional[str] = None,
    ) -> List[RowT]:
        """Update matching rows and return them as stored."""
        _require_filter(where, filters)
        params = build_params(where=where, filters=filters, select=select)
        result = self._transport.patch(
            self.path,
            params=params,
            json_body=cast("dict[str, Any]", values),
            headers={"Prefer": "return=representation"},
        )
        return cast("List[RowT]", _rows(result))


class DeletableTable(Table[RowT]):
    """``DELETE`` on a table. A row filter is required."""

    def delete(
        self,
        *,
        where: Optional[Mapping[str, Any]] = None,
        filters: Optional[Mapping[str, str]] = None,
    ) -> List[RowT]:
        """Delete matching rows and return them."""
        _require_filter(where, filters)
        params = build_params(where=where, filters=filters)
        result = self._transport.delete(
            self.path, params=params, headers={"Prefer": "return=representation"}
        )
        return cast("List[RowT]", _rows(result))


# ── async ───────────────────────────────────────────────────────────────


class AsyncTable(Generic[RowT]):
    """Async counterpart of :class:`Table`."""

    name: str = ""

    def __init__(self, transport: AsyncHttpTransport, name: Optional[str] = None) -> None:
        self._transport = transport
        if name is not None:
            self.name = name

    @property
    def path(self) -> str:
        return f"/api/db/{self.name}"

    def __repr__(self) -> str:
        return f"<{type(self).__name__} /api/db/{self.name}>"


class AsyncReadableTable(AsyncTable[RowT]):
    async def list(
        self,
        *,
        where: Optional[Mapping[str, Any]] = None,
        filters: Optional[Mapping[str, str]] = None,
        select: Optional[str] = None,
        order: Order = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> List[RowT]:
        params = build_params(
            where=where, filters=filters, select=select, order=order, limit=limit, offset=offset
        )
        return cast("List[RowT]", _rows(await self._transport.get(self.path, params=params)))

    async def iter(
        self,
        *,
        where: Optional[Mapping[str, Any]] = None,
        filters: Optional[Mapping[str, str]] = None,
        select: Optional[str] = None,
        order: Order = None,
        page_size: int = 100,
        max_items: Optional[int] = None,
    ) -> AsyncIterator[RowT]:
        offset = 0
        yielded = 0
        while True:
            remaining = None if max_items is None else max_items - yielded
            limit = page_size if remaining is None else min(page_size, remaining)
            if limit <= 0:
                return
            page = await self.list(
                where=where, filters=filters, select=select, order=order, limit=limit, offset=offset
            )
            if not page:
                return
            for row in page:
                yield row
                yielded += 1
                if max_items is not None and yielded >= max_items:
                    return
            if len(page) < limit:
                return
            offset += len(page)

    async def get(self, id: str, *, select: Optional[str] = None) -> Optional[RowT]:
        rows = await self.list(where={"id": id}, select=select, limit=1)
        return rows[0] if rows else None

    async def first(
        self,
        *,
        where: Optional[Mapping[str, Any]] = None,
        filters: Optional[Mapping[str, str]] = None,
        select: Optional[str] = None,
        order: Order = None,
    ) -> Optional[RowT]:
        rows = await self.list(where=where, filters=filters, select=select, order=order, limit=1)
        return rows[0] if rows else None

    async def count(
        self,
        *,
        where: Optional[Mapping[str, Any]] = None,
        filters: Optional[Mapping[str, str]] = None,
    ) -> int:
        head = await self.head(where=where, filters=filters, headers={"Prefer": "count=exact"})
        return head.total_count or 0

    async def head(
        self,
        *,
        where: Optional[Mapping[str, Any]] = None,
        filters: Optional[Mapping[str, str]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> TableHead:
        params = build_params(where=where, filters=filters)
        return await self._transport.head(self.path, params=params, headers=headers)


class AsyncInsertableTable(AsyncTable[RowT], Generic[RowT, InsertT]):
    async def insert(self, row: InsertT, *, select: Optional[str] = None) -> RowT:
        params = build_params(select=select)
        result = await self._transport.post(
            self.path,
            params=params or None,
            json_body=cast("dict[str, Any]", row),
            headers={"Prefer": "return=representation"},
        )
        rows = _rows(result)
        return cast(RowT, rows[0] if rows else result)


class AsyncUpdatableTable(AsyncTable[RowT], Generic[RowT, PatchT]):
    async def update(
        self,
        values: PatchT,
        *,
        where: Optional[Mapping[str, Any]] = None,
        filters: Optional[Mapping[str, str]] = None,
        select: Optional[str] = None,
    ) -> List[RowT]:
        _require_filter(where, filters)
        params = build_params(where=where, filters=filters, select=select)
        result = await self._transport.patch(
            self.path,
            params=params,
            json_body=cast("dict[str, Any]", values),
            headers={"Prefer": "return=representation"},
        )
        return cast("List[RowT]", _rows(result))


class AsyncDeletableTable(AsyncTable[RowT]):
    async def delete(
        self,
        *,
        where: Optional[Mapping[str, Any]] = None,
        filters: Optional[Mapping[str, str]] = None,
    ) -> List[RowT]:
        _require_filter(where, filters)
        params = build_params(where=where, filters=filters)
        result = await self._transport.delete(
            self.path, params=params, headers={"Prefer": "return=representation"}
        )
        return cast("List[RowT]", _rows(result))
