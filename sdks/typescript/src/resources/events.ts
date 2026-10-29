/**
 * Domain event vocabulary and webhook delivery helpers.
 *
 * Hand-mirrored from the canonical catalogue in
 * `src/lib/event-catalogue.ts` (EVENT-01). The catalogue is authoritative;
 * the drift suite pins `EVENT_NAMES` equal to the catalogue's canonical
 * names. Consumers subscribe with canonical names — wire aliases (shipped
 * table-name leaks such as `sheet_instance.created`) keep working through
 * `resolveEventAlias`, but new code should use the canonical form.
 *
 * `verifyWebhookSignature` is isomorphic (Web Crypto only): integration
 * endpoints authenticate deliveries with the subscription's signing secret,
 * comparing against the `X-Sheetbase-Signature: sha256=<hex>` header.
 * Deduplicate on `eventId` — retries and replays reuse the same id and must
 * not duplicate downstream effects.
 */

export const EVENT_NAMES = [
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
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/**
 * Shipped wire aliases (table-name leaks kept for compatibility) mapped to
 * their canonical names. New subscriptions should use the canonical form.
 */
export const EVENT_ALIASES: Record<string, EventName> = {
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
};

/** Resolve a wire alias (or canonical name) to its canonical event name. */
export function resolveEventAlias(name: string): string {
  return EVENT_ALIASES[name] ?? name;
}

/** True when the value is a known canonical event name. */
export function isEventName(value: string): value is EventName {
  return (EVENT_NAMES as readonly string[]).includes(value);
}

/**
 * The JSON body delivered to a webhook endpoint. Mirrors the server's
 * `WebhookEventPayload` (`src/lib/webhook-events.ts`): `eventId` is the
 * idempotency key, `sequence` orders events within a workspace, and
 * `payload` is a lightweight summary — never the source of truth.
 */
export interface WebhookEventPayload {
  schemaVersion: "1";
  /** Stable event type as emitted on the wire (canonical or alias). */
  eventType: string;
  /** Globally unique event id (the `change_events` id). */
  eventId: string;
  /** Per-workspace sequence number for ordering. */
  sequence: number;
  /** Workspace the event belongs to. */
  workspaceId: string;
  /** Entity uuid the event is about. */
  entityUuid: string;
  /** Internal entity type for diagnostic purposes. */
  entityType: string;
  /** Internal operation for diagnostic purposes. */
  operation: string;
  /** Record context when the event is record-scoped. */
  recordId: string | null;
  /** Project context when the event is project-scoped. */
  projectId: string | null;
  /** Actor attribution. */
  actorUserId: string | null;
  actorCredentialId: string | null;
  /** Lightweight event summary (never the full source of truth). */
  payload: Record<string, unknown>;
  /** Event creation timestamp (ISO 8601). */
  createdAt: string;
}

/**
 * Verify a webhook delivery against the `X-Sheetbase-Signature` header
 * (`sha256=<hex>` HMAC-SHA256 over the raw JSON body, per
 * `src/lib/webhook-signing.ts`). Returns true only on a full match.
 */
export async function verifyWebhookSignature(
  body: string,
  secret: string,
  signature: string,
): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "Web Crypto (globalThis.crypto.subtle) is required to verify webhook signatures.",
    );
  }
  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(mac))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const expected = `sha256=${hex}`;
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
