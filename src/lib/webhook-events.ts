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
 * not in this map (e.g. `storage_movement`, `calendar_booking`) are not
 * delivered to webhooks. This is intentional: the webhook surface is a
 * stable product contract, not a mirror of every internal change.
 *
 * The canonical name/alias record lives in `./event-catalogue` (EVENT-01):
 * several shipped wire names leak table names (`sheet_instance.*`,
 * `sheet_definition.*`, `notebook_template.*`) and stay on the wire for
 * compatibility while the catalogue pins the canonical domain names.
 * `matchesFilter` accepts either form. The emitted strings below are frozen.
 */
import { resolveEventAlias } from './event-catalogue'

/** Internal entity_type + operation → stable external event type. */
const EVENT_TYPE_MAP: Record<string, Record<string, string>> = {
  record: {
    create: 'record.created',
    update: 'record.updated',
    move: 'record.moved',
    delete: 'record.deleted',
    archive: 'record.archived',
    restore: 'record.restored',
  },
  dataset: {
    create: 'dataset.created',
    update: 'dataset.updated',
    archive: 'dataset.archived',
    restore: 'dataset.restored',
  },
  dataset_version: {
    create: 'dataset.versioned',
  },
  review_submission: {
    create: 'notebook.submitted',
    amend: 'notebook.amended',
  },
  review_decision: {
    create: 'review.decided',
  },
  signature: {
    create: 'notebook.signed',
  },
  sheet_instance: {
    create: 'sheet_instance.created',
    update: 'sheet_instance.updated',
    archive: 'sheet_instance.archived',
    restore: 'sheet_instance.restored',
  },
  project: {
    create: 'project.created',
    update: 'project.updated',
    delete: 'project.deleted',
    archive: 'project.archived',
    restore: 'project.restored',
  },
  sheet_definition: {
    create: 'sheet_definition.created',
    update: 'sheet_definition.updated',
  },
  sheet_definition_version: {
    create: 'sheet_definition.versioned',
  },
  notebook_template: {
    create: 'notebook_template.created',
    update: 'notebook_template.updated',
  },
  notebook_template_version: {
    create: 'notebook_template.versioned',
  },
}

/** All known stable event types (for validation and documentation). */
export const STABLE_EVENT_TYPES: readonly string[] = Object.freeze(
  Object.values(EVENT_TYPE_MAP).flatMap((ops) => Object.values(ops)),
)

/**
 * Map an internal change_event to a stable external event type.
 * Returns null when the entity_type + operation combination is not in the
 * webhook surface (most internal events are not delivered to webhooks).
 */
export function mapEventType(
  entityType: string,
  operation: string,
): string | null {
  if (!Object.hasOwn(EVENT_TYPE_MAP, entityType)) return null
  const ops = EVENT_TYPE_MAP[entityType]
  return ops[operation] ?? null
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
