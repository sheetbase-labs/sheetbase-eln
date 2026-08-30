"""Dataset resource — the primary data-plane surface for scientific Python users.

Covers:
- querying live and versioned rows with pagination iterators and pandas conversion;
- validating and committing row batches with idempotency and optimistic concurrency;
- snapshotting, archiving and restoring datasets;
- bulk upload/download helpers.
"""
from __future__ import annotations

import uuid as _uuid
from collections.abc import Iterator
from typing import Any, Optional, Sequence

from sheetbase._http import HttpTransport
from sheetbase._pagination import iter_rpc
from sheetbase._query_result import DatasetRowPage, DatasetVersionRowPage
from sheetbase.errors import StaleVersionError
from sheetbase.types import CommitResult, Dataset, DatasetVersion, ValidationResult


class DatasetRowBatch:
    """Builder for dataset row batch operations (validate + commit)."""

    def __init__(self) -> None:
        self._rows: list[dict[str, Any]] = []

    def create(
        self,
        row_id: Optional[str] = None,
        values: Optional[dict[str, Any]] = None,
    ) -> DatasetRowBatch:
        """Add a create operation. A fresh UUID is generated if ``row_id`` is omitted."""
        self._rows.append({
            "operation": "create",
            "rowId": row_id or str(_uuid.uuid4()),
            "values": values or {},
        })
        return self

    def update(
        self,
        row_id: str,
        expected_revision: int,
        values: Optional[dict[str, Any]] = None,
    ) -> DatasetRowBatch:
        """Add an update operation. ``expected_revision`` is the row's current revision."""
        self._rows.append({
            "operation": "update",
            "rowId": row_id,
            "expectedRevision": expected_revision,
            "values": values or {},
        })
        return self

    def to_payload(self) -> list[dict[str, Any]]:
        return list(self._rows)

    @property
    def rows(self) -> list[dict[str, Any]]:
        return list(self._rows)

    def __len__(self) -> int:
        return len(self._rows)


