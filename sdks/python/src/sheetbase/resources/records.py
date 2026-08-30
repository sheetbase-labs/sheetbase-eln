"""Record resource — list, get, create, update, archive, restore, link."""
from __future__ import annotations

from collections.abc import Iterator
from typing import Any, Optional

from sheetbase._http import HttpTransport
from sheetbase._pagination import iter_table
from sheetbase.types import Record


class RecordsResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    def list(
        self,
        *,
        kind: Optional[str] = None,
        project_id: Optional[str] = None,
        select: Optional[str] = None,
        order: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Record]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if kind:
            params["kind"] = f"eq.{kind}"
        if project_id:
            params["project_id"] = f"eq.{project_id}"
        if select:
            params["select"] = select
        if order:
            params["order"] = order
        rows = self._transport.get("/api/db/records", params=params)
        return [Record.from_dict(r) for r in rows]

    def get(self, record_id: str) -> Record:
        rows = self._transport.get(
            "/api/db/records",
            params={"id": f"eq.{record_id}", "limit": 1},
        )
        if not rows:
            from sheetbase.errors import NotFoundError
            raise NotFoundError("not_found", f"Record {record_id} not found.")
        return Record.from_dict(rows[0])

    def create(
        self,
        *,
        project_id: str,
        kind: str,
        title: str,
        status: str,
        tags: Optional[list[str]] = None,
        properties: Optional[dict[str, Any]] = None,
    ) -> Record:
        """Create a record via the ``create_record`` RPC."""
        result = self._transport.post(
            "/api/db/rpc/create_record",
            json_body={
                "p_project_id": project_id,
                "p_kind": kind,
                "p_title": title,
                "p_status": status,
                "p_tags": tags or [],
                "p_properties": properties or {},
            },
        )
        if isinstance(result, list):
            return Record.from_dict(result[0])
        return Record.from_dict(result)

    def update(
        self,
        record_id: str,
        *,
        title: Optional[str] = None,
        status: Optional[str] = None,
        tags: Optional[list[str]] = None,
        properties: Optional[dict[str, Any]] = None,
        custom_fields: Optional[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        """Patch a record (table PATCH)."""
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if status is not None:
            body["status"] = status
        if tags is not None:
            body["tags"] = tags
        if properties is not None:
            body["properties"] = properties
        if custom_fields is not None:
            body["custom_fields"] = custom_fields
        return self._transport.patch(
            "/api/db/records",
            params={"id": f"eq.{record_id}"},
            json_body=body,
        )

    def archive(self, record_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/archive_record",
            json_body={"p_record_id": record_id},
        )

    def restore(self, record_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/restore_record",
            json_body={"p_record_id": record_id},
        )

    def transition_status(self, record_id: str, status: str) -> Any:
        """Transition a record's lifecycle status."""
        return self._transport.post(
            "/api/db/rpc/transition_record_status",
            json_body={"p_record_id": record_id, "p_status": status},
        )

    def create_link(
        self,
        source_record_id: str,
        target_record_id: str,
        *,
        link_type: Optional[str] = None,
    ) -> Any:
        """Create a record link between two records."""
        body: dict[str, Any] = {
            "p_source_record_id": source_record_id,
            "p_target_record_id": target_record_id,
        }
        if link_type:
            body["p_link_type"] = link_type
        return self._transport.post(
            "/api/db/rpc/create_record_link",
            json_body=body,
        )

    def iter(
        self,
        *,
        kind: Optional[str] = None,
        project_id: Optional[str] = None,
        select: Optional[str] = None,
        order: Optional[str] = None,
        page_size: int = 100,
        max_items: Optional[int] = None,
    ) -> Iterator[Record]:
        """Iterate all records with auto-pagination."""
        def fetch(*, limit: int, offset: int) -> list[dict[str, Any]]:
            params: dict[str, Any] = {"limit": limit, "offset": offset}
            if kind:
                params["kind"] = f"eq.{kind}"
            if project_id:
                params["project_id"] = f"eq.{project_id}"
            if select:
                params["select"] = select
            if order:
                params["order"] = order
            return self._transport.get("/api/db/records", params=params)

        for row in iter_table(fetch, page_size=page_size, max_items=max_items):
            yield Record.from_dict(row)
