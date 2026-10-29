"""Domain event vocabulary and webhook delivery helpers.

Hand-mirrored from the canonical catalogue in ``src/lib/event-catalogue.ts``
(EVENT-01). The catalogue is authoritative; the drift suite pins
``EVENT_NAMES`` equal to the catalogue's canonical names. Consumers subscribe
with canonical names — wire aliases (shipped table-name leaks such as
``sheet_instance.created``) keep working through ``resolve_event_alias``,
but new code should use the canonical form.

``verify_webhook_signature`` lets integration endpoints authenticate
deliveries with the subscription's signing secret, comparing against the
``X-Sheetbase-Signature: sha256=<hex>`` header. Deduplicate on ``event_id``
— retries and replays reuse the same id and must not duplicate downstream
effects.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any, Optional, TypedDict

EVENT_NAMES: tuple[str, ...] = (
    "project.created",
    "project.updated",
    "project.deleted",
    "project.archived",
    "project.restored",
    "record.created",
    "record.updated",
    "record.moved",
    "record.deleted",
    "record.archived",
    "record.restored",
    "record.amended",
    "dataset.created",
    "dataset.updated",
    "dataset.archived",
    "dataset.restored",
    "dataset.versioned",
    "sheet.created",
    "sheet.updated",
    "sheet.archived",
    "sheet.restored",
    "sheet.definition.created",
    "sheet.definition.updated",
    "sheet.definition.versioned",
    "notebook.submitted",
    "notebook.amended",
    "review.decided",
    "record.signed",
    "notebook.template.created",
    "notebook.template.updated",
    "notebook.template.versioned",
    "sample.received",
    "sample.moved",
    "sample.consumed",
    "sample.released",
    "sample.quarantined",
    "sample.disposed",
    "sample.hold_exceeded",
    "booking.created",
    "booking.updated",
    "booking.cancelled",
    "import.created",
    "import.committed",
    "import.failed",
    "approval.requested",
    "approval.approved",
    "approval.returned",
    "approval.withdrawn",
    "storage.placed",
    "storage.moved",
    "storage.removed",
    "instrument.run.created",
    "instrument.run.completed",
    "instrument.run.failed",
    "pipeline.created",
    "pipeline.updated",
    "pipeline.deleted",
    "pipeline.version.created",
    "pipeline.version.updated",
    "pipeline.run.created",
    "pipeline.run.updated",
    "pipeline.schedule.created",
    "pipeline.schedule.updated",
    "workspace.invitation.created",
    "workspace.invitation.updated",
    "workspace.invitation.deleted",
    "workspace.settings.created",
    "workspace.settings.updated",
    "project.access.granted",
    "project.access.updated",
    "project.access.revoked",
    "workspace.credential.created",
    "workspace.credential.revoked",
)

#: Shipped wire aliases (table-name leaks kept for compatibility) mapped to
#: their canonical names. New subscriptions should use the canonical form.
EVENT_ALIASES: dict[str, str] = {
    "sheet_instance.created": "sheet.created",
    "sheet_instance.updated": "sheet.updated",
    "sheet_instance.archived": "sheet.archived",
    "sheet_instance.restored": "sheet.restored",
    "sheet_definition.created": "sheet.definition.created",
    "sheet_definition.updated": "sheet.definition.updated",
    "sheet_definition.versioned": "sheet.definition.versioned",
    "notebook_template.created": "notebook.template.created",
    "notebook_template.updated": "notebook.template.updated",
    "notebook_template.versioned": "notebook.template.versioned",
    "notebook.signed": "record.signed",
}


def resolve_event_alias(name: str) -> str:
    """Resolve a wire alias (or canonical name) to its canonical event name."""
    return EVENT_ALIASES.get(name, name)


def is_event_name(value: str) -> bool:
    """True when the value is a known canonical event name."""
    return value in EVENT_NAMES


class WebhookEventPayload(TypedDict):
    """JSON body delivered to a webhook endpoint.

    Mirrors the server's ``WebhookEventPayload``
    (``src/lib/webhook-events.ts``): ``event_id`` is the idempotency key,
    ``sequence`` orders events within a workspace, and ``payload`` is a
    lightweight summary — never the source of truth.

    Every key is required: the server always emits all of them (context and
    actor fields arrive as ``None`` when there is no context, never absent),
    so no field uses ``NotRequired``. Nullable-but-present fields are typed
    ``Optional[...]``.
    """

    schemaVersion: str
    eventType: str
    eventId: str
    sequence: int
    workspaceId: str
    entityUuid: str
    entityType: str
    operation: str
    recordId: Optional[str]
    projectId: Optional[str]
    actorUserId: Optional[str]
    actorCredentialId: Optional[str]
    payload: dict[str, Any]
    createdAt: str


def verify_webhook_signature(
    body: bytes | str, secret: bytes | str, signature: str
) -> bool:
    """Verify a webhook delivery against the ``X-Sheetbase-Signature`` header.

    Recomputes ``sha256=<hex>`` HMAC-SHA256 over the raw JSON body (per
    ``src/lib/webhook-signing.ts``) and compares with
    :func:`hmac.compare_digest`. Returns True only on a full match.

    ``body`` may be the raw request bytes (hashed as-is) or ``str`` (encoded
    once as UTF-8 — prefer passing bytes when the framework gives them, to
    avoid double-encoding drift). ``secret`` likewise accepts bytes or str.
    """
    body_bytes = body if isinstance(body, bytes) else body.encode("utf-8")
    key = secret if isinstance(secret, bytes) else secret.encode("utf-8")
    expected = "sha256=" + hmac.new(key, body_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
