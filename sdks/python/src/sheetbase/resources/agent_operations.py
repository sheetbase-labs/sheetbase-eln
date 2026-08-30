"""Agent operation and workflow resources.

These methods are thin wrappers over the AUTO-04/05 public RPCs. Operation,
plan, budget and provenance payloads stay in their canonical wire shape and
are validated by the server; the SDK does not reproduce policy or workflow
rules.
"""

from __future__ import annotations

from typing import Any, Optional

from sheetbase._http import HttpTransport


class AgentOperationsResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    def list_proposals(
        self, *, params: Optional[dict[str, Any]] = None
    ) -> list[dict[str, Any]]:
        return self._transport.get("/api/db/agent_operation_proposals", params=params)

    def list_proposal_events(
        self, *, params: Optional[dict[str, Any]] = None
    ) -> list[dict[str, Any]]:
        return self._transport.get("/api/db/agent_operation_events", params=params)

    def list_workflows(
        self, *, params: Optional[dict[str, Any]] = None
    ) -> list[dict[str, Any]]:
        return self._transport.get("/api/db/agent_workflows", params=params)

    def list_workflow_steps(
        self, *, params: Optional[dict[str, Any]] = None
    ) -> list[dict[str, Any]]:
        return self._transport.get("/api/db/agent_workflow_steps", params=params)

    def list_workflow_events(
        self, *, params: Optional[dict[str, Any]] = None
    ) -> list[dict[str, Any]]:
        return self._transport.get("/api/db/agent_workflow_events", params=params)

    def propose(
        self,
        *,
        workspace_id: str,
        title: str,
        summary: str,
        operation: dict[str, Any],
        provenance: dict[str, Any],
        idempotency_key: str,
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/propose_agent_operation",
            json_body={
                "p_workspace_id": workspace_id,
                "p_title": title,
                "p_summary": summary,
                "p_operation": operation,
                "p_provenance": provenance,
                "p_idempotency_key": idempotency_key,
            },
        )

    def create_workflow(
        self,
        *,
        workspace_id: str,
        goal: str,
        plan: dict[str, Any],
        budget: dict[str, Any],
        initial_usage: dict[str, Any],
        provenance: dict[str, Any],
        idempotency_key: str,
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/create_agent_workflow",
            json_body={
                "p_workspace_id": workspace_id,
                "p_goal": goal,
                "p_plan": plan,
                "p_budget": budget,
                "p_initial_usage": initial_usage,
                "p_provenance": provenance,
                "p_idempotency_key": idempotency_key,
            },
        )

    def advance_workflow(self, workflow_id: str, expected_revision: int) -> Any:
        return self._transport.post(
            "/api/db/rpc/advance_agent_workflow",
            json_body={
                "p_workflow_id": workflow_id,
                "p_expected_revision": expected_revision,
            },
        )

    def report_workflow_usage(
        self,
        workflow_id: str,
        expected_revision: int,
        *,
        tokens: int,
        cost_microusd: int,
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/report_agent_workflow_usage",
            json_body={
                "p_workflow_id": workflow_id,
                "p_expected_revision": expected_revision,
                "p_tokens": tokens,
                "p_cost_microusd": cost_microusd,
            },
        )

    def cancel_workflow(
        self, workflow_id: str, expected_revision: int, *, reason: str
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/cancel_agent_workflow",
            json_body={
                "p_workflow_id": workflow_id,
                "p_expected_revision": expected_revision,
                "p_reason": reason,
            },
        )
