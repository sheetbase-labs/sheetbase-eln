"""Tests for the Reports resource."""
from sheetbase import AsyncSheetbaseClient, SheetbaseClient

from tests.conftest import BASE_URL, CREDENTIAL

GENERATION = "880e8400-e29b-41d4-a716-446655440030"


def test_download_asks_for_the_format(mock_transport):
    route = mock_transport.get(f"/api/export/report-generation/{GENERATION}").respond(
        200, content=b"%PDF-"
    )
    with SheetbaseClient(BASE_URL, CREDENTIAL, ["lab:read"]) as client:
        assert client.reports.download(GENERATION, format="pdf") == b"%PDF-"
    assert "format=pdf" in str(route.calls[0].request.url)


async def test_async_download_defaults_to_word(mock_transport):
    route = mock_transport.get(f"/api/export/report-generation/{GENERATION}").respond(
        200, content=b"PK"
    )
    async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["lab:read"]) as client:
        assert await client.reports.download(GENERATION) == b"PK"
    assert "format=docx" in str(route.calls[0].request.url)
