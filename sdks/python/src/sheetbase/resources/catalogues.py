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
            params["dataset_schema_version_id"] = f"eq.{schema_version_id}"
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
        template_version_id: str,
        *,
        project_id: Optional[str] = None,
        parameters: Optional[dict[str, Any]] = None,
    ) -> Any:
        """Instantiate a notebook template version."""
        body: dict[str, Any] = {
            "p_template_version_id": template_version_id,
        }
        if project_id:
            body["p_project_id"] = project_id
        if parameters:
            body["p_parameters"] = parameters
        return self._transport.post(
            "/api/db/rpc/instantiate_notebook_template_version",
            json_body=body,
        )

    def preview_template_upgrade(
        self,
        notebook_record_id: str,
        target_template_version_id: str,
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/preview_notebook_template_upgrade",
            json_body={
                "p_notebook_record_id": notebook_record_id,
                "p_target_template_version_id": target_template_version_id,
            },
        )

    def apply_template_upgrade(
        self,
        notebook_record_id: str,
        target_template_version_id: str,
        *,
        decisions: Optional[list[dict[str, Any]]] = None,
    ) -> Any:
        body: dict[str, Any] = {
            "p_notebook_record_id": notebook_record_id,
            "p_target_template_version_id": target_template_version_id,
        }
        if decisions:
            body["p_decisions"] = decisions
        return self._transport.post(
            "/api/db/rpc/apply_notebook_template_upgrade",
            json_body=body,
        )
