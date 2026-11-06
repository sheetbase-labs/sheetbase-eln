"""Verifying outgoing webhook deliveries."""
from __future__ import annotations

import hashlib
import hmac
import json

import pytest

from sheetbase import WebhookSignatureError, parse_webhook, verify_webhook_signature

SECRET = "a" * 64
EVENT = {
    "schemaVersion": "1",
    "eventType": "record.updated",
    "eventId": "evt-1",
    "sequence": 7,
    "workspaceId": "ws",
    "entityUuid": "rec",
    "entityType": "record",
    "operation": "update",
    "recordId": "rec",
    "projectId": None,
    "actorUserId": None,
    "actorCredentialId": "cred",
    "payload": {"title": "Lenti prep"},
    "createdAt": "2026-11-06T09:00:00Z",
}
BODY = json.dumps(EVENT, separators=(",", ":")).encode()


def signed(body: bytes = BODY, secret: str = SECRET) -> str:
    # Same as signPayload in src/lib/webhook-signing.ts.
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_parse_returns_the_event() -> None:
    event = parse_webhook(BODY, {"X-Sheetbase-Signature": signed()}, SECRET)
    assert event["eventId"] == "evt-1"
    assert event["payload"] == {"title": "Lenti prep"}


def test_header_lookup_ignores_case_and_accepts_a_bare_signature() -> None:
    assert parse_webhook(BODY, {"x-sheetbase-signature": signed()}, SECRET)["sequence"] == 7
    assert parse_webhook(BODY.decode(), signed(), SECRET.encode())["sequence"] == 7


@pytest.mark.parametrize(
    "headers",
    [{}, {"X-Sheetbase-Signature": ""}, {"X-Sheetbase-Signature": signed(secret="wrong")}],
)
def test_bad_or_missing_signatures_are_rejected(headers: dict[str, str]) -> None:
    with pytest.raises(WebhookSignatureError):
        parse_webhook(BODY, headers, SECRET)


def test_a_changed_body_is_rejected() -> None:
    tampered = BODY.replace(b"Lenti prep", b"Lenti prop")
    assert not verify_webhook_signature(tampered, SECRET, signed())
    with pytest.raises(WebhookSignatureError):
        parse_webhook(tampered, {"X-Sheetbase-Signature": signed()}, SECRET)


def test_a_signed_non_json_body_is_rejected() -> None:
    with pytest.raises(WebhookSignatureError):
        parse_webhook(b"not json", signed(b"not json"), SECRET)
