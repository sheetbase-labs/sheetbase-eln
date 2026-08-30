"""Project resource — list, get, create, update."""
from __future__ import annotations

from collections.abc import Iterator
from typing import Any, Optional

from sheetbase._http import HttpTransport
from sheetbase._pagination import iter_table
from sheetbase._query_result import TablePage
from sheetbase.types import Project


class ProjectsResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    def list(
        self,
        *,
        select: Optional[str] = None,
        order: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Project]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if select:
            params["select"] = select
        if order:
            params["order"] = order
        rows = self._transport.get("/api/db/projects", params=params)
        return [Project.from_dict(r) for r in rows]

    def get(self, project_id: str) -> Project:
        rows = self._transport.get(
            "/api/db/projects",
            params={"id": f"eq.{project_id}", "limit": 1},
        )
        if not rows:
            from sheetbase.errors import NotFoundError
            raise NotFoundError("not_found", f"Project {project_id} not found.")
        return Project.from_dict(rows[0])

    def get_by_key(self, key: str) -> Project:
        rows = self._transport.get(
            "/api/db/projects",
            params={"key": f"eq.{key}", "limit": 1},
        )
        if not rows:
            from sheetbase.errors import NotFoundError
            raise NotFoundError("not_found", f"Project key={key!r} not found.")
        return Project.from_dict(rows[0])

    def create(
        self,
        title: str,
    ) -> Project:
        """Create a project via the ``create_project`` RPC."""
        result = self._transport.post(
            "/api/db/rpc/create_project",
            json_body={"p_title": title},
        )
        if isinstance(result, list):
            return Project.from_dict(result[0])
        return Project.from_dict(result)

    def update(
        self,
        project_id: str,
        *,
        title: Optional[str] = None,
        status: Optional[str] = None,
        custom_fields: Optional[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        """Patch a project (table PATCH)."""
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if status is not None:
            body["status"] = status
        if custom_fields is not None:
            body["custom_fields"] = custom_fields
        return self._transport.patch(
            "/api/db/projects",
            params={"id": f"eq.{project_id}"},
            json_body=body,
        )

    def iter(
        self,
        *,
        select: Optional[str] = None,
        order: Optional[str] = None,
        page_size: int = 100,
        max_items: Optional[int] = None,
    ) -> Iterator[Project]:
        """Iterate all projects with auto-pagination."""
        def fetch(*, limit: int, offset: int) -> list[dict[str, Any]]:
            params: dict[str, Any] = {"limit": limit, "offset": offset}
            if select:
                params["select"] = select
            if order:
                params["order"] = order
            return self._transport.get("/api/db/projects", params=params)

        for row in iter_table(fetch, page_size=page_size, max_items=max_items):
            yield Project.from_dict(row)
