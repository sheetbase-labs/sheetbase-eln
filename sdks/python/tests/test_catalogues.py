"""Tests for the Catalogues resource."""
from sheetbase import SheetbaseClient

from tests.conftest import BASE_URL, CREDENTIAL


class TestCataloguesResource:
    def test_list_schema_version_fields_filters_by_schema_version_id(
        self, mock_transport
    ):
        route = mock_transport.get("/api/db/dataset_schema_version_fields").respond(
            200, json=[]
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            client.catalogues.list_schema_version_fields(
                schema_version_id="dsv-0001"
            )
        request = route.calls[0].request
        assert "schema_version_id=eq.dsv-0001" in str(request.url)
        assert "dataset_schema_version_id" not in str(request.url)

    def test_list_schema_version_fields_omits_filter_when_unset(
        self, mock_transport
    ):
        route = mock_transport.get("/api/db/dataset_schema_version_fields").respond(
            200, json=[]
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read"]) as client:
            client.catalogues.list_schema_version_fields()
        request = route.calls[0].request
        assert "schema_version_id" not in str(request.url)