class DatasetsResource:
    """Dataset operations on the Sheetbase data plane."""

    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    # ── catalogue ──────────────────────────────────────────────────────

    def list(
        self,
        *,
        select: Optional[str] = None,
        order: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Dataset]:
        """List datasets (table read)."""
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if select:
            params["select"] = select
        if order:
            params["order"] = order
        rows = self._transport.get("/api/db/datasets", params=params)
        return [Dataset.from_dict(r) for r in rows]

    def get(self, dataset_id: str) -> Dataset:
        """Fetch a single dataset by UUID."""
        rows = self._transport.get(
            "/api/db/datasets",
            params={"id": f"eq.{dataset_id}", "limit": 1},
        )
        if not rows:
            from sheetbase.errors import NotFoundError
            raise NotFoundError("not_found", f"Dataset {dataset_id} not found.")
        return Dataset.from_dict(rows[0])

    def create(
        self,
        *,
        workspace_id: str,
        schema_version_id: str,
        name: str,
        description: Optional[str] = None,
        primary_project_id: Optional[str] = None,
    ) -> Dataset:
        """Create a dataset (table INSERT — no create RPC exists)."""
        body: dict[str, Any] = {
            "workspace_id": workspace_id,
            "schema_version_id": schema_version_id,
            "name": name,
        }
        if description is not None:
            body["description"] = description
        if primary_project_id is not None:
            body["primary_project_id"] = primary_project_id
        rows = self._transport.post("/api/db/datasets", json_body=body)
        if isinstance(rows, list):
            return Dataset.from_dict(rows[0])
        return Dataset.from_dict(rows)

    # ── row queries ─────────────────────────────────────────────────────

    def query_rows(
        self,
        dataset_id: str,
        *,
        filters: Optional[list[dict[str, Any]]] = None,
        sort: Optional[dict[str, str]] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> DatasetRowPage:
        """Query live dataset rows. Returns one page with ``has_more`` metadata."""
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
        result = self._transport.post(
            "/api/db/rpc/query_dataset_rows", json_body=body
        )
        return DatasetRowPage(result)

    def query_version_rows(
        self,
        dataset_version_id: str,
        *,
        limit: int = 200,
        offset: int = 0,
    ) -> DatasetVersionRowPage:
        """Query immutable dataset version rows."""
        body: dict[str, Any] = {
            "p_dataset_version_id": dataset_version_id,
            "p_limit": limit,
            "p_offset": offset,
        }
        result = self._transport.post(
            "/api/db/rpc/query_dataset_version_rows", json_body=body
        )
        return DatasetVersionRowPage(result)

    def iter_rows(
        self,
        dataset_id: str,
        *,
        filters: Optional[list[dict[str, Any]]] = None,
        sort: Optional[dict[str, str]] = None,
        page_size: int = 1000,
        max_items: Optional[int] = None,
    ) -> Iterator[dict[str, Any]]:
        """Iterate all live dataset rows, auto-paginating.

        ``for row in client.datasets.iter_rows(dataset_id):``
        """
        def fetch(*, limit: int, offset: int) -> dict[str, Any]:
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
            return self._transport.post(
                "/api/db/rpc/query_dataset_rows", json_body=body
            )

        return iter_rpc(fetch, page_size=page_size, max_items=max_items)

    def iter_version_rows(
        self,
        dataset_version_id: str,
        *,
        page_size: int = 1000,
        max_items: Optional[int] = None,
    ) -> Iterator[dict[str, Any]]:
        """Iterate all rows in an immutable dataset version."""
        def fetch(*, limit: int, offset: int) -> dict[str, Any]:
            return self._transport.post(
                "/api/db/rpc/query_dataset_version_rows",
                json_body={
                    "p_dataset_version_id": dataset_version_id,
                    "p_limit": limit,
                    "p_offset": offset,
                },
            )

        return iter_rpc(fetch, page_size=page_size, max_items=max_items)

    def to_dataframe(
        self,
        dataset_id: str,
        *,
        filters: Optional[list[dict[str, Any]]] = None,
        sort: Optional[dict[str, str]] = None,
        max_items: Optional[int] = None,
    ):
        """Fetch all matching rows and return a single pandas DataFrame.

        Each row's ``values`` dict (field UUID → value) is expanded into
        columns. ``row_id`` and ``revision`` are included as metadata columns.
        """
        raw_rows = list(
            self.iter_rows(
                dataset_id, filters=filters, sort=sort, max_items=max_items
            )
        )
        import pandas as pd
        records: list[dict[str, Any]] = []
        for row in raw_rows:
            record: dict[str, Any] = {
                "row_id": row.get("rowId"),
                "revision": row.get("revision"),
            }
            record.update(row.get("values") or {})
            records.append(record)
        return pd.DataFrame(records)

    # ── validation ──────────────────────────────────────────────────────

    def validate_rows(
        self,
        dataset_id: str,
        expected_dataset_revision: int,
        rows: Sequence[dict[str, Any]] | DatasetRowBatch,
    ) -> ValidationResult:
        """Validate a row batch without committing. Checks types, constraints, etc."""
        payload = rows.to_payload() if isinstance(rows, DatasetRowBatch) else list(rows)
        result = self._transport.post(
            "/api/db/rpc/validate_dataset_row_batch",
            json_body={
                "p_dataset_id": dataset_id,
                "p_expected_dataset_revision": expected_dataset_revision,
                "p_rows": payload,
            },
        )
        return ValidationResult.from_dict(result)

    # ── commit with idempotency and stale-version retry ─────────────────

    def commit_rows(
        self,
        dataset_id: str,
        expected_revision: int,
        rows: Sequence[dict[str, Any]] | DatasetRowBatch,
        *,
        idempotency_key: Optional[str] = None,
        retry_on_stale: bool = True,
        max_retries: int = 3,
    ) -> CommitResult:
        """Commit a row batch with automatic idempotency and stale-version retry.

        - If ``idempotency_key`` is omitted, a UUID is generated so retries
          after transport failures are safe.
        - If ``retry_on_stale`` is ``True``, a ``stale_version`` error triggers
          a re-read of the dataset revision and a retry with a fresh
          idempotency key (the digest changed because the revision changed).
        """
        payload = rows.to_payload() if isinstance(rows, DatasetRowBatch) else list(rows)
        key = idempotency_key or str(_uuid.uuid4())

        attempt = 0
        current_revision = expected_revision
        current_key = key
        while True:
            try:
                result = self._transport.post(
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
                # Re-read the current revision and retry with a new key.
                ds = self.get(dataset_id)
                current_revision = ds.revision
                current_key = str(_uuid.uuid4())

    # ── snapshot / archive / restore ────────────────────────────────────

    def snapshot(
        self,
        dataset_id: str,
        expected_revision: int,
        label: str,
    ) -> DatasetVersion:
        """Create an immutable Dataset Version snapshot."""
        result = self._transport.post(
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

    def archive(self, dataset_id: str) -> Any:
        """Archive a dataset."""
        return self._transport.post(
            "/api/db/rpc/archive_dataset",
            json_body={"p_dataset_id": dataset_id},
        )

    def restore(self, dataset_id: str) -> Any:
        """Restore an archived dataset."""
        return self._transport.post(
            "/api/db/rpc/restore_dataset",
            json_body={"p_dataset_id": dataset_id},
        )

    # ── bulk upload/download ─────────────────────────────────────────────

    def upload_dataframe(
        self,
        dataset_id: str,
        expected_revision: int,
        df: Any,
        *,
        field_column_map: Optional[dict[str, str]] = None,
        batch_size: int = 500,
        idempotency_key: Optional[str] = None,
    ) -> list[CommitResult]:
        """Upload a pandas DataFrame as create operations in batches.

        ``field_column_map`` maps DataFrame column names to field UUIDs.
        If omitted, column names are used as field UUIDs directly.
        """
        results: list[CommitResult] = []
        for start in range(0, len(df), batch_size):
            batch = DatasetRowBatch()
            chunk = df.iloc[start : start + batch_size]
            for _, row in chunk.iterrows():
                values: dict[str, Any] = {}
                for col in chunk.columns:
                    field_id = field_column_map.get(col, col) if field_column_map else col
                    val = row[col]
                    # Convert NaN to None for JSON serialisation.
                    values[field_id] = None if val != val else val  # noqa: PLR0124
                batch.create(values=values)
            result = self.commit_rows(
                dataset_id,
                expected_revision,
                batch,
                idempotency_key=(
                    f"{idempotency_key}-{start // batch_size}"
                    if idempotency_key
                    else None
                ),
            )
            results.append(result)
            expected_revision = result.dataset_revision
        return results

    def download_dataframe(
        self,
        dataset_id: str,
        *,
        filters: Optional[list[dict[str, Any]]] = None,
        sort: Optional[dict[str, str]] = None,
        max_items: Optional[int] = None,
    ):
        """Download all rows from a dataset into a pandas DataFrame.

        Each row's ``values`` dict is expanded into columns.
        ``row_id`` and ``revision`` are included as metadata columns.
        """
        return self.to_dataframe(
            dataset_id, filters=filters, sort=sort, max_items=max_items
        )
