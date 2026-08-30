"""Shared public-contract semantics and agent workflow request coverage."""

import json

from sheetbase import (
    API_VERSION,
    ERROR_CATEGORIES,
    TOKEN_ERROR_CODES,
    AsyncSheetbaseClient,
    SheetbaseClient,
)
from tests.conftest import BASE_URL, CREDENTIAL


def test_exact_api_version_and_error_vocabularies():
    client = SheetbaseClient(BASE_URL, CREDENTIAL, [])
    assert API_VERSION == "0.1.0"
    assert client.api_version == API_VERSION
    assert TOKEN_ERROR_CODES == (
        "invalid_request",
        "invalid_scope",
        "invalid_credential",
        "revoked",
        "expired",
        "insufficient_scope",
        "rate_limited",
        "server_error",
    )
    assert ERROR_CATEGORIES == (
        "validation_error",
        "not_found",
        "permission_denied",
        "conflict",
        "stale_version",
        "missing_link",
        "invalid_transition",
        "invalid_properties",
        "template_not_instantiable",
        "unauthenticated",
        "rate_limited",
        "service_unavailable",
        "server_error",
    )
    client.close()


def test_table_head_parses_count_and_request_metadata(mock_transport):
    mock_transport.head("/api/db/records").respond(
        200,
        headers={"Content-Range": "0-24/143", "X-Request-Id": "request-1"},
    )
    with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
        result = client.table_head(
            "records",
            params={"project_id": "eq.project-1"},
            headers={"Prefer": "count=exact"},
        )

    assert result.status_code == 200
    assert result.content_range == "0-24/143"
    assert result.total_count == 143
    assert result.request_id == "request-1"
    request = mock_transport.calls.last.request
    assert request.method == "HEAD"
    assert request.url.params["project_id"] == "eq.project-1"
    assert request.headers["Prefer"] == "count=exact"


def test_agent_proposal_and_workflow_keep_canonical_json(mock_transport):
    proposal_route = mock_transport.post("/api/db/rpc/propose_agent_operation").respond(
        200, json={}
    )
    workflow_route = mock_transport.post("/api/db/rpc/create_agent_workflow").respond(
        200, json={}
    )
    provenance = {
        "agentId": "agent-1",
        "tool": {"name": "sheetbase.dataset_schema.draft"},
        "model": {"provider": "example", "name": "model"},
        "invocationId": "invocation-1",
    }
    operation = {
        "kind": "dataset_rows.commit",
        "datasetId": "dataset-1",
        "expectedRevision": 2,
        "rows": [{"operation": "create", "rowId": "row-1", "values": {}}],
    }
    plan = {
        "formatVersion": 1,
        "steps": [
            {
                "key": "commit-a",
                "title": "Commit A",
                "summary": "Commit first batch",
                "tool": "sheetbase.dataset_rows.commit",
                "operation": operation,
                "inputReferences": [],
            },
            {
                "key": "commit-b",
                "title": "Commit B",
                "summary": "Commit second batch",
                "tool": "sheetbase.dataset_rows.commit",
                "operation": operation,
                "inputReferences": [],
            },
        ],
    }

    with SheetbaseClient(BASE_URL, CREDENTIAL, ["agent_operations:write"]) as client:
        client.agent_operations.propose(
            workspace_id="workspace-1",
            title="Commit rows",
            summary="Commit one bounded row batch",
            operation=operation,
            provenance=provenance,
            idempotency_key="proposal-1",
        )
        client.agent_operations.create_workflow(
            workspace_id="workspace-1",
            goal="Commit both batches",
            plan=plan,
            budget={"maxOperations": 2, "maxTokens": 100, "maxCostMicrousd": 500},
            initial_usage={"tokens": 0, "costMicrousd": 0},
            provenance=provenance,
            idempotency_key="workflow-1",
        )

    assert json.loads(proposal_route.calls.last.request.content) == {
        "p_workspace_id": "workspace-1",
        "p_title": "Commit rows",
        "p_summary": "Commit one bounded row batch",
        "p_operation": operation,
        "p_provenance": provenance,
        "p_idempotency_key": "proposal-1",
    }
    assert json.loads(workflow_route.calls.last.request.content) == {
        "p_workspace_id": "workspace-1",
        "p_goal": "Commit both batches",
        "p_plan": plan,
        "p_budget": {
            "maxOperations": 2,
            "maxTokens": 100,
            "maxCostMicrousd": 500,
        },
        "p_initial_usage": {"tokens": 0, "costMicrousd": 0},
        "p_provenance": provenance,
        "p_idempotency_key": "workflow-1",
    }


def test_webhook_optionals_are_omitted_and_pagination_is_preserved(mock_transport):
    create_route = mock_transport.post(
        "/api/db/rpc/create_webhook_subscription"
    ).respond(200, json={})
    deliveries_route = mock_transport.post(
        "/api/db/rpc/list_webhook_deliveries"
    ).respond(200, json={})

    with SheetbaseClient(BASE_URL, CREDENTIAL, ["webhooks:write"]) as client:
        client.webhooks.create_subscription(
            workspace_id="workspace-1",
            key="analysis-complete",
            url="https://integration.example/hook",
        )
        client.webhooks.list_deliveries(
            workspace_id="workspace-1",
            subscription_id="subscription-1",
            status="failed",
            limit=25,
            offset=50,
        )

    assert json.loads(create_route.calls.last.request.content) == {
        "p_workspace_id": "workspace-1",
        "p_key": "analysis-complete",
        "p_url": "https://integration.example/hook",
    }
    assert json.loads(deliveries_route.calls.last.request.content) == {
        "p_workspace_id": "workspace-1",
        "p_subscription_id": "subscription-1",
        "p_status": "failed",
        "p_limit": 25,
        "p_offset": 50,
    }


async def test_async_client_exposes_auto_resources(mock_transport):
    proposal_route = mock_transport.post("/api/db/rpc/propose_agent_operation").respond(
        200, json={}
    )
    delivery_route = mock_transport.post("/api/db/rpc/replay_webhook_delivery").respond(
        200, json={}
    )

    async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, []) as client:
        await client.agent_operations.propose(
            workspace_id="workspace-1",
            title="Commit rows",
            summary="Commit one bounded row batch",
            operation={"kind": "dataset_rows.commit"},
            provenance={"agentId": "agent-1"},
            idempotency_key="proposal-1",
        )
        await client.webhooks.replay_delivery(
            workspace_id="workspace-1", delivery_id="delivery-1"
        )

    assert (
        json.loads(proposal_route.calls.last.request.content)["p_idempotency_key"]
        == "proposal-1"
    )
    assert json.loads(delivery_route.calls.last.request.content) == {
        "p_workspace_id": "workspace-1",
        "p_delivery_id": "delivery-1",
    }
