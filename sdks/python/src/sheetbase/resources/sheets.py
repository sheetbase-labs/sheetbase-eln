"""Sheet Instance resource — query rows, mutations, materialize, record write-back."""
from __future__ import annotations

from typing import Any, Optional

from sheetbase._http import HttpTransport
from sheetbase._pagination import iter_rpc
from sheetbase._query_result import DatasetRowPage
from sheetbase.types import SheetInstance
from collections.abc import Iterator


class SheetsResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    def list(
        self,
        *,
        select: Optional[str] = None,
        order: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[SheetInstance]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if select:
            params["select"] = select
        if order:
            params["order"] = order
        rows = self._transport.get("/api/db/sheet_instances", params=params)
        return [SheetInstance.from_dict(r) for r in rows]

    def get(self, instance_id: str) -> SheetInstance:
        rows = self._transport.get(
            "/api/db/sheet_instances",
            params={"id": f"eq.{instance_id}", "limit": 1},
        )
        if not rows:
            from sheetbase.errors import NotFoundError
            raise NotFoundError("not_found", f"Sheet instance {instance_id} not found.")
        return SheetInstance.from_dict(rows[0])

    def create(
        self,
        *,
        name: str,
        notebook_record_id: Optional[str] = None,
        configuration: Optional[dict[str, Any]] = None,
    ) -> Any:
        """Create a standalone sheet instance."""
        body: dict[str, Any] = {"p_name": name}
        if notebook_record_id:
            body["p_notebook_record_id"] = notebook_record_id
        if configuration:
            body["p_configuration"] = configuration
        return self._transport.post(
            "/api/db/rpc/create_sheet_instance", json_body=body
        )

    def create_from_definition(
        self,
        *,
        sheet_definition_version_id: str,
        name: str,
        notebook_record_id: Optional[str] = None,
    ) -> Any:
        """Create a sheet instance from a published definition version."""
        body: dict[str, Any] = {
            "p_sheet_definition_version_id": sheet_definition_version_id,
            "p_name": name,
        }
        if notebook_record_id:
            body["p_notebook_record_id"] = notebook_record_id
        return self._transport.post(
            "/api/db/rpc/create_sheet_instance_from_definition", json_body=body
        )

    def update(
        self,
        instance_id: str,
        expected_revision: int,
        *,
        name: Optional[str] = None,
    ) -> Any:
        body: dict[str, Any] = {
            "p_instance_id": instance_id,
            "p_expected_revision": expected_revision,
        }
        if name is not None:
            body["p_name"] = name
        return self._transport.post(
            "/api/db/rpc/update_sheet_instance", json_body=body
        )

    def query_rows(
        self,
        instance_id: str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Query composed sheet instance rows."""
        return self._transport.post(
            "/api/db/rpc/query_sheet_instance_rows",
            json_body={
                "p_instance_id": instance_id,
                "p_limit": limit,
                "p_offset": offset,
            },
        )

    def iter_rows(
        self,
        instance_id: str,
        *,
        page_size: int = 200,
        max_items: Optional[int] = None,
    ) -> Iterator[dict[str, Any]]:
        """Iterate sheet instance rows with auto-pagination."""
        def fetch(*, limit: int, offset: int) -> dict[str, Any]:
            return self._transport.post(
                "/api/db/rpc/query_sheet_instance_rows",
                json_body={
                    "p_instance_id": instance_id,
                    "p_limit": limit,
                    "p_offset": offset,
                },
            )
        return iter_rpc(fetch, page_size=page_size, max_items=max_items)

    def archive(self, instance_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/archive_sheet_instance",
            json_body={"p_instance_id": instance_id},
        )

    def restore(self, instance_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/restore_sheet_instance",
            json_body={"p_instance_id": instance_id},
        )

    def duplicate(self, instance_id: str, *, name: Optional[str] = None) -> Any:
        body: dict[str, Any] = {"p_instance_id": instance_id}
        if name:
            body["p_name"] = name
        return self._transport.post(
            "/api/db/rpc/duplicate_sheet_instance", json_body=body
        )

    def materialize(self, instance_id: str, expected_revision: int) -> Any:
        return self._transport.post(
            "/api/db/rpc/materialize_sheet_instance",
            json_body={
                "p_instance_id": instance_id,
                "p_expected_revision": expected_revision,
            },
        )

    def preview_materialize(self, instance_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/preview_sheet_materialization",
            json_body={"p_instance_id": instance_id},
        )

    def mutate_local_state(
        self,
        instance_id: str,
        expected_revision: int,
        *,
        local_state: dict[str, Any],
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/mutate_sheet_instance_local_state",
            json_body={
                "p_instance_id": instance_id,
                "p_expected_revision": expected_revision,
                "p_local_state": local_state,
            },
        )

    def mutate_calculations(
        self,
        instance_id: str,
        expected_revision: int,
        *,
        calculations: list[dict[str, Any]],
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/mutate_sheet_instance_calculations",
            json_body={
                "p_instance_id": instance_id,
                "p_expected_revision": expected_revision,
                "p_calculations": calculations,
            },
        )
