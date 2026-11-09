/**
 * Domain event vocabulary and webhook delivery helpers.
 *
 * `EVENT_NAMES` and `EVENT_ALIASES` are generated from the canonical
 * catalogue in `src/lib/event-catalogue.ts` (EVENT-01) into
 * `event-names.gen.ts` by `pnpm generate`, so they cannot drift. Consumers
 * subscribe with canonical names — wire aliases (shipped
 * table-name leaks such as `sheet_instance.created`) keep working through
 * `resolveEventAlias`, but new code should use the canonical form.
 *
 * `verifyWebhookSignature` is isomorphic (Web Crypto only): integration
 * endpoints authenticate deliveries with the subscription's signing secret,
 * comparing against the `X-Sheetbase-Signature: sha256=<hex>` header.
 * Deduplicate on `eventId` — retries and replays reuse the same id and must
 * not duplicate downstream effects.
 */

import { EVENT_ALIASES, EVENT_NAMES } from './event-names.gen.js'
import type { EventName } from './event-names.gen.js'

export { EVENT_ALIASES, EVENT_NAMES }
export type { EventName }

/** Resolve a wire alias (or canonical name) to its canonical event name. */
export function resolveEventAlias(name: string): string {
  return EVENT_ALIASES[name] ?? name
}

/** True when the value is a known canonical event name. */
export function isEventName(value: string): value is EventName {
  return (EVENT_NAMES as readonly string[]).includes(value)
}

/**
 * The JSON body delivered to a webhook endpoint. Mirrors the server's
 * `WebhookEventPayload` (`src/lib/webhook-events.ts`): `eventId` is the
 * idempotency key, `sequence` orders events within a workspace, and
 * `payload` is a lightweight summary — never the source of truth.
 */
export interface WebhookEventPayload {
  schemaVersion: '1'
  /** Stable event type as emitted on the wire (canonical or alias). */
  eventType: string
  /** Globally unique event id (the `change_events` id). */
  eventId: string
  /** Per-workspace sequence number for ordering. */
  sequence: number
  /** Workspace the event belongs to. */
  workspaceId: string
  /** Entity uuid the event is about. */
  entityUuid: string
  /** Internal entity type for diagnostic purposes. */
  entityType: string
  /** Internal operation for diagnostic purposes. */
  operation: string
  /** Record context when the event is record-scoped. */
  recordId: string | null
  /** Project context when the event is project-scoped. */
  projectId: string | null
  /** Actor attribution. */
  actorUserId: string | null
  actorCredentialId: string | null
  /** Lightweight event summary (never the full source of truth). */
  payload: Record<string, unknown>
  /** Event creation timestamp (ISO 8601). */
  createdAt: string
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
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error(
      'Web Crypto (globalThis.crypto.subtle) is required to verify webhook signatures.',
    )
  }
  const encoder = new TextEncoder()
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await subtle.sign('HMAC', key, encoder.encode(body))
  const hex = Array.from(new Uint8Array(mac))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  const expected = `sha256=${hex}`
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}
