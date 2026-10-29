/**
 * API-06 — Webhook event type mapping and stable event schema.
 *
 * Maps internal `change_events` (entity_type + operation) to stable external
 * event names (e.g. `record.created`, `dataset.versioned`,
 * `notebook.submitted`). The external event schema is the contract external
 * systems depend on; internal entity_types may change but the stable names
 * will not.
 *
 * Only a curated subset of change_events is mapped to webhook events. Events
 * not in this map (e.g. `storage_movement`, `folder`) are not
 * delivered to webhooks. This is intentional: the webhook surface is a
 * stable product contract, not a mirror of every internal change.
 *
 * The canonical name/alias record lives in `./event-catalogue` (EVENT-01):
 * several shipped wire names leak table names (`sheet_instance.*`,
 * `sheet_definition.*`, `notebook_template.*`) and stay on the wire for
 * compatibility while the catalogue pins the canonical domain names.
 * `matchesFilter` accepts either form. The emitted strings below are frozen.
 */
import {
  EVENT_CATALOGUE,
  resolveEventAlias,
  type PayloadCondition,
} from './event-catalogue'

interface WireProducer {
  readonly operation: string
  readonly when?: PayloadCondition
  readonly wireName: string
}

/**
 * Producers by entity_type, read from the catalogue so webhooks, SSE and the
 * create dialog share one list. Only entries with a wire name are delivered.
 */
const WIRE_PRODUCERS: ReadonlyMap<string, readonly WireProducer[]> = (() => {
  const byEntity = new Map<string, WireProducer[]>()
  for (const entry of EVENT_CATALOGUE) {
    if (entry.producer === null || entry.wireName === null) continue
    const list = byEntity.get(entry.producer.entityType) ?? []
    list.push({
      operation: entry.producer.operation,
      when: entry.producer.when,
      wireName: entry.wireName,
    })
    byEntity.set(entry.producer.entityType, list)
  }
  return byEntity
})()

/** Wire mappings kept without a producer (see the catalogue notes). */
const DEFENSIVE_WIRE_MAP: Record<string, Record<string, string>> = {
  review_submission: { amend: 'notebook.amended' },
}

/** All known stable event types (for validation and documentation). */
export const STABLE_EVENT_TYPES: readonly string[] = Object.freeze(
  EVENT_CATALOGUE.flatMap((entry) =>
    entry.wireName === null ? [] : [entry.wireName],
  ),
)

function conditionHolds(
  condition: PayloadCondition | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (condition === undefined) return true
  const value = payload[condition.key]
  if (condition.equals !== undefined) return value === condition.equals
  if (condition.notEquals !== undefined) return value !== condition.notEquals
  return true
}

/**
 * Map an internal change_event to a stable external event type.
 * Returns null when the entity_type + operation combination is not in the
 * webhook surface (most internal events are not delivered to webhooks). The
 * payload picks between events that share a pair, such as a sample being
 * received or moved.
 */
export function mapEventType(
  entityType: string,
  operation: string,
  payload: Record<string, unknown> = {},
): string | null {
  const producers = WIRE_PRODUCERS.get(entityType) ?? []
  for (const producer of producers) {
    if (producer.operation === operation && conditionHolds(producer.when, payload))
      return producer.wireName
  }
  if (!Object.hasOwn(DEFENSIVE_WIRE_MAP, entityType)) return null
  return DEFENSIVE_WIRE_MAP[entityType][operation] ?? null
}

/**
 * Check whether a stable event type matches a subscription's event type
 * filter. An empty filter array means "all events". Canonical names and
 * their wire aliases match interchangeably, so a filter written with
 * either form matches deliveries emitted under the other.
 */
export function matchesFilter(
  eventType: string,
  filter: readonly string[],
): boolean {
  if (filter.length === 0) return true
  const canonical = resolveEventAlias(eventType)
  return filter.some((entry) => resolveEventAlias(entry) === canonical)
}

/**
 * Build the stable external event payload from an internal change_event row.
 * This is the JSON body delivered to the webhook endpoint.
 */
export interface ChangeEventInput {
  id: string
  workspaceId: string
  sequence: number
  entityType: string
  entityUuid: string
  operation: string
  recordId: string | null
  projectId: string | null
  actorUserId: string | null
  actorCredentialId: string | null
  clientId: string | null
  payload: Record<string, unknown>
  createdAt: string
}

export interface WebhookEventPayload {
  /** Schema version for the webhook payload format. */
  schemaVersion: '1'
  /** Stable event type (e.g. record.created, dataset.versioned). */
  eventType: string
  /** Globally unique event id (the change_event id). */
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
  /** Lightweight event payload (never the full source of truth). */
  payload: Record<string, unknown>
  /** Event creation timestamp (ISO 8601). */
  createdAt: string
}

export function buildEventPayload(
  event: ChangeEventInput,
  eventType: string,
): WebhookEventPayload {
  return {
    schemaVersion: '1',
    eventType,
    eventId: event.id,
    sequence: event.sequence,
    workspaceId: event.workspaceId,
    entityUuid: event.entityUuid,
    entityType: event.entityType,
    operation: event.operation,
    recordId: event.recordId,
    projectId: event.projectId,
    actorUserId: event.actorUserId,
    actorCredentialId: event.actorCredentialId,
    payload: event.payload,
    createdAt: event.createdAt,
  }
}
