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
        workspace_id: str,
        name: str,
        state: dict[str, Any],
        description: Optional[str] = None,
        source_definition_version_id: Optional[str] = None,
        project_id: Optional[str] = None,
        notebook_record_id: Optional[str] = None,
    ) -> Any:
        """Create a standalone sheet instance."""
        return self._transport.post(
            "/api/db/rpc/create_sheet_instance", json_body={
                "p_workspace_id": workspace_id, "p_name": name,
                "p_description": description,
                "p_source_definition_version_id": source_definition_version_id,
                "p_project_id": project_id, "p_notebook_record_id": notebook_record_id,
                "p_state": state,
            }
        )

    def create_from_definition(
        self,
        *,
        workspace_id: str,
        name: str,
        source_definition_version_id: str,
        state: dict[str, Any],
        parameter_inputs: list[dict[str, Any]],
        description: Optional[str] = None,
        project_id: Optional[str] = None,
        notebook_record_id: Optional[str] = None,
    ) -> Any:
        """Create a sheet instance from a published definition version."""
        return self._transport.post(
            "/api/db/rpc/create_sheet_instance_from_definition", json_body={
                "p_workspace_id": workspace_id, "p_name": name,
                "p_description": description,
                "p_source_definition_version_id": source_definition_version_id,
                "p_project_id": project_id, "p_notebook_record_id": notebook_record_id,
                "p_state": state, "p_parameter_inputs": parameter_inputs,
            }
        )

    def update(
        self,
        instance_id: str,
        expected_revision: int,
        *,
        state: dict[str, Any],
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/update_sheet_instance", json_body={
                "p_instance_id": instance_id, "p_expected_revision": expected_revision,
                "p_state": state,
            }
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

    def read_calculation_results(
        self, instance_id: str, *, row_keys: list[str]
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/read_sheet_instance_calculation_results",
            json_body={"p_instance_id": instance_id, "p_row_keys": row_keys},
        )

    def resolve_row_identity(self, instance_id: str, expected_revision: int) -> Any:
        return self._transport.post(
            "/api/db/rpc/resolve_sheet_instance_row_identity",
            json_body={
                "p_instance_id": instance_id,
                "p_expected_revision": expected_revision,
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

    def archive(self, instance_id: str, expected_revision: int) -> Any:
        return self._transport.post(
            "/api/db/rpc/archive_sheet_instance",
            json_body={"p_instance_id": instance_id, "p_expected_revision": expected_revision},
        )

    def restore(self, instance_id: str, expected_revision: int) -> Any:
        return self._transport.post(
            "/api/db/rpc/restore_sheet_instance",
            json_body={"p_instance_id": instance_id, "p_expected_revision": expected_revision},
        )

    def duplicate(self, instance_id: str, expected_revision: int, *, name: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/duplicate_sheet_instance", json_body={
                "p_instance_id": instance_id, "p_expected_revision": expected_revision,
                "p_name": name,
            }
        )

    def materialize(self, *, instance_id: str, expected_instance_revision: int,
                    output_name: str, output_schema_version_id: str,
                    preview_digest: str, idempotency_key: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/materialize_sheet_instance",
            json_body={
                "p_instance_id": instance_id,
                "p_expected_instance_revision": expected_instance_revision,
                "p_output_name": output_name,
                "p_output_schema_version_id": output_schema_version_id,
                "p_preview_digest": preview_digest,
                "p_idempotency_key": idempotency_key,
            },
        )

    def preview_materialize(self, *, instance_id: str, expected_instance_revision: int,
                            output_schema_version_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/preview_sheet_materialization",
            json_body={"p_instance_id": instance_id,
                       "p_expected_instance_revision": expected_instance_revision,
                       "p_output_schema_version_id": output_schema_version_id},
        )

    def preview_composition_adoption(
        self,
        *,
        instance_id: str,
        expected_instance_revision: int,
        target_definition_version_id: str,
        parameter_inputs: list[dict[str, Any]],
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/preview_sheet_instance_composition_adoption",
            json_body={
                "p_instance_id": instance_id,
                "p_expected_instance_revision": expected_instance_revision,
                "p_target_definition_version_id": target_definition_version_id,
                "p_parameter_inputs": parameter_inputs,
            },
        )

    def apply_composition_adoption(
        self,
        *,
        instance_id: str,
        expected_instance_revision: int,
        target_definition_version_id: str,
        parameter_inputs: list[dict[str, Any]],
        retry_token: str,
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/apply_sheet_instance_composition_adoption",
            json_body={
                "p_instance_id": instance_id,
                "p_expected_instance_revision": expected_instance_revision,
                "p_target_definition_version_id": target_definition_version_id,
                "p_parameter_inputs": parameter_inputs,
                "p_retry_token": retry_token,
            },
        )

    def preview_definition_upgrade(
        self,
        *,
        instance_id: str,
        expected_instance_revision: int,
        target_definition_version_id: str,
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/preview_sheet_instance_definition_upgrade",
            json_body={
                "p_instance_id": instance_id,
                "p_expected_instance_revision": expected_instance_revision,
                "p_target_definition_version_id": target_definition_version_id,
            },
        )

    def apply_definition_upgrade(
        self,
        *,
        instance_id: str,
        expected_instance_revision: int,
        target_definition_version_id: str,
        decisions: list[dict[str, Any]],
        parameter_inputs: list[dict[str, Any]],
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/apply_sheet_instance_definition_upgrade",
            json_body={
                "p_instance_id": instance_id,
                "p_expected_instance_revision": expected_instance_revision,
                "p_target_definition_version_id": target_definition_version_id,
                "p_decisions": decisions,
                "p_parameter_inputs": parameter_inputs,
            },
        )

    def mutate_local_state(
        self,
        *,
        instance_id: str, expected_revision: int, retry_token: str,
        field_changes: list[dict[str, Any]], rows: list[dict[str, Any]],
        cells: list[dict[str, Any]],
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/mutate_sheet_instance_local_state",
            json_body={
                "p_instance_id": instance_id,
                "p_expected_revision": expected_revision,
                "p_retry_token": retry_token, "p_field_changes": field_changes,
                "p_rows": rows, "p_cells": cells,
            },
        )

    def mutate_calculations(
        self,
        *,
        instance_id: str, expected_revision: int, retry_token: str,
        changes: list[dict[str, Any]],
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/mutate_sheet_instance_calculations",
            json_body={
                "p_instance_id": instance_id,
                "p_expected_revision": expected_revision,
                "p_retry_token": retry_token, "p_changes": changes,
            },
        )

    def insert_notebook_block(
        self,
        *,
        record_id: str,
        expected_structure_version: int,
        instance_id: str,
        after_block_id: Optional[str] = None,
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/insert_sheet_instance_block",
            json_body={
                "p_record_id": record_id,
                "p_after_block_id": after_block_id,
                "p_expected_structure_version": expected_structure_version,
                "p_instance_id": instance_id,
            },
        )

    def duplicate_notebook_block(
        self, block_id: str, expected_structure_version: int
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/duplicate_sheet_instance_block",
            json_body={
                "p_block_id": block_id,
                "p_expected_structure_version": expected_structure_version,
            },
        )

    def validate_record_batch(
        self, *, project_id: str, model_key: str, rows: list[dict[str, Any]]
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/validate_sheet_record_batch",
            json_body={
                "p_project_id": project_id,
                "p_model_key": model_key,
                "p_rows": rows,
            },
        )

    def create_and_link_record(
        self,
        *,
        project_id: str,
        model_key: str,
        title: str,
        custom_fields: dict[str, Any],
        write_target: dict[str, Any],
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/create_and_link_sheet_record",
            json_body={
                "p_project_id": project_id,
                "p_model_key": model_key,
                "p_title": title,
                "p_custom_fields": custom_fields,
                "p_write_target": write_target,
            },
        )

    def commit_record_batch(
        self,
        *,
        project_id: str,
        model_key: str,
        rows: list[dict[str, Any]],
        idempotency_key: str,
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/commit_sheet_record_batch",
            json_body={
                "p_project_id": project_id,
                "p_model_key": model_key,
                "p_rows": rows,
                "p_idempotency_key": idempotency_key,
            },
        )
