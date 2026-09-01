"""Tests for the Datasets resource — query, commit, snapshot, pagination, pandas."""
import json
import uuid

import httpx
import pytest

from sheetbase import SheetbaseClient
from sheetbase.resources.datasets import DatasetRowBatch
from sheetbase.types import Dataset, DatasetVersion, CommitResult, ValidationResult
from sheetbase.errors import StaleVersionError

from tests.conftest import BASE_URL, CREDENTIAL


class TestDatasetsResource:
    def test_list_datasets(self, mock_transport, dataset_row):
        mock_transport.get("/api/db/datasets").respond(200, json=[dataset_row])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            datasets = client.datasets.list()
        assert len(datasets) == 1
        assert isinstance(datasets[0], Dataset)
        assert datasets[0].name == "Purification Data"
        assert datasets[0].revision == 3

    def test_get_dataset(self, mock_transport, dataset_row):
        mock_transport.get("/api/db/datasets").respond(200, json=[dataset_row])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            ds = client.datasets.get(dataset_row["id"])
        assert str(ds.id) == dataset_row["id"]
        assert ds.revision == 3

    @pytest.mark.parametrize(
        ("method", "path"),
        [("archive", "archive_dataset"), ("restore", "restore_dataset")],
    )
    def test_archive_restore_contract(self, mock_transport, dataset_row, method, path):
        route = mock_transport.post(f"/api/db/rpc/{path}").respond(200, json=[])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:write"]) as client:
            getattr(client.datasets, method)(dataset_row["id"], expected_revision=3)
        assert json.loads(route.calls[0].request.content) == {
            "p_dataset_id": dataset_row["id"], "p_expected_revision": 3
        }

    def test_query_rows(self, mock_transport, dataset_rows_response):
        mock_transport.post("/api/db/rpc/query_dataset_rows").respond(
            200, json=dataset_rows_response
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            page = client.datasets.query_rows(dataset_id="770e8400-e29b-41d4-a716-446655440020")
        assert page.total_count == 2
        assert page.has_more is False
        assert len(page.rows) == 2
        assert page.rows[0].revision == 1

    def test_query_rows_to_dataframe(self, mock_transport, dataset_rows_response):
        mock_transport.post("/api/db/rpc/query_dataset_rows").respond(
            200, json=dataset_rows_response
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            page = client.datasets.query_rows(dataset_id="770e8400-e29b-41d4-a716-446655440020")
        df = page.to_dataframe()
        assert len(df) == 2
        assert "row_id" in df.columns
        assert "revision" in df.columns
        assert "fff00000-0000-0000-0000-000000000001" in df.columns

    def test_commit_rows(self, mock_transport, commit_response):
        mock_transport.post("/api/db/rpc/commit_dataset_row_batch").respond(
            200, json=commit_response
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:write"]) as client:
            result = client.datasets.commit_rows(
                dataset_id="770e8400-e29b-41d4-a716-446655440020",
                expected_revision=3,
                rows=[
                    {
                        "operation": "create",
                        "rowId": str(uuid.uuid4()),
                        "values": {"fff00000-0000-0000-0000-000000000001": 1.2e9},
                    }
                ],
            )
        assert isinstance(result, CommitResult)
        assert result.ok is True
        assert result.idempotent is False
        assert result.dataset_revision == 4

    def test_commit_rows_with_batch_builder(self, mock_transport, commit_response):
        route = mock_transport.post("/api/db/rpc/commit_dataset_row_batch")
        route.respond(200, json=commit_response)
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:write"]) as client:
            batch = DatasetRowBatch()
            batch.create(values={"field-uuid": "value1"})
            batch.create(values={"field-uuid": "value2"})
            result = client.datasets.commit_rows(
                dataset_id="770e8400-e29b-41d4-a716-446655440020",
                expected_revision=3,
                rows=batch,
            )
        assert result.ok is True
        # Verify the body had the batch rows
        request = route.calls[0].request
        import json
        body = json.loads(request.content)
        assert len(body["p_rows"]) == 2
        assert body["p_rows"][0]["operation"] == "create"
        assert "p_idempotency_key" in body

    def test_commit_rows_idempotency_key_in_body(self, mock_transport, commit_response):
        route = mock_transport.post("/api/db/rpc/commit_dataset_row_batch")
        route.respond(200, json=commit_response)
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:write"]) as client:
            client.datasets.commit_rows(
                dataset_id="770e8400-e29b-41d4-a716-446655440020",
                expected_revision=3,
                rows=[{"operation": "create", "rowId": str(uuid.uuid4()), "values": {}}],
                idempotency_key="my-key-001",
            )
        request = route.calls[0].request
        import json
        body = json.loads(request.content)
        assert body["p_idempotency_key"] == "my-key-001"

    def test_commit_rows_stale_version_retry(self, mock_transport, dataset_row, commit_response):
        # First attempt: stale_version. Second attempt: re-read dataset revision, then success.
        commit_route = mock_transport.post("/api/db/rpc/commit_dataset_row_batch")
        commit_route.mock(side_effect=[
            httpx.Response(409, json={"error": {"category": "stale_version", "message": "Revision mismatch."}}),
            httpx.Response(200, json=commit_response),
        ])

        # The retry re-reads the dataset to get the current revision.
        mock_transport.get("/api/db/datasets").respond(200, json=[dataset_row])

        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:write", "datasets:read"]) as client:
            result = client.datasets.commit_rows(
                dataset_id="770e8400-e29b-41d4-a716-446655440020",
                expected_revision=2,  # stale — should retry with revision 3
                rows=[{"operation": "create", "rowId": str(uuid.uuid4()), "values": {}}],
            )
        assert result.ok is True
        # Two commit attempts (first stale, second success) + one dataset get.
        assert commit_route.call_count == 2

    def test_commit_rows_stale_version_no_retry(self, mock_transport):
        route = mock_transport.post("/api/db/rpc/commit_dataset_row_batch")
        route.respond(
            409,
            json={"error": {"category": "stale_version", "message": "Revision mismatch."}},
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:write"]) as client:
            with pytest.raises(StaleVersionError):
                client.datasets.commit_rows(
                    dataset_id="770e8400-e29b-41d4-a716-446655440020",
                    expected_revision=2,
                    rows=[{"operation": "create", "rowId": str(uuid.uuid4()), "values": {}}],
                    retry_on_stale=False,
                )
        assert route.call_count == 1

    def test_validate_rows_success(self, mock_transport):
        mock_transport.post("/api/db/rpc/validate_dataset_row_batch").respond(
            200, json={"ok": True}
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:write"]) as client:
            result = client.datasets.validate_rows(
                dataset_id="770e8400-e29b-41d4-a716-446655440020",
                expected_dataset_revision=3,
                rows=[{"operation": "create", "rowId": str(uuid.uuid4()), "values": {}}],
            )
        assert isinstance(result, ValidationResult)
        assert result.ok is True
        assert result.errors == []

    def test_validate_rows_with_errors(self, mock_transport):
        mock_transport.post("/api/db/rpc/validate_dataset_row_batch").respond(
            200,
            json={
                "ok": False,
                "errors": [
                    {
                        "rowIndex": 0,
                        "rowId": "aaa11111-2222-3333-4444-555555555501",
                        "fieldId": "fff00000-0000-0000-0000-000000000001",
                        "code": "invalid_type",
                    }
                ],
            },
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:write"]) as client:
            result = client.datasets.validate_rows(
                dataset_id="770e8400-e29b-41d4-a716-446655440020",
                expected_dataset_revision=3,
                rows=[{"operation": "create", "rowId": str(uuid.uuid4()), "values": {}}],
            )
        assert result.ok is False
        assert len(result.errors) == 1
        assert result.errors[0].code == "invalid_type"

    def test_snapshot_dataset(self, mock_transport, dataset_row):
        version_row = {
            "id": "999e8400-e29b-41d4-a716-446655440040",
            "workspace_id": dataset_row["workspace_id"],
            "dataset_id": dataset_row["id"],
            "schema_version_id": dataset_row["schema_version_id"],
            "label": "v1.0",
            "source_dataset_revision": 3,
            "created_at": "2026-01-17T10:00:00Z",
            "created_by_user_id": "user-001",
            "created_by_credential_id": None,
        }
        mock_transport.post("/api/db/rpc/snapshot_dataset").respond(
            200, json=[version_row]
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:write"]) as client:
            version = client.datasets.snapshot(
                dataset_id=dataset_row["id"],
                expected_revision=3,
                label="v1.0",
            )
        assert isinstance(version, DatasetVersion)
        assert version.label == "v1.0"
        assert version.source_dataset_revision == 3

    def test_iter_rows_pagination(self, mock_transport):
        # Page 1: 2 rows, hasMore=True. Page 2: 1 row, hasMore=False.
        page1 = {
            "datasetId": "770e8400-e29b-41d4-a716-446655440020",
            "datasetRevision": 3,
            "offset": 0,
            "limit": 2,
            "totalCount": 3,
            "hasMore": True,
            "rows": [
                {"rowId": "aaa11111-2222-3333-4444-555555555501", "revision": 1, "values": {"f1": "a"}},
                {"rowId": "aaa11111-2222-3333-4444-555555555502", "revision": 1, "values": {"f1": "b"}},
            ],
        }
        page2 = {
            "datasetId": "770e8400-e29b-41d4-a716-446655440020",
            "datasetRevision": 3,
            "offset": 2,
            "limit": 2,
            "totalCount": 3,
            "hasMore": False,
            "rows": [
                {"rowId": "aaa11111-2222-3333-4444-555555555503", "revision": 1, "values": {"f1": "c"}},
            ],
        }
        route = mock_transport.post("/api/db/rpc/query_dataset_rows")
        route.mock(side_effect=[
            httpx.Response(200, json=page1),
            httpx.Response(200, json=page2),
        ])

        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            rows = list(client.datasets.iter_rows(
                "770e8400-e29b-41d4-a716-446655440020", page_size=2
            ))
        assert len(rows) == 3
        assert rows[0]["values"]["f1"] == "a"
        assert rows[2]["values"]["f1"] == "c"

    def test_iter_rows_max_items(self, mock_transport):
        page1 = {
            "datasetId": "d1",
            "datasetRevision": 1,
            "offset": 0,
            "limit": 10,
            "totalCount": 100,
            "hasMore": True,
            "rows": [{"rowId": f"aaa11111-2222-3333-4444-55555555550{i}", "revision": 1, "values": {}} for i in range(10)],
        }
        route = mock_transport.post("/api/db/rpc/query_dataset_rows")
        route.respond(200, json=page1)

        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            rows = list(client.datasets.iter_rows(
                "d1", page_size=10, max_items=5
            ))
        assert len(rows) == 5

    def test_upload_dataframe(self, mock_transport, commit_response):
        import pandas as pd
        route = mock_transport.post("/api/db/rpc/commit_dataset_row_batch")
        route.respond(200, json=commit_response)
        df = pd.DataFrame({
            "fff00000-0000-0000-0000-000000000001": [1.2e9, 8.5e8],
            "fff00000-0000-0000-0000-000000000002": ["HEK293T", "Vero"],
        })
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:write"]) as client:
            results = client.datasets.upload_dataframe(
                dataset_id="770e8400-e29b-41d4-a716-446655440020",
                expected_revision=3,
                df=df,
                batch_size=500,
            )
        assert len(results) == 1
        assert results[0].ok is True
        # Verify the commit body had create operations for each row
        request = route.calls[0].request
        import json
        body = json.loads(request.content)
        assert len(body["p_rows"]) == 2
        assert body["p_rows"][0]["operation"] == "create"

    def test_download_dataframe(self, mock_transport, dataset_rows_response):
        mock_transport.post("/api/db/rpc/query_dataset_rows").respond(
            200, json=dataset_rows_response
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            df = client.datasets.download_dataframe("770e8400-e29b-41d4-a716-446655440020")
        assert len(df) == 2
        assert "row_id" in df.columns
        assert "fff00000-0000-0000-0000-000000000001" in df.columns


class TestVersionAccess:
    def test_list_versions(self, mock_transport, dataset_version_row):
        route = mock_transport.get("/api/db/dataset_versions").respond(
            200, json=[dataset_version_row]
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            versions = client.datasets.list_versions(dataset_version_row["dataset_id"])
        assert len(versions) == 1
        assert isinstance(versions[0], DatasetVersion)
        assert versions[0].label == "Day 14 freeze"
        assert versions[0].source_dataset_revision == 3
        assert route.calls[0].request.url.params["dataset_id"] == f"eq.{dataset_version_row["dataset_id"]}"
        assert route.calls[0].request.url.params["order"] == "created_at.desc"

    def test_iter_versions_pagination(self, mock_transport, dataset_version_row):
        mock_transport.get("/api/db/dataset_versions").respond(
            200, json=[dataset_version_row]
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            versions = list(client.datasets.iter_versions(dataset_version_row["dataset_id"]))
        assert len(versions) == 1
        assert versions[0].label == "Day 14 freeze"


class TestSchemaFields:
    def test_schema_fields(self, mock_transport, schema_field_rows):
        route = mock_transport.get("/api/db/dataset_schema_version_fields").respond(
            200, json=schema_field_rows
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            fields = client.datasets.schema_fields(schema_field_rows[0]["schema_version_id"])
        assert len(fields) == 2
        assert fields[0].label == "Titer (vp/mL)"
        assert fields[0].logical_type == "decimal"
        assert route.calls[0].request.url.params["schema_version_id"] == f"eq.{schema_field_rows[0]["schema_version_id"]}"

    def test_field_label_map(self, mock_transport, schema_field_rows):
        mock_transport.get("/api/db/dataset_schema_version_fields").respond(
            200, json=schema_field_rows
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            labels = client.datasets.field_label_map(schema_field_rows[0]["schema_version_id"])
        assert labels == {
            "fff00000-0000-0000-0000-000000000001": "Titer (vp/mL)",
            "fff00000-0000-0000-0000-000000000002": "Cell Line",
        }

    def test_to_dataframe_with_field_labels(self, mock_transport, dataset_rows_response, schema_field_rows):
        mock_transport.post("/api/db/rpc/query_dataset_rows").respond(
            200, json=dataset_rows_response
        )
        mock_transport.get("/api/db/dataset_schema_version_fields").respond(
            200, json=schema_field_rows
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            labels = client.datasets.field_label_map(schema_field_rows[0]["schema_version_id"])
            df = client.datasets.to_dataframe(
                dataset_id=dataset_rows_response["datasetId"],
                field_labels=labels,
            )
        assert "Titer (vp/mL)" in df.columns
        assert "Cell Line" in df.columns
        assert "fff00000-0000-0000-0000-000000000001" not in df.columns

    def test_version_to_dataframe(self, mock_transport, dataset_version_row):
        rows_response = {
            "datasetVersionId": dataset_version_row["id"],
            "offset": 0,
            "limit": 200,
            "totalCount": 1,
            "rows": [
                {
                    "rowId": "aaa11111-2222-3333-4444-555555555501",
                    "revision": 3,
                    "values": {"fff00000-0000-0000-0000-000000000001": 1.2e9},
                }
            ],
        }
        mock_transport.post("/api/db/rpc/query_dataset_version_rows").respond(
            200, json=rows_response
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            df = client.datasets.version_to_dataframe(dataset_version_row["id"])
        assert len(df) == 1
        assert df.iloc[0]["row_id"] == "aaa11111-2222-3333-4444-555555555501"
        assert df.iloc[0]["fff00000-0000-0000-0000-000000000001"] == 1.2e9

    def test_iter_version_rows_paginates_by_total_count(self, mock_transport, dataset_version_row):
        """Version RPC returns totalCount but no hasMore; pages must continue."""
        def version_page(offset: int, limit: int) -> dict:
            row_count = min(limit, 5 - offset)
            return {
                "datasetVersionId": dataset_version_row["id"],
                "datasetId": dataset_version_row["dataset_id"],
                "schemaVersionId": dataset_version_row["schema_version_id"],
                "sourceDatasetRevision": dataset_version_row["source_dataset_revision"],
                "offset": offset,
                "limit": limit,
                "totalCount": 5,
                "rows": [
                    {
                        "rowId": f"aaa11111-2222-3333-4444-{offset + i + 1:012d}",
                        "revision": 3,
                        "values": {"fff00000-0000-0000-0000-000000000001": offset + i + 1},
                    }
                    for i in range(row_count)
                ],
            }

        offsets: list[int] = []

        def page_side_effect(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            offsets.append(body["p_offset"])
            return httpx.Response(200, json=version_page(body["p_offset"], body["p_limit"]))

        route = mock_transport.post("/api/db/rpc/query_dataset_version_rows")
        route.mock(side_effect=page_side_effect)

        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            rows = list(client.datasets.iter_version_rows(
                dataset_version_row["id"], page_size=2
            ))
        assert len(rows) == 5
        assert rows[4]["values"]["fff00000-0000-0000-0000-000000000001"] == 5
        assert offsets == [0, 2, 4]

        # max_items stops mid-stream without fetching past the cap.
        offsets.clear()
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            capped = list(client.datasets.iter_version_rows(
                dataset_version_row["id"], page_size=2, max_items=3
            ))
        assert len(capped) == 3
        assert offsets == [0, 2]

    def test_version_to_dataframe_paginates_multiple_pages(self, mock_transport, dataset_version_row):
        def version_page(offset: int, limit: int) -> dict:
            # Server caps each window at 2 rows even when more are requested;
            # totalCount=4 keeps the iterator going across short pages.
            row_count = min(2, 4 - offset)
            return {
                "datasetVersionId": dataset_version_row["id"],
                "datasetId": dataset_version_row["dataset_id"],
                "schemaVersionId": dataset_version_row["schema_version_id"],
                "sourceDatasetRevision": dataset_version_row["source_dataset_revision"],
                "offset": offset,
                "limit": limit,
                "totalCount": 4,
                "rows": [
                    {
                        "rowId": f"aaa11111-2222-3333-4444-{offset + i + 1:012d}",
                        "revision": 3,
                        "values": {"fff00000-0000-0000-0000-000000000001": float(offset + i + 1)},
                    }
                    for i in range(row_count)
                ],
            }

        offsets: list[int] = []

        def page_side_effect(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            offsets.append(body["p_offset"])
            return httpx.Response(200, json=version_page(body["p_offset"], body["p_limit"]))

        route = mock_transport.post("/api/db/rpc/query_dataset_version_rows")
        route.mock(side_effect=page_side_effect)

        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            df = client.datasets.version_to_dataframe(
                dataset_version_row["id"], max_items=4
            )
        assert len(df) == 4
        assert sorted(df["row_id"]) == [
            f"aaa11111-2222-3333-4444-{n:012d}" for n in range(1, 5)
        ]
        assert offsets == [0, 2]
