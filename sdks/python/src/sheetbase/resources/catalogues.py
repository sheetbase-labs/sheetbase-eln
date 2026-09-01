"""Catalogue resource — read-only access to schema definitions, sheet definitions and templates.

These are GET-only for external credentials (``schema:read`` / ``templates:read``).
Authoring RPCs stay fail-closed.
"""
from __future__ import annotations

from typing import Any, Optional


class CataloguesResource:
    def __init__(self, transport: Any) -> None:
        self._transport = transport

    # ── Dataset Schema ──────────────────────────────────────────────────

    def list_schema_definitions(
        self, *, limit: int = 100, offset: int = 0, order: Optional[str] = None
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if order:
            params["order"] = order
        return self._transport.get("/api/db/dataset_schema_definitions", params=params)

    def get_schema_definition(self, definition_id: str) -> dict[str, Any]:
        rows = self._transport.get(
            "/api/db/dataset_schema_definitions",
            params={"id": f"eq.{definition_id}", "limit": 1},
        )
        return rows[0] if rows else None

    def list_schema_versions(
        self, *, limit: int = 100, offset: int = 0
    ) -> list[dict[str, Any]]:
        return self._transport.get(
            "/api/db/dataset_schema_versions",
            params={"limit": limit, "offset": offset},
        )

    def list_schema_version_fields(
        self,
        *,
        schema_version_id: Optional[str] = None,
        limit: int = 1000,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if schema_version_id:
            params["schema_version_id"] = f"eq.{schema_version_id}"
        return self._transport.get(
            "/api/db/dataset_schema_version_fields", params=params
        )

    # ── Sheet Definitions ───────────────────────────────────────────────

    def list_sheet_definitions(
        self, *, limit: int = 100, offset: int = 0
    ) -> list[dict[str, Any]]:
        return self._transport.get(
            "/api/db/sheet_definitions",
            params={"limit": limit, "offset": offset},
        )

    def list_sheet_definition_versions(
        self, *, limit: int = 100, offset: int = 0
    ) -> list[dict[str, Any]]:
        return self._transport.get(
            "/api/db/sheet_definition_versions",
            params={"limit": limit, "offset": offset},
        )

    # ── Notebook Templates ──────────────────────────────────────────────

    def list_templates(
        self, *, limit: int = 100, offset: int = 0
    ) -> list[dict[str, Any]]:
        return self._transport.get(
            "/api/db/notebook_templates",
            params={"limit": limit, "offset": offset},
        )

    def list_template_versions(
        self, *, limit: int = 100, offset: int = 0
    ) -> list[dict[str, Any]]:
        return self._transport.get(
            "/api/db/notebook_template_versions",
            params={"limit": limit, "offset": offset},
        )

    def instantiate_template(
        self,
        *,
        version_id: str,
        target_project_id: str,
        title: str,
        parameter_inputs: list[dict[str, Any]],
        idempotency_key: str,
    ) -> Any:
        """Instantiate a notebook template version."""
        return self._transport.post(
            "/api/db/rpc/instantiate_notebook_template_version",
            json_body={"p_version_id": version_id, "p_target_project_id": target_project_id,
                       "p_title": title, "p_parameter_inputs": parameter_inputs,
                       "p_idempotency_key": idempotency_key},
        )

    def preview_template_upgrade(
        self,
        record_id: str,
        target_version_id: str,
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/preview_notebook_template_upgrade",
            json_body={
                "p_record_id": record_id,
                "p_target_version_id": target_version_id,
            },
        )

    def apply_template_upgrade(
        self,
        *,
        record_id: str,
        expected_structure_version: int,
        target_version_id: str,
        decisions: list[dict[str, Any]],
        parameter_inputs: list[dict[str, Any]],
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/apply_notebook_template_upgrade",
            json_body={"p_record_id": record_id,
                       "p_expected_structure_version": expected_structure_version,
                       "p_target_version_id": target_version_id, "p_decisions": decisions,
                       "p_parameter_inputs": parameter_inputs},
        )
