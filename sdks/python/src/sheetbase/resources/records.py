"""Record resource — list, get, create, update, archive, restore, link."""
from __future__ import annotations

from collections.abc import Iterator
from typing import Any, Optional

from sheetbase._http import HttpTransport
from sheetbase._pagination import iter_table
from sheetbase.types import Record, RecordRevision


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

    def create_with_blocks(
        self,
        *,
        project_id: str,
        kind: str,
        title: str,
        status: str,
        tags: list[str],
        blocks: list[dict[str, Any]],
        properties: dict[str, Any],
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/create_record_with_blocks",
            json_body={
                "p_project_id": project_id,
                "p_kind": kind,
                "p_title": title,
                "p_status": status,
                "p_tags": tags,
                "p_blocks": blocks,
                "p_properties": properties,
            },
        )

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
            headers={"Prefer": "return=representation"},
        )

    def archive(self, record_id: str, expected_metadata_version: int) -> Any:
        return self._transport.post(
            "/api/db/rpc/archive_record",
            json_body={"p_record_id": record_id, "p_expected_metadata_version": expected_metadata_version},
        )

    def restore(self, record_id: str, expected_metadata_version: int) -> Any:
        return self._transport.post(
            "/api/db/rpc/restore_record",
            json_body={"p_record_id": record_id, "p_expected_metadata_version": expected_metadata_version},
        )

    def transition_status(self, record_id: str, target_status: str, expected_metadata_version: int) -> Any:
        """Transition a record's lifecycle status."""
        return self._transport.post(
            "/api/db/rpc/transition_record_status",
            json_body={
                "p_record_id": record_id,
                "p_target_status": target_status,
                "p_expected_metadata_version": expected_metadata_version,
            },
        )

    def create_link(
        self,
        *,
        source_record_id: str,
        target_kind: str,
        target_identifier: str,
        link_type: str,
        target_record_id: Optional[str] = None,
        label: Optional[str] = None,
    ) -> Any:
        """Create a record link between two records."""
        return self._transport.post(
            "/api/db/rpc/create_record_link",
            json_body={
                "p_source_record_id": source_record_id,
                "p_target_kind": target_kind,
                "p_target_identifier": target_identifier,
                "p_link_type": link_type,
                "p_target_record_id": target_record_id,
                "p_label": label,
            },
        )

    def update_custom_fields(
        self,
        record_id: str,
        expected_metadata_version: int,
        values: dict[str, Any],
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/update_record_custom_fields",
            json_body={
                "p_record_id": record_id,
                "p_expected_metadata_version": expected_metadata_version,
                "p_values": values,
            },
        )

    def update_block_payload(
        self,
        block_id: str,
        *,
        payload: dict[str, Any],
        expected_version: int,
        payload_schema_version: int,
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/update_block_payload",
            json_body={
                "p_block_id": block_id,
                "p_payload": payload,
                "p_expected_version": expected_version,
                "p_payload_schema_version": payload_schema_version,
            },
        )

    def move_block(
        self,
        block_id: str,
        expected_structure_version: int,
        *,
        after_block_id: Optional[str] = None,
        before_block_id: Optional[str] = None,
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/move_block",
            json_body={
                "p_block_id": block_id,
                "p_expected_structure_version": expected_structure_version,
                "p_after_block_id": after_block_id,
                "p_before_block_id": before_block_id,
            },
        )

    def insert_block(
        self,
        *,
        record_id: str,
        block_type: str,
        payload: dict[str, Any],
        payload_schema_version: int,
        expected_structure_version: int,
        after_block_id: Optional[str] = None,
        before_block_id: Optional[str] = None,
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/insert_block",
            json_body={
                "p_record_id": record_id,
                "p_type": block_type,
                "p_payload": payload,
                "p_payload_schema_version": payload_schema_version,
                "p_after_block_id": after_block_id,
                "p_expected_structure_version": expected_structure_version,
                "p_before_block_id": before_block_id,
            },
        )

    def delete_block(self, block_id: str, expected_structure_version: int) -> Any:
        return self._transport.post(
            "/api/db/rpc/delete_block",
            json_body={
                "p_block_id": block_id,
                "p_expected_structure_version": expected_structure_version,
            },
        )

    def instantiate_template(
        self,
        *,
        template_record_id: str,
        target_project_id: str,
        target_kind: str,
        title: str,
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/instantiate_template",
            json_body={
                "p_template_record_id": template_record_id,
                "p_target_project_id": target_project_id,
                "p_target_kind": target_kind,
                "p_title": title,
            },
        )

    def preview_submission_digest(self, record_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/preview_submission_digest",
            json_body={"p_record_id": record_id},
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

    def history(
        self,
        record_id: str,
        *,
        limit: int = 100,
        offset: int = 0,
    ) -> list[RecordRevision]:
        """List the immutable revisions of a record, newest first (table read).

        Revisions are the record's audit/provenance trail: each pins a frozen
        ``canonical_snapshot`` and ``integrity_digest``. Audit history is not
        the same as submitted evidence; it reconstructs what changed and when.
        """
        rows = self._transport.get(
            "/api/db/revisions",
            params={
                "record_id": f"eq.{record_id}",
                "order": "created_at.desc",
                "limit": limit,
                "offset": offset,
            },
        )
        return [RecordRevision.from_dict(r) for r in rows]

    def iter_history(
        self,
        record_id: str,
        *,
        page_size: int = 100,
        max_items: Optional[int] = None,
    ) -> Iterator[RecordRevision]:
        """Iterate all revisions of a record, newest first, auto-paginating."""
        def fetch(*, limit: int, offset: int) -> list[dict[str, Any]]:
            return self._transport.get(
                "/api/db/revisions",
                params={
                    "record_id": f"eq.{record_id}",
                    "order": "created_at.desc",
                    "limit": limit,
                    "offset": offset,
                },
            )

        for row in iter_table(fetch, page_size=page_size, max_items=max_items):
            yield RecordRevision.from_dict(row)
