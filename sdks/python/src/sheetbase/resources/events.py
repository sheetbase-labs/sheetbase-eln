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
import json
from collections.abc import Mapping
from typing import Any, Optional, TypedDict, cast

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
    "order.priced",
    "order.price_removed",
    "instrument.rate_set",
    "instrument.rate_removed",
    "report.schedule.created",
    "report.schedule.updated",
    "report.schedule.deleted",
    "validation.run_completed",
    "agent.policy.changed",
    "agent.action.requested",
    "agent.action.decided",
    "agent.action.completed",
    "ai.eval.completed",
    "watcher.finding.created",
    "member.provisioned",
    "member.directory_updated",
    "member.deprovisioned",
    "member.reactivated",
    "workspace.scim_group.created",
    "workspace.scim_group.updated",
    "workspace.scim_group.deleted",
    "workspace.scim_token.created",
    "workspace.scim_token.revoked",
    "signature.timestamped",
    "signature.timestamp_failed",
    "workspace.timestamping.updated",
    "storage.placed",
    "storage.moved",
    "storage.removed",
    "storage.alarm.raised",
    "storage.alarm.cleared",
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
    "member.work_handed_over",
    "member.absence_set",
    "member.absence_cancelled",
    "workspace.group_role.mapped",
    "workspace.group_role.removed",
    "workspace.group_role.adopted",
    "member.role_changed_by_groups",
    "member.passkey_added",
    "member.passkey_removed",
    # Lab features: stock, shipping, requests, holds, workflows.
    "reagent.order.requested",
    "reagent.order.placed",
    "reagent.order.received",
    "reagent.order.cancelled",
    "stocktake.completed",
    "shipment.sent",
    "shipment.in_transit",
    "shipment.received",
    "shipment.cancelled",
    "request.submitted",
    "request.decided",
    "legal_hold.created",
    "legal_hold.released",
    "retention.applied",
    "sample.workflow.advanced",
    "sample.workflow.enrolled",
    "sample.workflow.left",
    "incident.reported",
    "registry.entry.created",
    "instrument.reading.out_of_limits",
    "instrument.reading.back_in_range",
    "record.assigned",
    "step.completed",
    "step.reopened",
    "step.result_added",
    "experiment.series_member_added",
    "experiment.series_member_removed",
    "plate_run.created",
    "plate_run.analysed",
    "plate_run.archived",
    "plate_worklist.created",
    "plate_worklist.completed",
    "experiment.part_created",
    "experiment.part_opened",
    "experiment.part_completed",
    "experiment.part_reopened",
    "instrument.run.converted",
    "qc.violation",
    "qc.back_in_control",
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


SIGNATURE_HEADER = "X-Sheetbase-Signature"
EVENT_ID_HEADER = "X-Sheetbase-Event-Id"


class WebhookSignatureError(Exception):
    """A webhook delivery is unsigned, wrongly signed or not valid JSON."""


def _header(headers: Mapping[str, str], name: str) -> Optional[str]:
    wanted = name.lower()
    for key, value in headers.items():
        if key.lower() == wanted:
            return value
    return None


def parse_webhook(
    body: bytes | str,
    headers: Mapping[str, str] | str,
    secret: bytes | str,
) -> WebhookEventPayload:
    """Verify a webhook delivery and return its event.

    Pass the raw request body, the request headers (any mapping; the lookup
    ignores case) or the ``X-Sheetbase-Signature`` value itself, and the
    subscription's signing secret. Raises :class:`WebhookSignatureError` when
    the signature is missing or wrong, so an endpoint can answer 401::

        @app.post("/sheetbase")
        async def hook(request: Request):
            try:
                event = parse_webhook(await request.body(), request.headers, SECRET)
            except WebhookSignatureError:
                return Response(status_code=401)
            if already_seen(event["eventId"]):   # retries reuse the id
                return Response(status_code=200)
            ...
    """
    signature = headers if isinstance(headers, str) else _header(headers, SIGNATURE_HEADER)
    if not signature:
        raise WebhookSignatureError("The request has no X-Sheetbase-Signature header.")
    if not verify_webhook_signature(body, secret, signature):
        raise WebhookSignatureError("The signature doesn't match this secret.")
    try:
        event = json.loads(body)
    except ValueError:
        raise WebhookSignatureError("The request body is not JSON.") from None
    if not isinstance(event, dict):
        raise WebhookSignatureError("The request body is not a webhook event.")
    return cast(WebhookEventPayload, event)
