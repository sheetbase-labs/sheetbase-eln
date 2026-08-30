"""Shared test fixtures for the Sheetbase Python SDK tests."""
from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import respx

BASE_URL = "https://api.example.com"
CREDENTIAL = "sb_01234567_abcdef0123456789abcdef0123456789abcdef"
SCOPES = ["projects:read", "projects:write", "datasets:read", "datasets:write"]


@pytest.fixture
def base_url() -> str:
    return BASE_URL


@pytest.fixture
def credential() -> str:
    return CREDENTIAL


@pytest.fixture
def scopes() -> list[str]:
    return SCOPES


@pytest.fixture
def token() -> str:
    return "fake-jwt-token"


@pytest.fixture
def mock_transport(token):
    """Creates a respx router that mocks the token exchange endpoint."""
    with respx.mock(base_url=BASE_URL, assert_all_called=False) as router:
        token_route = router.post("/api/token", name="token").respond(
            200, json={"token": token}
        )
        yield router


@pytest.fixture
def project_row() -> dict[str, Any]:
    return {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "workspace_id": "550e8400-e29b-41d4-a716-446655440001",
        "key": "lenti-purification",
        "title": "Lentivector Purification",
        "status": "active",
        "created_at": "2026-01-15T10:30:00Z",
        "updated_at": "2026-01-16T08:00:00Z",
        "archived_at": None,
        "custom_fields": {"protocol": "Protocol A"},
    }


@pytest.fixture
def record_row() -> dict[str, Any]:
    return {
        "id": "660e8400-e29b-41d4-a716-446655440010",
        "workspace_id": "550e8400-e29b-41d4-a716-446655440001",
        "project_id": "550e8400-e29b-41d4-a716-446655440000",
        "folder_id": None,
        "kind": "experiment",
        "identifier": "EXP-2026-0001",
        "title": "Purification Run 1",
        "status": "in-progress",
        "tags": ["lentivector", "purification"],
        "structure_version": 1,
        "metadata_version": 1,
        "created_at": "2026-01-15T10:30:00Z",
        "updated_at": "2026-01-16T08:00:00Z",
        "archived_at": None,
        "deleted_at": None,
        "created_by_user_id": "user-001",
        "updated_by_user_id": None,
        "updated_by_credential_id": None,
        "calculation_input_revision": 0,
        "properties": {"concentration": 1.2e9},
        "locked_at": None,
        "locked_by_revision_id": None,
        "custom_fields": {"cell_line": "HEK293T"},
        "source_notebook_template_version_id": None,
    }


@pytest.fixture
def dataset_row() -> dict[str, Any]:
    return {
        "id": "770e8400-e29b-41d4-a716-446655440020",
        "workspace_id": "550e8400-e29b-41d4-a716-446655440001",
        "schema_version_id": "880e8400-e29b-41d4-a716-446655440030",
        "name": "Purification Data",
        "description": "Lentivector purification runs",
        "lifecycle": "active",
        "revision": 3,
        "created_at": "2026-01-15T10:30:00Z",
        "updated_at": "2026-01-16T08:00:00Z",
        "primary_project_id": "550e8400-e29b-41d4-a716-446655440000",
        "created_by_user_id": "user-001",
        "created_by_credential_id": None,
    }


@pytest.fixture
def dataset_rows_response() -> dict[str, Any]:
    return {
        "datasetId": "770e8400-e29b-41d4-a716-446655440020",
        "datasetRevision": 3,
        "offset": 0,
        "limit": 200,
        "totalCount": 2,
        "hasMore": False,
        "rows": [
            {
                "rowId": "aaa11111-2222-3333-4444-555555555501",
                "revision": 1,
                "values": {
                    "fff00000-0000-0000-0000-000000000001": 1.2e9,
                    "fff00000-0000-0000-0000-000000000002": "HEK293T",
                },
            },
            {
                "rowId": "aaa11111-2222-3333-4444-555555555502",
                "revision": 1,
                "values": {
                    "fff00000-0000-0000-0000-000000000001": 8.5e8,
                    "fff00000-0000-0000-0000-000000000002": "Vero",
                },
            },
        ],
    }


@pytest.fixture
def commit_response() -> dict[str, Any]:
    return {
        "ok": True,
        "datasetId": "770e8400-e29b-41d4-a716-446655440020",
        "datasetRevision": 4,
        "rows": [
            {
                "rowId": "bbb11111-2222-3333-4444-555555555501",
                "revision": 1,
                "operation": "create",
            }
        ],
        "idempotent": False,
    }
