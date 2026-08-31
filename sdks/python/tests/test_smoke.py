"""SDK-03 end-to-end smoke test.

Exercises the full critical path against a mock transport, exactly as an
integrator would drive the package standalone: token exchange → query
dataset rows → commit with an idempotency key (including the stale-version
retry), asserting the wire contract at every step.
"""

import json
import uuid

from sheetbase import API_VERSION, AsyncSheetbaseClient, SheetbaseClient
from tests.conftest import BASE_URL, CREDENTIAL

DATASET_ID = "770e8400-e29b-41d4-a716-446655440020"

DATASET_ROWS_RESPONSE = {
    "datasetId": DATASET_ID,
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

COMMIT_RESPONSE = {
    "ok": True,
    "datasetId": DATASET_ID,
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

DATASET_ROW = {
    "id": DATASET_ID,
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

ROWS = [
    {
        "operation": "create",
        "rowId": str(uuid.uuid4()),
        "values": {"fff00000-0000-0000-0000-000000000001": 9.9e8},
    }
]


def test_smoke_token_exchange_query_and_idempotent_commit(mock_transport):
    mock_transport.post("/api/db/rpc/query_dataset_rows").respond(
        200, json=DATASET_ROWS_RESPONSE
    )
    commit_route = mock_transport.post(
        "/api/db/rpc/commit_dataset_row_batch"
    ).respond(200, json=COMMIT_RESPONSE)

    with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read", "datasets:write"]) as client:
        # 1. The SDK knows the exact contract version it targets.
        assert client.api_version == API_VERSION == "0.1.0"

        # 2. Query rows through the typed resource.
        page = client.datasets.query_rows(dataset_id=DATASET_ID)
        assert page.total_count == 2
        assert page.rows[0].values["fff00000-0000-0000-0000-000000000002"] == "HEK293T"

        # 3. Commit with an explicit idempotency key.
        result = client.datasets.commit_rows(
            dataset_id=DATASET_ID,
            expected_revision=3,
            rows=ROWS,
            idempotency_key="smoke-commit-1",
        )
        assert result.ok is True
        assert result.dataset_revision == 4

    token_calls = [
        call for call in mock_transport.calls if call.request.url.path == "/api/token"
    ]
    assert len(token_calls) == 1

    query_request = mock_transport.calls[1].request
    assert query_request.url.path == "/api/db/rpc/query_dataset_rows"
    assert query_request.headers["Authorization"].startswith("Bearer ")
    assert json.loads(query_request.content) == {
        "p_dataset_id": DATASET_ID,
        "p_limit": 200,
        "p_offset": 0,
    }

    commit_request = commit_route.calls.last.request
    assert commit_request.url.path == "/api/db/rpc/commit_dataset_row_batch"
    assert json.loads(commit_request.content) == {
        "p_dataset_id": DATASET_ID,
        "p_expected_dataset_revision": 3,
        "p_rows": ROWS,
        "p_idempotency_key": "smoke-commit-1",
    }


def test_smoke_stale_commit_retries_with_fresh_key(mock_transport):
    import httpx

    mock_transport.get("/api/db/datasets").respond(200, json=[DATASET_ROW])
    commit_route = mock_transport.post("/api/db/rpc/commit_dataset_row_batch")
    commit_route.mock(
        side_effect=[
            httpx.Response(
                409,
                json={
                    "error": {
                        "category": "stale_version",
                        "message": "revision mismatch",
                        "request_id": "request-stale-1",
                    }
                },
            ),
            httpx.Response(200, json=COMMIT_RESPONSE),
        ]
    )

    with SheetbaseClient(BASE_URL, CREDENTIAL, ["datasets:read", "datasets:write"]) as client:
        result = client.datasets.commit_rows(
            dataset_id=DATASET_ID,
            expected_revision=99,
            rows=ROWS,
            idempotency_key="smoke-stale-1",
        )
        assert result.ok is True

    assert commit_route.call_count == 2
    first_body = json.loads(commit_route.calls[0].request.content)
    second_body = json.loads(commit_route.calls[1].request.content)
    assert first_body["p_idempotency_key"] == "smoke-stale-1"
    assert second_body["p_idempotency_key"] != first_body["p_idempotency_key"]
    # The retry re-read the authoritative revision from the server.
    assert second_body["p_expected_dataset_revision"] == 3


async def test_smoke_async_client_drives_the_same_critical_path(mock_transport):
    mock_transport.post("/api/db/rpc/query_dataset_rows").respond(
        200, json=DATASET_ROWS_RESPONSE
    )
    commit_route = mock_transport.post(
        "/api/db/rpc/commit_dataset_row_batch"
    ).respond(200, json=COMMIT_RESPONSE)

    async with AsyncSheetbaseClient(
        BASE_URL, CREDENTIAL, ["datasets:read", "datasets:write"]
    ) as client:
        page = await client.datasets.query_rows(dataset_id=DATASET_ID)
        assert page.total_count == 2
        assert page.rows[0].values  # rows parsed into typed containers
        result = await client.datasets.commit_rows(
            dataset_id=DATASET_ID,
            expected_revision=3,
            rows=ROWS,
            idempotency_key="smoke-async-1",
        )
        assert result.dataset_revision == 4

    body = json.loads(commit_route.calls.last.request.content)
    assert body["p_idempotency_key"] == "smoke-async-1"
