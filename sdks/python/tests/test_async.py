"""Tests for the AsyncSheetbaseClient."""
import httpx
import pytest

from sheetbase import AsyncSheetbaseClient
from sheetbase.types import Project, Dataset, DatasetVersion, CommitResult
from sheetbase.errors import TokenError

from tests.conftest import BASE_URL, CREDENTIAL


class TestAsyncClient:
    async def test_context_manager(self, mock_transport, project_row):
        mock_transport.get("/api/db/projects").respond(200, json=[project_row])
        async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            projects = await client.projects.list()
        assert len(projects) == 1
        assert isinstance(projects[0], Project)

    async def test_token_cached(self, mock_transport, project_row):
        mock_transport.get("/api/db/projects").respond(200, json=[project_row])
        async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            await client.projects.list()
            await client.projects.list()
        assert mock_transport["token"].call_count == 1

    async def test_unauthenticated_reexchanges_and_retries(self, mock_transport, project_row):
        route = mock_transport.get("/api/db/projects")
        route.mock(side_effect=[
            httpx.Response(401, json={"error": {"category": "unauthenticated"}}),
            httpx.Response(200, json=[project_row]),
        ])
        async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            assert len(await client.projects.list()) == 1
        assert route.call_count == 2
        assert mock_transport["token"].call_count == 2

    async def test_token_error(self):
        import respx
        with respx.mock(base_url=BASE_URL, assert_all_called=False) as router:
            router.post("/api/token").respond(
                401, json={"error": {"code": "invalid_credential", "message": "Bad."}}
            )
            async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
                with pytest.raises(TokenError) as exc_info:
                    await client.projects.list()
                assert exc_info.value.code == "invalid_credential"

    async def test_datasets_query_rows(self, mock_transport, dataset_rows_response):
        mock_transport.post("/api/db/rpc/query_dataset_rows").respond(
            200, json=dataset_rows_response
        )
        async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            page = await client.datasets.query_rows("770e8400-e29b-41d4-a716-446655440020")
        assert page.total_count == 2
        assert len(page.rows) == 2

    async def test_datasets_to_dataframe(self, mock_transport, dataset_rows_response):
        mock_transport.post("/api/db/rpc/query_dataset_rows").respond(
            200, json=dataset_rows_response
        )
        async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            df = await client.datasets.to_dataframe("770e8400-e29b-41d4-a716-446655440020")
        assert len(df) == 2
        assert "row_id" in df.columns

    async def test_commit_rows(self, mock_transport, commit_response):
        import uuid
        mock_transport.post("/api/db/rpc/commit_dataset_row_batch").respond(
            200, json=commit_response
        )
        async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:write"]) as client:
            result = await client.datasets.commit_rows(
                dataset_id="770e8400-e29b-41d4-a716-446655440020",
                expected_revision=3,
                rows=[{"operation": "create", "rowId": str(uuid.uuid4()), "values": {}}],
            )
        assert isinstance(result, CommitResult)
        assert result.ok is True

    async def test_rpc_escape_hatch(self, mock_transport):
        mock_transport.post("/api/db/rpc/search").respond(
            200, json=[{"result_type": "record", "record_id": "x", "kind": "experiment",
                        "identifier": "EXP-001", "title": "Test", "total_count": 1}]
        )
        async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            result = await client.rpc("search", query="test")
        assert isinstance(result, list)

    async def test_datasets_to_dataframe_with_labels(
        self, mock_transport, dataset_rows_response, schema_field_rows
    ):
        mock_transport.post("/api/db/rpc/query_dataset_rows").respond(
            200, json=dataset_rows_response
        )
        mock_transport.get("/api/db/dataset_schema_version_fields").respond(
            200, json=schema_field_rows
        )
        async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            labels = await client.datasets.field_label_map(
                schema_field_rows[0]["schema_version_id"]
            )
            df = await client.datasets.to_dataframe(
                dataset_rows_response["datasetId"], field_labels=labels
            )
        assert "Titer (vp/mL)" in df.columns
        assert "Cell Line" in df.columns

    async def test_datasets_list_versions(self, mock_transport, dataset_version_row):
        mock_transport.get("/api/db/dataset_versions").respond(
            200, json=[dataset_version_row]
        )
        async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            versions = await client.datasets.list_versions(dataset_version_row["dataset_id"])
        assert len(versions) == 1
        assert isinstance(versions[0], DatasetVersion)
        assert versions[0].label == "Day 14 freeze"

    async def test_datasets_version_to_dataframe(
        self, mock_transport, dataset_version_row
    ):
        rows_response = {
            "datasetVersionId": dataset_version_row["id"],
            "datasetId": dataset_version_row["dataset_id"],
            "schemaVersionId": dataset_version_row["schema_version_id"],
            "sourceDatasetRevision": dataset_version_row["source_dataset_revision"],
            "offset": 0,
            "limit": 200,
            "totalCount": 1,
            "hasMore": False,
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
        async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            df = await client.datasets.version_to_dataframe(dataset_version_row["id"])
        assert len(df) == 1
        assert df.iloc[0]["fff00000-0000-0000-0000-000000000001"] == 1.2e9
