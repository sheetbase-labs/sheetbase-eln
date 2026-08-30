"""Tests for the Records resource."""
import httpx
import pytest

from sheetbase import SheetbaseClient
from sheetbase.types import Record
from sheetbase.errors import NotFoundError

from tests.conftest import BASE_URL, CREDENTIAL


class TestRecordsResource:
    def test_list_records(self, mock_transport, record_row):
        mock_transport.get("/api/db/records").respond(200, json=[record_row])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            records = client.records.list()
        assert len(records) == 1
        assert isinstance(records[0], Record)
        assert records[0].kind == "experiment"
        assert records[0].identifier == "EXP-2026-0001"

    def test_list_records_with_filters(self, mock_transport, record_row):
        route = mock_transport.get("/api/db/records")
        route.respond(200, json=[record_row])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            client.records.list(kind="experiment", project_id="proj-001")
        request = route.calls[0].request
        assert "kind=eq.experiment" in str(request.url)
        assert "project_id=eq.proj-001" in str(request.url)

    def test_get_record(self, mock_transport, record_row):
        mock_transport.get("/api/db/records").respond(200, json=[record_row])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            record = client.records.get(record_row["id"])
        assert str(record.id) == record_row["id"]
        assert record.kind == "experiment"

    def test_get_record_not_found(self, mock_transport):
        mock_transport.get("/api/db/records").respond(200, json=[])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            with pytest.raises(NotFoundError):
                client.records.get("nonexistent")

    def test_create_record(self, mock_transport, record_row):
        mock_transport.post("/api/db/rpc/create_record").respond(
            200, json=[record_row]
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:write"]) as client:
            record = client.records.create(
                project_id="550e8400-e29b-41d4-a716-446655440000",
                kind="experiment",
                title="Purification Run 1",
                status="in-progress",
                tags=["lentivector"],
            )
        assert isinstance(record, Record)
        assert record.title == "Purification Run 1"

    def test_update_record(self, mock_transport, record_row):
        updated = {**record_row, "title": "Updated Title"}
        mock_transport.patch("/api/db/records").respond(200, json=[updated])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:write"]) as client:
            result = client.records.update(record_row["id"], title="Updated Title")
        assert result[0]["title"] == "Updated Title"

    def test_iter_records(self, mock_transport, record_row):
        route = mock_transport.get("/api/db/records")
        route.mock(side_effect=[
            httpx.Response(200, json=[record_row, {**record_row, "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "identifier": "EXP-002"}]),
            httpx.Response(200, json=[]),
        ])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            records = list(client.records.iter(page_size=2))
        assert len(records) == 2
        assert all(isinstance(r, Record) for r in records)
