"""Tests for the Search resource."""
import httpx
import pytest

from sheetbase import SheetbaseClient
from sheetbase.types import SearchResult

from tests.conftest import BASE_URL, CREDENTIAL


class TestSearchResource:
    def test_search(self, mock_transport):
        results = [
            {
                "result_type": "record",
                "record_id": "550e8400-e29b-41d4-a716-446655440000",
                "kind": "experiment",
                "identifier": "EXP-2026-0001",
                "title": "Lentivector Purification",
                "status": "in-progress",
                "project_id": "660e8400-e29b-41d4-a716-446655440010",
                "archived": False,
                "created_by_user_id": "user-001",
                "created_at": "2026-01-15T10:30:00Z",
                "updated_at": "2026-01-16T08:00:00Z",
                "matched_context": "title",
                "matched_field": "title",
                "rank": 0.95,
                "deep_link": "/projects/lenti/records/EXP-2026-0001",
                "total_count": 2,
            },
            {
                "result_type": "record",
                "record_id": "550e8400-e29b-41d4-a716-446655440001",
                "kind": "sample",
                "identifier": "SMP-2026-0001",
                "title": "Sample A",
                "status": "draft",
                "total_count": 2,
            },
        ]
        mock_transport.post("/api/db/rpc/search").respond(200, json=results)
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            page = client.search.search(query="lentivector")
        assert page.total_count == 2
        assert len(page.results) == 2
        assert isinstance(page.results[0], SearchResult)
        assert page.results[0].kind == "experiment"
        assert page.results[0].rank == 0.95

    def test_search_to_dataframe(self, mock_transport):
        results = [
            {
                "result_type": "record",
                "record_id": "550e8400-e29b-41d4-a716-446655440000",
                "kind": "experiment",
                "identifier": "EXP-2026-0001",
                "title": "Lentivector Purification",
                "total_count": 1,
            },
        ]
        mock_transport.post("/api/db/rpc/search").respond(200, json=results)
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            page = client.search.search(query="lenti")
        df = page.to_dataframe()
        assert len(df) == 1
        assert "kind" in df.columns
        assert df.iloc[0]["kind"] == "experiment"

    def test_search_with_filters(self, mock_transport):
        route = mock_transport.post("/api/db/rpc/search")
        route.respond(200, json=[])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            client.search.search(query="test", kind="experiment", status="in-progress")
        import json
        request = route.calls[0].request
        body = json.loads(request.content)
        assert body["p_query"] == "test"
        assert body["p_kind"] == "experiment"
        assert body["p_status"] == "in-progress"

    def test_search_sheet_records(self, mock_transport):
        mock_transport.post("/api/db/rpc/search_sheet_records").respond(
            200, json=[{"record_id": "r1", "identifier": "SMP-001", "title": "Sample A"}]
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["models:read"]) as client:
            results = client.search.search_sheet_records(model_key="sample", query="A")
        assert len(results) == 1
        assert results[0]["identifier"] == "SMP-001"

    def test_iter_search(self, mock_transport):
        # Search returns arrays, not paginated dicts. The iter wrapper
        # reads total_count from each row and determines hasMore.
        page1 = [
            {
                "result_type": "record",
                "record_id": f"550e8400-e29b-41d4-a716-44665544000{i}",
                "kind": "experiment",
                "identifier": f"EXP-{i:04d}",
                "title": f"Experiment {i}",
                "total_count": 5,
            }
            for i in range(3)
        ]
        page2 = [
            {
                "result_type": "record",
                "record_id": f"550e8400-e29b-41d4-a716-44665544000{i}",
                "kind": "experiment",
                "identifier": f"EXP-{i:04d}",
                "title": f"Experiment {i}",
                "total_count": 5,
            }
            for i in range(3, 5)
        ]
        route = mock_transport.post("/api/db/rpc/search")
        route.mock(side_effect=[
            httpx.Response(200, json=page1),
            httpx.Response(200, json=page2),
        ])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            results = list(client.search.iter(query="exp", page_size=3))
        assert len(results) == 5
        assert all(isinstance(r, SearchResult) for r in results)
