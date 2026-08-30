"""Asynchronous Sheetbase client.

Mirrors :class:`sheetbase.SheetbaseClient` but all resource methods are
coroutines. Uses ``httpx.AsyncClient`` under the hood.

Usage::

    import asyncio
    from sheetbase import AsyncSheetbaseClient

    async def main():
        async with AsyncSheetbaseClient(
            base_url="https://app.sheetbase.co.uk",
            credential="sb_...",
            scopes=["datasets:read"],
        ) as client:
            projects = await client.projects.list()
            page = await client.datasets.query_rows(dataset_id="...")
            df = page.to_dataframe()

    asyncio.run(main())
"""
from __future__ import annotations

import uuid as _uuid
from collections.abc import AsyncIterator
from typing import Any, Optional, Sequence

import httpx

from sheetbase._http import AsyncHttpTransport
from sheetbase._version import __version__
from sheetbase._query_result import DatasetRowPage, DatasetVersionRowPage, SearchPage
from sheetbase.errors import NotFoundError, StaleVersionError
from sheetbase.resources.datasets import DatasetRowBatch
from sheetbase.types import (
    CommitResult,
    Dataset,
    DatasetVersion,
    Project,
    Record,
    SearchResult,
    SheetInstance,
    ValidationResult,
)


class AsyncSheetbaseClient:
    """Asynchronous Sheetbase API client."""

    def __init__(
        self,
        base_url: str,
        credential: str,
        scopes: Sequence[str],
        *,
        timeout: float = 30.0,
        client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self._transport = AsyncHttpTransport(
            base_url=base_url,
            credential=credential,
            scopes=scopes,
            timeout=timeout,
            client=client,
        )

        self.projects = AsyncProjects(self._transport)
        self.records = AsyncRecords(self._transport)
        self.datasets = AsyncDatasets(self._transport)
        self.sheets = AsyncSheets(self._transport)
        self.search = AsyncSearch(self._transport)
        self.catalogues = AsyncCatalogues(self._transport)

    @property
    def version(self) -> str:
        return __version__

    async def rpc(self, name: str, **params: Any) -> Any:
        body = {f"p_{k}" if not k.startswith("p_") else k: v for k, v in params.items()}
        return await self._transport.post(f"/api/db/rpc/{name}", json_body=body)

    async def table_get(self, resource: str, *, params: Optional[dict[str, Any]] = None) -> Any:
        return await self._transport.get(f"/api/db/{resource}", params=params)

    async def table_post(self, resource: str, *, json_body: Optional[dict[str, Any]] = None) -> Any:
        return await self._transport.post(f"/api/db/{resource}", json_body=json_body)

    async def table_patch(
        self, resource: str, *, params: Optional[dict[str, Any]] = None, json_body: Optional[dict[str, Any]] = None
    ) -> Any:
        return await self._transport.patch(f"/api/db/{resource}", params=params, json_body=json_body)

    async def close(self) -> None:
        await self._transport.close()

    async def __aenter__(self) -> AsyncSheetbaseClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()


# ── Async resource classes ──────────────────────────────────────────────


class AsyncProjects:
    def __init__(self, transport: AsyncHttpTransport) -> None:
        self._t = transport

    async def list(
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
        rows = await self._t.get("/api/db/projects", params=params)
        return [Project.from_dict(r) for r in rows]

    async def get(self, project_id: str) -> Project:
        rows = await self._t.get("/api/db/projects", params={"id": f"eq.{project_id}", "limit": 1})
        if not rows:
            raise NotFoundError("not_found", f"Project {project_id} not found.")
        return Project.from_dict(rows[0])

    async def create(self, title: str) -> Project:
        result = await self._t.post("/api/db/rpc/create_project", json_body={"p_title": title})
        if isinstance(result, list):
            return Project.from_dict(result[0])
        return Project.from_dict(result)


class AsyncRecords:
    def __init__(self, transport: AsyncHttpTransport) -> None:
        self._t = transport

    async def list(
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
        rows = await self._t.get("/api/db/records", params=params)
        return [Record.from_dict(r) for r in rows]

    async def get(self, record_id: str) -> Record:
        rows = await self._t.get("/api/db/records", params={"id": f"eq.{record_id}", "limit": 1})
        if not rows:
            raise NotFoundError("not_found", f"Record {record_id} not found.")
        return Record.from_dict(rows[0])

    async def create(
        self,
        *,
        project_id: str,
        kind: str,
        title: str,
        status: str,
        tags: Optional[list[str]] = None,
        properties: Optional[dict[str, Any]] = None,
    ) -> Record:
        result = await self._t.post(
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

    async def archive(self, record_id: str, expected_metadata_version: int) -> Any:
        return await self._t.post("/api/db/rpc/archive_record", json_body={
            "p_record_id": record_id, "p_expected_metadata_version": expected_metadata_version})

    async def restore(self, record_id: str, expected_metadata_version: int) -> Any:
        return await self._t.post("/api/db/rpc/restore_record", json_body={
            "p_record_id": record_id, "p_expected_metadata_version": expected_metadata_version})

    async def transition_status(self, record_id: str, target_status: str,
                                expected_metadata_version: int) -> Any:
        return await self._t.post("/api/db/rpc/transition_record_status", json_body={
            "p_record_id": record_id, "p_target_status": target_status,
            "p_expected_metadata_version": expected_metadata_version})

    async def create_link(self, *, source_record_id: str, target_kind: str,
                          target_identifier: str, link_type: str,
                          target_record_id: Optional[str] = None,
                          label: Optional[str] = None) -> Any:
        return await self._t.post("/api/db/rpc/create_record_link", json_body={
            "p_source_record_id": source_record_id, "p_target_kind": target_kind,
            "p_target_identifier": target_identifier, "p_link_type": link_type,
            "p_target_record_id": target_record_id, "p_label": label})


class AsyncDatasets:
    def __init__(self, transport: AsyncHttpTransport) -> None:
        self._t = transport

    async def list(
        self,
        *,
        select: Optional[str] = None,
        order: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Dataset]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if select:
            params["select"] = select
        if order:
            params["order"] = order
        rows = await self._t.get("/api/db/datasets", params=params)
        return [Dataset.from_dict(r) for r in rows]

    async def get(self, dataset_id: str) -> Dataset:
        rows = await self._t.get("/api/db/datasets", params={"id": f"eq.{dataset_id}", "limit": 1})
        if not rows:
            raise NotFoundError("not_found", f"Dataset {dataset_id} not found.")
        return Dataset.from_dict(rows[0])

    async def create(
        self,
        *,
        workspace_id: str,
        schema_version_id: str,
        name: str,
        description: Optional[str] = None,
        primary_project_id: Optional[str] = None,
    ) -> Dataset:
        body: dict[str, Any] = {
            "workspace_id": workspace_id,
            "schema_version_id": schema_version_id,
            "name": name,
        }
        if description is not None:
            body["description"] = description
        if primary_project_id is not None:
            body["primary_project_id"] = primary_project_id
        rows = await self._t.post("/api/db/datasets", json_body=body)
        if isinstance(rows, list):
            return Dataset.from_dict(rows[0])
        return Dataset.from_dict(rows)

    async def query_rows(
        self,
        dataset_id: str,
        *,
        filters: Optional[list[dict[str, Any]]] = None,
        sort: Optional[dict[str, str]] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> DatasetRowPage:
        body: dict[str, Any] = {
            "p_dataset_id": dataset_id,
            "p_limit": limit,
            "p_offset": offset,
        }
        p_query: dict[str, Any] = {}
        if filters:
            p_query["filters"] = filters
        if sort:
            p_query["sort"] = sort
        if p_query:
            body["p_query"] = p_query
        result = await self._t.post("/api/db/rpc/query_dataset_rows", json_body=body)
        return DatasetRowPage(result)

    async def query_version_rows(
        self,
        dataset_version_id: str,
        *,
        limit: int = 200,
        offset: int = 0,
    ) -> DatasetVersionRowPage:
        body: dict[str, Any] = {
            "p_dataset_version_id": dataset_version_id,
            "p_limit": limit,
            "p_offset": offset,
        }
        result = await self._t.post("/api/db/rpc/query_dataset_version_rows", json_body=body)
        return DatasetVersionRowPage(result)

    async def validate_rows(
        self,
        dataset_id: str,
        expected_dataset_revision: int,
        rows: Sequence[dict[str, Any]] | DatasetRowBatch,
    ) -> ValidationResult:
        payload = rows.to_payload() if isinstance(rows, DatasetRowBatch) else list(rows)
        result = await self._t.post(
            "/api/db/rpc/validate_dataset_row_batch",
            json_body={
                "p_dataset_id": dataset_id,
                "p_expected_dataset_revision": expected_dataset_revision,
                "p_rows": payload,
            },
        )
        return ValidationResult.from_dict(result)

    async def commit_rows(
        self,
        dataset_id: str,
        expected_revision: int,
        rows: Sequence[dict[str, Any]] | DatasetRowBatch,
        *,
        idempotency_key: Optional[str] = None,
        retry_on_stale: bool = True,
        max_retries: int = 3,
    ) -> CommitResult:
        payload = rows.to_payload() if isinstance(rows, DatasetRowBatch) else list(rows)
        key = idempotency_key or str(_uuid.uuid4())
        attempt = 0
        current_revision = expected_revision
        current_key = key
        while True:
            try:
                result = await self._t.post(
                    "/api/db/rpc/commit_dataset_row_batch",
                    json_body={
                        "p_dataset_id": dataset_id,
                        "p_expected_dataset_revision": current_revision,
                        "p_rows": payload,
                        "p_idempotency_key": current_key,
                    },
                )
                return CommitResult.from_dict(result)
            except StaleVersionError:
                if not retry_on_stale or attempt >= max_retries:
                    raise
                attempt += 1
                ds = await self.get(dataset_id)
                current_revision = ds.revision
                current_key = str(_uuid.uuid4())

    async def snapshot(
        self,
        dataset_id: str,
        expected_revision: int,
        label: str,
    ) -> DatasetVersion:
        result = await self._t.post(
            "/api/db/rpc/snapshot_dataset",
            json_body={
                "p_dataset_id": dataset_id,
                "p_expected_dataset_revision": expected_revision,
                "p_label": label,
            },
        )
        if isinstance(result, list):
            return DatasetVersion.from_dict(result[0])
        return DatasetVersion.from_dict(result)

    async def archive(self, dataset_id: str, expected_revision: int) -> Any:
        return await self._t.post(
            "/api/db/rpc/archive_dataset",
            json_body={"p_dataset_id": dataset_id, "p_expected_revision": expected_revision},
        )

    async def restore(self, dataset_id: str, expected_revision: int) -> Any:
        return await self._t.post(
            "/api/db/rpc/restore_dataset",
            json_body={"p_dataset_id": dataset_id, "p_expected_revision": expected_revision},
        )

    async def to_dataframe(
        self,
        dataset_id: str,
        *,
        filters: Optional[list[dict[str, Any]]] = None,
        sort: Optional[dict[str, str]] = None,
        max_items: Optional[int] = None,
    ):
        """Fetch all matching rows and return a pandas DataFrame."""
        all_rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            remaining = None if max_items is None else max_items - len(all_rows)
            limit = min(1000, remaining) if remaining else 1000
            if limit <= 0:
                break
            page = await self.query_rows(
                dataset_id, filters=filters, sort=sort, limit=limit, offset=offset
            )
            all_rows.extend(page.rows)
            if not page.has_more or (max_items and len(all_rows) >= max_items):
                break
            offset += len(page.rows)

        import pandas as pd
        records: list[dict[str, Any]] = []
        for row in all_rows:
            record: dict[str, Any] = {"row_id": str(row.row_id), "revision": row.revision}
            record.update(row.values)
            records.append(record)
        return pd.DataFrame(records)


class AsyncSheets:
    def __init__(self, transport: AsyncHttpTransport) -> None:
        self._t = transport

    async def list(
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
        rows = await self._t.get("/api/db/sheet_instances", params=params)
        return [SheetInstance.from_dict(r) for r in rows]

    async def get(self, instance_id: str) -> SheetInstance:
        rows = await self._t.get("/api/db/sheet_instances", params={"id": f"eq.{instance_id}", "limit": 1})
        if not rows:
            raise NotFoundError("not_found", f"Sheet instance {instance_id} not found.")
        return SheetInstance.from_dict(rows[0])

    async def query_rows(
        self,
        instance_id: str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        return await self._t.post(
            "/api/db/rpc/query_sheet_instance_rows",
            json_body={
                "p_instance_id": instance_id,
                "p_limit": limit,
                "p_offset": offset,
            },
        )


class AsyncSearch:
    def __init__(self, transport: AsyncHttpTransport) -> None:
        self._t = transport

    async def search(
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
        results = await self._t.post("/api/db/rpc/search", json_body=body)
        total = results[0]["total_count"] if results else 0
        return SearchPage(results, total)


class AsyncCatalogues:
    def __init__(self, transport: AsyncHttpTransport) -> None:
        self._t = transport

    async def list_schema_definitions(
        self, *, limit: int = 100, offset: int = 0, order: Optional[str] = None
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if order:
            params["order"] = order
        return await self._t.get("/api/db/dataset_schema_definitions", params=params)

    async def list_schema_versions(
        self, *, limit: int = 100, offset: int = 0
    ) -> list[dict[str, Any]]:
        return await self._t.get(
            "/api/db/dataset_schema_versions",
            params={"limit": limit, "offset": offset},
        )

    async def list_schema_version_fields(
        self,
        *,
        schema_version_id: Optional[str] = None,
        limit: int = 1000,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if schema_version_id:
            params["dataset_schema_version_id"] = f"eq.{schema_version_id}"
        return await self._t.get("/api/db/dataset_schema_version_fields", params=params)

    async def list_templates(
        self, *, limit: int = 100, offset: int = 0
    ) -> list[dict[str, Any]]:
        return await self._t.get(
            "/api/db/notebook_templates",
            params={"limit": limit, "offset": offset},
        )
