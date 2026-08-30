"""Webhook subscription, delivery-history and replay resources."""

from __future__ import annotations

from typing import Any, Optional, Sequence

from sheetbase._http import HttpTransport


class WebhooksResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    def list_subscriptions(
        self, *, params: Optional[dict[str, Any]] = None
    ) -> list[dict[str, Any]]:
        return self._transport.get("/api/db/webhook_subscriptions", params=params)

    def list_delivery_rows(
        self, *, params: Optional[dict[str, Any]] = None
    ) -> list[dict[str, Any]]:
        return self._transport.get("/api/db/webhook_deliveries", params=params)

    def create_subscription(
        self,
        *,
        workspace_id: str,
        key: str,
        url: str,
        event_types: Optional[Sequence[str]] = None,
        description: Optional[str] = None,
        max_retries: Optional[int] = None,
        failure_threshold: Optional[int] = None,
        signing_secret: Optional[str] = None,
    ) -> Any:
        body: dict[str, Any] = {
            "p_workspace_id": workspace_id,
            "p_key": key,
            "p_url": url,
        }
        if event_types is not None:
            body["p_event_types"] = list(event_types)
        if description is not None:
            body["p_description"] = description
        if max_retries is not None:
            body["p_max_retries"] = max_retries
        if failure_threshold is not None:
            body["p_failure_threshold"] = failure_threshold
        if signing_secret is not None:
            body["p_signing_secret"] = signing_secret
        return self._transport.post(
            "/api/db/rpc/create_webhook_subscription", json_body=body
        )

    def update_subscription(
        self,
        *,
        workspace_id: str,
        subscription_id: str,
        url: Optional[str] = None,
        event_types: Optional[Sequence[str]] = None,
        description: Optional[str] = None,
        status: Optional[str] = None,
        max_retries: Optional[int] = None,
        failure_threshold: Optional[int] = None,
    ) -> Any:
        body: dict[str, Any] = {
            "p_workspace_id": workspace_id,
            "p_subscription_id": subscription_id,
        }
        if url is not None:
            body["p_url"] = url
        if event_types is not None:
            body["p_event_types"] = list(event_types)
        if description is not None:
            body["p_description"] = description
        if status is not None:
            body["p_status"] = status
        if max_retries is not None:
            body["p_max_retries"] = max_retries
        if failure_threshold is not None:
            body["p_failure_threshold"] = failure_threshold
        return self._transport.post(
            "/api/db/rpc/update_webhook_subscription", json_body=body
        )

    def delete_subscription(self, *, workspace_id: str, subscription_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/delete_webhook_subscription",
            json_body={
                "p_workspace_id": workspace_id,
                "p_subscription_id": subscription_id,
            },
        )

    def rotate_secret(
        self,
        *,
        workspace_id: str,
        subscription_id: str,
        new_secret: Optional[str] = None,
    ) -> Any:
        body: dict[str, Any] = {
            "p_workspace_id": workspace_id,
            "p_subscription_id": subscription_id,
        }
        if new_secret is not None:
            body["p_new_secret"] = new_secret
        return self._transport.post("/api/db/rpc/rotate_webhook_secret", json_body=body)

    def list_deliveries(
        self,
        *,
        workspace_id: str,
        subscription_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Any:
        body: dict[str, Any] = {
            "p_workspace_id": workspace_id,
            "p_limit": limit,
            "p_offset": offset,
        }
        if subscription_id is not None:
            body["p_subscription_id"] = subscription_id
        if status is not None:
            body["p_status"] = status
        return self._transport.post(
            "/api/db/rpc/list_webhook_deliveries", json_body=body
        )

    def replay_delivery(self, *, workspace_id: str, delivery_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/replay_webhook_delivery",
            json_body={
                "p_workspace_id": workspace_id,
                "p_delivery_id": delivery_id,
            },
        )
