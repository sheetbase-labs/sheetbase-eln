"""Query result containers with pandas conversion."""
from __future__ import annotations

from typing import Any, Optional, Sequence

from sheetbase._pagination import iter_table, iter_rpc
from sheetbase.types import DatasetRow, SearchResult


class DatasetRowPage:
    """One page of dataset rows from ``query_dataset_rows``.

    Includes pagination metadata and a :meth:`to_dataframe` method.
    """

    def __init__(self, data: dict[str, Any]) -> None:
        self.dataset_id: str = data["datasetId"]
        self.dataset_revision: int = data["datasetRevision"]
        self.offset: int = data["offset"]
        self.limit: int = data["limit"]
        self.total_count: int = data["totalCount"]
        self.has_more: bool = data["hasMore"]
        self.rows: list[DatasetRow] = [
            DatasetRow.from_dict(r) for r in data.get("rows", [])
        ]

    def to_dataframe(self):
        """Convert to a pandas DataFrame.

        Each row's ``values`` dict (field UUID → value) is expanded into
        columns. ``row_id`` and ``revision`` are included as metadata columns.
        """
        import pandas as pd

        records: list[dict[str, Any]] = []
        for row in self.rows:
            record: dict[str, Any] = {
                "row_id": str(row.row_id),
                "revision": row.revision,
            }
            record.update(row.values)
            records.append(record)
        return pd.DataFrame(records)


class DatasetVersionRowPage:
    """One page of rows from ``query_dataset_version_rows``."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.dataset_version_id: str = data["datasetVersionId"]
        self.dataset_id: str = data["datasetId"]
        self.schema_version_id: str = data["schemaVersionId"]
        self.source_dataset_revision: int = data["sourceDatasetRevision"]
        self.offset: int = data["offset"]
        self.limit: int = data["limit"]
        self.total_count: int = data["totalCount"]
        self.rows: list[DatasetRow] = [
            DatasetRow.from_dict(r) for r in data.get("rows", [])
        ]

    def to_dataframe(self):
        """Convert to a pandas DataFrame."""
        import pandas as pd

        records: list[dict[str, Any]] = []
        for row in self.rows:
            record: dict[str, Any] = {
                "row_id": str(row.row_id),
                "revision": row.revision,
            }
            record.update(row.values)
            records.append(record)
        return pd.DataFrame(records)


class TablePage:
    """One page of PostgREST table rows."""

    def __init__(self, rows: list[dict[str, Any]], total: Optional[int] = None) -> None:
        self.rows = rows
        self.total = total

    def to_dataframe(self):
        """Convert to a pandas DataFrame."""
        import pandas as pd

        return pd.DataFrame(self.rows)


class SearchPage:
    """One page of search results."""

    def __init__(self, results: list[dict[str, Any]], total_count: int) -> None:
        self.results: list[SearchResult] = [
            SearchResult.from_dict(r) for r in results
        ]
        self.total_count = total_count

    def to_dataframe(self):
        """Convert to a pandas DataFrame."""
        import pandas as pd

        records: list[dict[str, Any]] = []
        for r in self.results:
            records.append({
                "result_type": r.result_type,
                "record_id": str(r.record_id),
                "kind": r.kind,
                "identifier": r.identifier,
                "title": r.title,
                "status": r.status,
                "archived": r.archived,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
                "matched_context": r.matched_context,
                "matched_field": r.matched_field,
                "rank": r.rank,
                "deep_link": r.deep_link,
            })
        return pd.DataFrame(records)
