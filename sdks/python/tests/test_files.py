"""Tests for the Files resource."""
import hashlib

import pytest

from sheetbase import AsyncSheetbaseClient, SheetbaseClient

from tests.conftest import BASE_URL, CREDENTIAL

PROJECT = "550e8400-e29b-41d4-a716-446655440000"
FILE = "770e8400-e29b-41d4-a716-446655440020"
SLOT = {"fileRecordId": FILE, "uploadUrl": f"/api/files/{FILE}/upload", "maxBytes": 100}
STORED = {"fileRecordId": FILE, "byteSize": "5", "checksum": "x", "status": "active"}


def test_upload_authorises_then_sends_the_bytes(mock_transport):
    authorise = mock_transport.post("/api/files/upload-authorize").respond(201, json=SLOT)
    send = mock_transport.put(f"/api/files/{FILE}/upload").respond(200, json=STORED)
    with SheetbaseClient(BASE_URL, CREDENTIAL, ["files:write"]) as client:
        result = client.files.upload(PROJECT, b"hello", name="gel.txt")
    body = authorise.calls[0].request.content
    assert hashlib.sha256(b"hello").hexdigest().encode() in body
    assert b'"mediaType":"text/plain"' in body.replace(b" ", b"")
    assert send.calls[0].request.content == b"hello"
    assert result["fileRecordId"] == FILE
    assert result["status"] == "active"


def test_upload_from_a_path_uses_the_file_name(mock_transport, tmp_path):
    path = tmp_path / "gel.csv"
    path.write_bytes(b"a,b\n1,2\n")
    authorise = mock_transport.post("/api/files/upload-authorize").respond(201, json=SLOT)
    mock_transport.put(f"/api/files/{FILE}/upload").respond(200, json=STORED)
    with SheetbaseClient(BASE_URL, CREDENTIAL, ["files:write"]) as client:
        client.files.upload(PROJECT, path)
    assert b"gel.csv" in authorise.calls[0].request.content


def test_upload_bytes_needs_a_name():
    with SheetbaseClient(BASE_URL, CREDENTIAL, ["files:write"]) as client:
        with pytest.raises(ValueError):
            client.files.upload(PROJECT, b"hello")


def test_upload_version_and_download(mock_transport):
    version = mock_transport.put(f"/api/files/{FILE}/version").respond(
        200, json={"fileRecordId": FILE, "version": 2}
    )
    download = mock_transport.get(f"/api/files/{FILE}/download").respond(200, content=b"bytes")
    with SheetbaseClient(BASE_URL, CREDENTIAL, ["files:write", "files:read"]) as client:
        assert client.files.upload_version(FILE, b"v2", name="gel.png")["version"] == 2
        assert client.files.download(FILE, version=1) == b"bytes"
    assert version.calls[0].request.headers["content-type"] == "image/png"
    assert "version=1" in str(download.calls[0].request.url)


async def test_async_upload_and_download(mock_transport):
    mock_transport.post("/api/files/upload-authorize").respond(201, json=SLOT)
    mock_transport.put(f"/api/files/{FILE}/upload").respond(200, json=STORED)
    mock_transport.get(f"/api/files/{FILE}/download").respond(200, content=b"bytes")
    async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["files:write", "files:read"]) as client:
        assert (await client.files.upload(PROJECT, b"hello", name="a.txt"))["status"] == "active"
        assert await client.files.download(FILE) == b"bytes"
