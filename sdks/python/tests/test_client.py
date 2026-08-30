"""Tests for the SheetbaseClient — token exchange, headers, context manager."""
import pytest
import httpx
import respx

from sheetbase import SheetbaseClient
from sheetbase.errors import TokenError, NotFoundError, PermissionDeniedError

from tests.conftest import BASE_URL, CREDENTIAL, SCOPES


class TestSheetbaseClient:
    def test_non_https_rejected(self):
        with pytest.raises(ValueError, match="HTTPS"):
            SheetbaseClient("http://api.example.com", CREDENTIAL, ["projects:read"])

    def test_close_closes_owned_client(self):
        client = SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"])
        assert not client._transport._closed
        client.close()
        assert client._transport._client.is_closed

    def test_context_manager_closes(self, mock_transport, project_row):
        mock_transport.get("/api/db/projects").respond(200, json=[project_row])
        with SheetbaseClient(BASE_URL, CREDENTIAL, SCOPES) as client:
            assert client.version == "0.1.0"
            client.projects.list()

    def test_token_exchange_on_first_request(self, mock_transport, project_row):
        mock_transport.get("/api/db/projects").respond(200, json=[project_row])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            projects = client.projects.list()
        assert len(projects) == 1
        # Verify token exchange was called
        assert mock_transport["token"].called

    def test_token_cached_between_requests(self, mock_transport, project_row):
        mock_transport.get("/api/db/projects").respond(200, json=[project_row])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            client.projects.list()
            client.projects.list()
        # Token endpoint should only be called once
        assert mock_transport["token"].call_count == 1

    def test_unauthenticated_reexchanges_and_retries(self, mock_transport, project_row):
        route = mock_transport.get("/api/db/projects")
        route.mock(side_effect=[
            httpx.Response(401, json={"error": {"category": "unauthenticated"}}),
            httpx.Response(200, json=[project_row]),
        ])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            assert len(client.projects.list()) == 1
        assert route.call_count == 2
        assert mock_transport["token"].call_count == 2

    def test_token_error_on_bad_credential(self):
        with respx.mock(base_url=BASE_URL, assert_all_called=False) as router:
            router.post("/api/token").respond(
                401, json={"error": {"code": "invalid_credential", "message": "Invalid."}}
            )
            with SheetbaseClient(BASE_URL, "sb_bad_", ["projects:read"]) as client:
                with pytest.raises(TokenError) as exc_info:
                    client.projects.list()
                assert exc_info.value.code == "invalid_credential"

    def test_data_path_error(self, mock_transport):
        mock_transport.get("/api/db/projects").respond(
            403,
            json={
                "error": {
                    "category": "permission_denied",
                    "message": "Insufficient scope.",
                    "request_id": "req-abc",
                }
            },
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            with pytest.raises(PermissionDeniedError) as exc_info:
                client.projects.list()
            assert exc_info.value.category == "permission_denied"
            assert exc_info.value.request_id == "req-abc"

    def test_not_found_error(self, mock_transport):
        mock_transport.get("/api/db/projects").respond(
            404,
            json={"error": {"category": "not_found", "message": "Not found."}},
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            with pytest.raises(NotFoundError):
                client.projects.get("nonexistent-id")

    def test_rpc_escape_hatch(self, mock_transport):
        mock_transport.post("/api/db/rpc/search").respond(
            200, json=[{"result_type": "record", "record_id": "x", "kind": "experiment",
                        "identifier": "EXP-001", "title": "Test", "total_count": 1}]
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            result = client.rpc("search", query="test")
        assert isinstance(result, list)
        assert result[0]["title"] == "Test"

    def test_raw_table_get(self, mock_transport, project_row):
        mock_transport.get("/api/db/projects").respond(200, json=[project_row])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            rows = client.table_get("projects", params={"limit": 10})
        assert len(rows) == 1
        assert rows[0]["key"] == "lenti-purification"
