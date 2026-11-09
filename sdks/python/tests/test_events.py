"""EVENT-03 — event vocabulary and webhook verification tests."""

import hashlib
import hmac
import json
from pathlib import Path

from sheetbase.resources.events import (
    EVENT_ALIASES,
    EVENT_NAMES,
    WebhookEventPayload,
    is_event_name,
    resolve_event_alias,
    verify_webhook_signature,
)

REPO_ROOT = Path(__file__).resolve().parents[3]


def _catalogue() -> dict:
    # Written from the event catalogue by `pnpm generate`
    # (scripts/generate-public-openapi.ts), with the contract.
    path = REPO_ROOT / "docs" / "api" / "openapi" / "events.json"
    return json.loads(path.read_text())


def test_vocabulary_matches_catalogue() -> None:
    assert list(EVENT_NAMES) == _catalogue()["names"]
    assert len(set(EVENT_NAMES)) == len(EVENT_NAMES)


def test_aliases_match_catalogue_wire_names() -> None:
    assert EVENT_ALIASES == _catalogue()["aliases"]


def test_alias_resolution() -> None:
    assert resolve_event_alias("sheet_instance.updated") == "sheet.updated"
    assert (
        resolve_event_alias("notebook_template.versioned")
        == "notebook.template.versioned"
    )
    assert resolve_event_alias("record.created") == "record.created"
    assert is_event_name("dataset.versioned")
    assert not is_event_name("sheet_instance.created")


def test_verify_accepts_matching_signature() -> None:
    body = '{"eventType": "record.created", "eventId": "e1"}'
    secret = "test-signing-secret"
    signature = "sha256=" + hmac.new(
        secret.encode(), body.encode(), hashlib.sha256
    ).hexdigest()
    assert verify_webhook_signature(body, secret, signature)


def test_verify_rejects_mismatches() -> None:
    body = '{"eventType": "record.created", "eventId": "e1"}'
    secret = "test-signing-secret"
    signature = "sha256=" + hmac.new(
        secret.encode(), body.encode(), hashlib.sha256
    ).hexdigest()
    assert not verify_webhook_signature(body + " ", secret, signature)
    assert not verify_webhook_signature(body, "wrong-secret", signature)
    assert not verify_webhook_signature(body, secret, "sha256=deadbeef")


def test_verify_accepts_bytes_body() -> None:
    body = b'{"eventType": "record.created", "eventId": "e1"}'
    secret = "test-signing-secret"
    signature = "sha256=" + hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    assert verify_webhook_signature(body, secret, signature)
    assert not verify_webhook_signature(body + b" ", secret, signature)


def test_verify_str_and_bytes_bodies_agree() -> None:
    text = '{"eventType": "record.created", "eventId": "e1", "n": "caf\u00e9"}'
    raw = text.encode("utf-8")
    secret = "test-signing-secret"
    signature = "sha256=" + hmac.new(
        secret.encode(), raw, hashlib.sha256
    ).hexdigest()
    assert verify_webhook_signature(text, secret, signature)
    assert verify_webhook_signature(raw, secret, signature)
    assert verify_webhook_signature(raw, secret.encode(), signature)
    assert verify_webhook_signature(text, secret.encode(), signature)


def test_payload_keys_are_required() -> None:
    assert WebhookEventPayload.__optional_keys__ == frozenset()
    assert WebhookEventPayload.__required_keys__ == frozenset(
        {
            "schemaVersion",
            "eventType",
            "eventId",
            "sequence",
            "workspaceId",
            "entityUuid",
            "entityType",
            "operation",
            "recordId",
            "projectId",
            "actorUserId",
            "actorCredentialId",
            "payload",
            "createdAt",
        }
    )
