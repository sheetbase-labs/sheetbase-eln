/**
 * EVENT-01 — Canonical Event Catalogue.
 *
 * The single pinned list of stable domain events Sheetbase emits. Consumers
 * (webhooks, SSE, pipeline triggers) read this instead of inferring meaning
 * from `change_events` entity_type/operation pairs or database table names.
 *
 * Boundaries (see docs/knowledge/roadmap-3/tasks/EVENT.md):
 * - events describe canonical domain changes; they are not a second
 *   audit/evidence store — `payload`/`data` stays a lightweight summary,
 *   never the source of truth (`change_events` remains the durable source).
 * - this module pins names, envelope, versions and producers. Delivery
 *   semantics (retry, replay, health) belong to EVENT-02; trigger mapping
 *   belongs to EVENT-03. Nothing here changes what the delivery engine emits.
 *
 * Wire compatibility: several shipped webhook names leak internal table
 * names (`sheet_instance.*`, `sheet_definition.*`, `notebook_template.*`).
 * Those strings stay on the wire — existing subscriptions keep working —
 * and are recorded on each entry as the emitted `wireName` while `name`
 * carries the canonical domain name. `resolveEventAlias()` maps either form
 * to the canonical name. New consumers should subscribe with canonical
 * names; per `docs/development/conventions.md` event names are added, never
 * renamed, so aliases are retired only with an explicit migration.
 */

import type { ChangeEventInput } from './webhook-events'

/** Payload schema version pinned by this catalogue revision. */
export const CATALOGUE_SCHEMA_VERSION = '1' as const
export type CatalogueSchemaVersion = typeof CATALOGUE_SCHEMA_VERSION

/** Domain families covered by the catalogue. */
export type EventFamily =
  | 'record'
  | 'dataset'
  | 'sheet'
  | 'notebook'
  | 'pipeline'
  | 'administration'

/** Which `change_events` row produces the event. */
export interface ProducerMapping {
  /** Internal `change_events.entity_type`. */
  readonly entityType: string
  /** Internal `change_events.operation`. */
  readonly operation: string
}

/**
 * Catalogue maturity of one entry.
 * - `stable`: shipped on the webhook wire (API-06) or the canonical name for
 *   a shipped wire alias; safe for external consumers to depend on.
 * - `provisional`: pinned name + producer for a real `change_events`
 *   producer that is not webhook-surfaced yet (SSE today; EVENT-03 decides
 *   webhook/trigger surfacing). New names, so no alias baggage.
 * - `reserved`: mapped defensively but with no current producer; never
 *   emitted today. Kept so the name cannot be claimed for another meaning.
 */
export type CatalogueStatus = 'stable' | 'provisional' | 'reserved'

/** Which introduction introduced (shipped or pinned) the entry. */
export type CatalogueIntroducedIn = 'api-06' | 'event-01'

/** Which consumers can observe the event today. */
export interface EventConsumerMap {
  /** Delivered to webhook subscriptions (only `stable` entries). */
  readonly webhook: boolean
  /** Visible over SSE `/api/events` (all produced entries). */
  readonly sse: boolean
  /** Consumed by the pipeline event scheduler today. */
  readonly pipeline: boolean
}

export interface EventCatalogueEntry {
  /** Canonical stable name — the contract consumers depend on. */
  readonly name: string
  readonly family: EventFamily
  readonly summary: string
  /** Producing `change_events` entity/operation; null when reserved. */
  readonly producer: ProducerMapping | null
  /**
   * Name actually emitted on the webhook wire today. Equals `name` for
   * canonical wire names; differs for table-name leaks kept for
   * compatibility; null when the entry is not webhook-surfaced.
   */
  readonly wireName: string | null
  readonly status: CatalogueStatus
  readonly introducedIn: CatalogueIntroducedIn
  readonly consumers: EventConsumerMap
  readonly notes?: string
}

/** Internal `change_events` producers intentionally kept out of the catalogue. */
export interface ExcludedProducer {
  readonly entityType: string
  /** Operation, or `'*'` for every operation of the entity. */
  readonly operation: string
  readonly reason: string
}

const sseOnly: EventConsumerMap = Object.freeze({
  webhook: false,
  sse: true,
  pipeline: false,
})
const webhookSse: EventConsumerMap = Object.freeze({
  webhook: true,
  sse: true,
  pipeline: false,
})

/**
 * The canonical event catalogue. One entry per stable event name; producers
 * are the verified `change_events` entity_type/operation pairs from the
 * migration triggers (see `drizzle/0133_gov_03_audit_history.sql`,
 * `drizzle/0054_admin_001_workspace_admin.sql`,
 * `drizzle/0140_auto_01_03_pipelines.sql`, `drizzle/0122_api_02_credential_audit.sql`).
 */
export const EVENT_CATALOGUE: readonly EventCatalogueEntry[] = Object.freeze([
  // -- project --------------------------------------------------------------
  {
    name: 'project.created',
    family: 'administration',
    summary: 'A project was created.',
    producer: { entityType: 'project', operation: 'create' },
    wireName: 'project.created',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'project.updated',
    family: 'administration',
    summary: 'A project changed (name, description or settings).',
    producer: { entityType: 'project', operation: 'update' },
    wireName: 'project.updated',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'project.deleted',
    family: 'administration',
    summary: 'A project was deleted.',
    producer: { entityType: 'project', operation: 'delete' },
    wireName: 'project.deleted',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'project.archived',
    family: 'administration',
    summary: 'A project was archived (reversible).',
    producer: { entityType: 'project', operation: 'archive' },
    wireName: 'project.archived',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'project.restored',
    family: 'administration',
    summary: 'An archived project was restored to active.',
    producer: { entityType: 'project', operation: 'restore' },
    wireName: 'project.restored',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  // -- record ---------------------------------------------------------------
  {
    name: 'record.created',
    family: 'record',
    summary: 'A notebook-backed record was created.',
    producer: { entityType: 'record', operation: 'create' },
    wireName: 'record.created',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'record.updated',
    family: 'record',
    summary: 'Record metadata or content changed.',
    producer: { entityType: 'record', operation: 'update' },
    wireName: 'record.updated',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'record.moved',
    family: 'record',
    summary: 'A record moved project/folder location.',
    producer: { entityType: 'record', operation: 'move' },
    wireName: 'record.moved',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'record.deleted',
    family: 'record',
    summary: 'A record was soft-deleted (tombstoned, not purged).',
    producer: { entityType: 'record', operation: 'delete' },
    wireName: 'record.deleted',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'record.archived',
    family: 'record',
    summary: 'A record was archived (reversible).',
    producer: { entityType: 'record', operation: 'archive' },
    wireName: 'record.archived',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'record.restored',
    family: 'record',
    summary: 'An archived record was restored to active.',
    producer: { entityType: 'record', operation: 'restore' },
    wireName: 'record.restored',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'record.amended',
    family: 'record',
    summary:
      'An amendment draft was opened from a locked record (new revision supersedes the locked one).',
    producer: { entityType: 'record', operation: 'amend' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
    notes:
      'Emitted by api.create_amendment; visible over SSE today, not webhook-surfaced (EVENT-03 decides).',
  },
  // -- dataset / version ----------------------------------------------------
  {
    name: 'dataset.created',
    family: 'dataset',
    summary: 'A Dataset was created.',
    producer: { entityType: 'dataset', operation: 'create' },
    wireName: 'dataset.created',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'dataset.updated',
    family: 'dataset',
    summary: 'A Dataset was updated (metadata, schema binding or revision).',
    producer: { entityType: 'dataset', operation: 'update' },
    wireName: 'dataset.updated',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'dataset.archived',
    family: 'dataset',
    summary: 'A Dataset was archived (reversible).',
    producer: { entityType: 'dataset', operation: 'archive' },
    wireName: 'dataset.archived',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'dataset.restored',
    family: 'dataset',
    summary: 'An archived Dataset was restored to active.',
    producer: { entityType: 'dataset', operation: 'restore' },
    wireName: 'dataset.restored',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'dataset.versioned',
    family: 'dataset',
    summary:
      'An immutable Dataset Version snapshot was created; carries the parent datasetId.',
    producer: { entityType: 'dataset_version', operation: 'create' },
    wireName: 'dataset.versioned',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: Object.freeze({ webhook: true, sse: true, pipeline: true }),
    notes:
      'The only event the pipeline scheduler consumes today (event schedules poll dataset_version/create).',
  },
  // -- sheet ----------------------------------------------------------------
  {
    name: 'sheet.created',
    family: 'sheet',
    summary: 'A working Sheet was instantiated.',
    producer: { entityType: 'sheet_instance', operation: 'create' },
    wireName: 'sheet_instance.created',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
    notes:
      'Wire alias sheet_instance.created kept for compatibility; subscribe with sheet.created.',
  },
  {
    name: 'sheet.updated',
    family: 'sheet',
    summary: 'A working Sheet changed (values, bindings or definition version).',
    producer: { entityType: 'sheet_instance', operation: 'update' },
    wireName: 'sheet_instance.updated',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
    notes:
      'Wire alias sheet_instance.updated kept for compatibility; subscribe with sheet.updated.',
  },
  {
    name: 'sheet.archived',
    family: 'sheet',
    summary: 'A working Sheet was archived (reversible).',
    producer: { entityType: 'sheet_instance', operation: 'archive' },
    wireName: 'sheet_instance.archived',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
    notes:
      'Wire alias sheet_instance.archived kept for compatibility; subscribe with sheet.archived.',
  },
  {
    name: 'sheet.restored',
    family: 'sheet',
    summary: 'An archived working Sheet was restored to active.',
    producer: { entityType: 'sheet_instance', operation: 'restore' },
    wireName: 'sheet_instance.restored',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
    notes:
      'Wire alias sheet_instance.restored kept for compatibility; subscribe with sheet.restored.',
  },
  {
    name: 'sheet.definition.created',
    family: 'sheet',
    summary: 'A reusable Sheet Definition was created.',
    producer: { entityType: 'sheet_definition', operation: 'create' },
    wireName: 'sheet_definition.created',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
    notes:
      'Wire alias sheet_definition.created kept for compatibility; subscribe with sheet.definition.created.',
  },
  {
    name: 'sheet.definition.updated',
    family: 'sheet',
    summary: 'A reusable Sheet Definition changed (including lifecycle).',
    producer: { entityType: 'sheet_definition', operation: 'update' },
    wireName: 'sheet_definition.updated',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
    notes:
      'Wire alias sheet_definition.updated kept for compatibility; subscribe with sheet.definition.updated.',
  },
  {
    name: 'sheet.definition.versioned',
    family: 'sheet',
    summary: 'A new Sheet Definition version was published.',
    producer: { entityType: 'sheet_definition_version', operation: 'create' },
    wireName: 'sheet_definition.versioned',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
    notes:
      'Wire alias sheet_definition.versioned kept for compatibility; subscribe with sheet.definition.versioned.',
  },
  // -- notebook / review ----------------------------------------------------
  {
    name: 'notebook.submitted',
    family: 'notebook',
    summary: 'A record revision was submitted for review.',
    producer: { entityType: 'review_submission', operation: 'create' },
    wireName: 'notebook.submitted',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'notebook.amended',
    family: 'notebook',
    summary: 'Reserved: a review submission was amended.',
    producer: null,
    wireName: 'notebook.amended',
    status: 'reserved',
    introducedIn: 'api-06',
    consumers: webhookSse,
    notes:
      'Defensive wire mapping only — no producer emits review_submission/amend today (the submission trigger is INSERT-only; amendments emit record.amended). Never emitted; kept so the name cannot be claimed for another meaning.',
  },
  {
    name: 'review.decided',
    family: 'notebook',
    summary:
      'A review decision (request-changes / reject / approve / withdraw) was recorded.',
    producer: { entityType: 'review_decision', operation: 'create' },
    wireName: 'review.decided',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'notebook.signed',
    family: 'notebook',
    summary: 'An electronic signature was captured on a revision.',
    producer: { entityType: 'signature', operation: 'create' },
    wireName: 'notebook.signed',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
  },
  {
    name: 'notebook.template.created',
    family: 'notebook',
    summary: 'A reusable Notebook Template was created.',
    producer: { entityType: 'notebook_template', operation: 'create' },
    wireName: 'notebook_template.created',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
    notes:
      'Wire alias notebook_template.created kept for compatibility; subscribe with notebook.template.created.',
  },
  {
    name: 'notebook.template.updated',
    family: 'notebook',
    summary: 'A reusable Notebook Template changed.',
    producer: { entityType: 'notebook_template', operation: 'update' },
    wireName: 'notebook_template.updated',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
    notes:
      'Wire alias notebook_template.updated kept for compatibility; subscribe with notebook.template.updated.',
  },
  {
    name: 'notebook.template.versioned',
    family: 'notebook',
    summary: 'A new Notebook Template version was published.',
    producer: { entityType: 'notebook_template_version', operation: 'create' },
    wireName: 'notebook_template.versioned',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSse,
    notes:
      'Wire alias notebook_template.versioned kept for compatibility; subscribe with notebook.template.versioned.',
  },
  // -- pipeline -------------------------------------------------------------
  {
    name: 'pipeline.created',
    family: 'pipeline',
    summary: 'A Pipeline definition was created.',
    producer: { entityType: 'pipeline_definition', operation: 'create' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  {
    name: 'pipeline.updated',
    family: 'pipeline',
    summary: 'A Pipeline definition changed.',
    producer: { entityType: 'pipeline_definition', operation: 'update' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  {
    name: 'pipeline.deleted',
    family: 'pipeline',
    summary: 'A Pipeline definition was deleted.',
    producer: { entityType: 'pipeline_definition', operation: 'delete' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  {
    name: 'pipeline.version.created',
    family: 'pipeline',
    summary: 'A Pipeline definition version was created.',
    producer: { entityType: 'pipeline_definition_version', operation: 'create' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
    notes:
      'Lifecycle transitions (draft → published → retired) arrive as pipeline.version.updated.',
  },
  {
    name: 'pipeline.version.updated',
    family: 'pipeline',
    summary:
      'A Pipeline definition version changed, including publish/retire lifecycle transitions.',
    producer: { entityType: 'pipeline_definition_version', operation: 'update' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  {
    name: 'pipeline.run.created',
    family: 'pipeline',
    summary: 'A Pipeline run started (manual, scheduled or event-triggered).',
    producer: { entityType: 'pipeline_run', operation: 'create' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
    notes:
      'Fine-grained run outcomes (succeeded/failed) arrive as pipeline.run.updated; authoritative run state lives in the run rows, not the event stream.',
  },
  {
    name: 'pipeline.run.updated',
    family: 'pipeline',
    summary: 'A Pipeline run changed state (progress, completion or failure).',
    producer: { entityType: 'pipeline_run', operation: 'update' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  {
    name: 'pipeline.schedule.created',
    family: 'pipeline',
    summary: 'A Pipeline schedule (interval, daily or event) was created.',
    producer: { entityType: 'pipeline_schedule', operation: 'create' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  {
    name: 'pipeline.schedule.updated',
    family: 'pipeline',
    summary: 'A Pipeline schedule changed (including enable/disable).',
    producer: { entityType: 'pipeline_schedule', operation: 'update' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  // -- administration ---------------------------------------------------------
  {
    name: 'workspace.invitation.created',
    family: 'administration',
    summary: 'A workspace invitation was created.',
    producer: { entityType: 'workspace_invitation', operation: 'create' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  {
    name: 'workspace.invitation.updated',
    family: 'administration',
    summary: 'A workspace invitation changed (including accept/expire).',
    producer: { entityType: 'workspace_invitation', operation: 'update' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  {
    name: 'workspace.invitation.deleted',
    family: 'administration',
    summary: 'A workspace invitation was revoked.',
    producer: { entityType: 'workspace_invitation', operation: 'delete' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  {
    name: 'workspace.settings.created',
    family: 'administration',
    summary: 'Workspace settings were initialised.',
    producer: { entityType: 'workspace_settings', operation: 'create' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  {
    name: 'workspace.settings.updated',
    family: 'administration',
    summary:
      'Workspace settings changed (registration, review, signature, retention or integration settings).',
    producer: { entityType: 'workspace_settings', operation: 'update' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  {
    name: 'project.access.granted',
    family: 'administration',
    summary: 'Explicit per-project access was granted to a member.',
    producer: { entityType: 'project_access', operation: 'create' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  {
    name: 'project.access.updated',
    family: 'administration',
    summary: 'Explicit per-project access changed level.',
    producer: { entityType: 'project_access', operation: 'update' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  {
    name: 'project.access.revoked',
    family: 'administration',
    summary: 'Explicit per-project access was removed.',
    producer: { entityType: 'project_access', operation: 'delete' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
  {
    name: 'workspace.credential.created',
    family: 'administration',
    summary: 'An API credential or personal token was created (or rotated in).',
    producer: { entityType: 'api_credential', operation: 'create' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
    notes:
      'Rotation emits workspace.credential.created (new) plus workspace.credential.revoked (old) so the pair is reconstructable. Payloads carry display metadata only — never secrets.',
  },
  {
    name: 'workspace.credential.revoked',
    family: 'administration',
    summary: 'An API credential or personal token was revoked (or rotated out).',
    producer: { entityType: 'api_credential', operation: 'revoke' },
    wireName: null,
    status: 'provisional',
    introducedIn: 'event-01',
    consumers: sseOnly,
  },
])

/**
 * Producers that exist in `change_events` but are intentionally not stable
 * catalogue events. Consumers must not infer catalogue membership from the
 * database vocabulary — this list is the closed record of deliberate
 * exclusions.
 */
export const INTENTIONALLY_EXCLUDED: readonly ExcludedProducer[] = Object.freeze(
  [
    {
      entityType: 'dataset',
      operation: 'delete',
      reason:
        'Hard deletes stay out of the external surface; archive/restore are the lifecycle signals.',
    },
    {
      entityType: 'sheet_instance',
      operation: 'delete',
      reason:
        'Instance deletes stay out of the external surface; archive/restore are the lifecycle signals.',
    },
    {
      entityType: 'sheet_definition',
      operation: 'delete',
      reason: 'Definition deletes stay out of the external surface.',
    },
    {
      entityType: 'sheet_definition_version',
      operation: 'update',
      reason:
        'Version rows are append-only snapshots; lifecycle transitions are read from the latest version, not update events.',
    },
    {
      entityType: 'notebook_template',
      operation: 'delete',
      reason: 'Template deletes stay out of the external surface.',
    },
    {
      entityType: 'notebook_template_version',
      operation: 'update',
      reason:
        'Version rows are append-only snapshots; lifecycle transitions are read from the latest version, not update events.',
    },
    {
      entityType: 'folder',
      operation: '*',
      reason: 'Project-hierarchy churn stays on SSE/live sync.',
    },
    {
      entityType: 'block',
      operation: '*',
      reason:
        'High-volume live-editing detail stays on SSE/live sync; reviewable snapshots surface as notebook.submitted/signed.',
    },
    {
      entityType: 'record_link',
      operation: '*',
      reason: 'Link churn stays on SSE/live sync.',
    },
    {
      entityType: 'storage_movement',
      operation: '*',
      reason: 'Internal storage-operations detail, not a product contract.',
    },
    {
      entityType: 'calendar_booking',
      operation: '*',
      reason: 'Internal scheduling detail, not a product contract.',
    },
    {
      entityType: 'webhook_subscription',
      operation: '*',
      reason:
        'Delivery machinery must not fan out to itself; subscription lifecycle is visible via delivery history and the audit surface.',
    },
    {
      entityType: 'webhook_delivery',
      operation: '*',
      reason:
        'Delivery machinery must not fan out to itself; delivery history is the record.',
    },
  ],
)

/** All canonical stable event names. */
export const EVENT_NAMES: readonly string[] = Object.freeze(
  EVENT_CATALOGUE.map((entry) => entry.name),
)

/** Canonical entry by canonical name or wire alias. */
export function eventByName(name: string): EventCatalogueEntry | undefined {
  return EVENT_CATALOGUE.find(
    (entry) => entry.name === name || entry.wireName === name,
  )
}

/**
 * Resolve a wire alias (or canonical name) to its canonical catalogue name.
 * Unknown names pass through unchanged so filters over future names fail
 * closed at match time rather than here.
 */
export function resolveEventAlias(name: string): string {
  const entry = EVENT_CATALOGUE.find(
    (candidate) => candidate.wireName === name,
  )
  return entry ? entry.name : name
}

/** Catalogue entry for a `change_events` entity_type/operation pair, if any. */
export function eventForProducer(
  entityType: string,
  operation: string,
): EventCatalogueEntry | undefined {
  return EVENT_CATALOGUE.find(
    (entry) =>
      entry.producer !== null &&
      entry.producer.entityType === entityType &&
      entry.producer.operation === operation,
  )
}

/** Canonical name for a producer pair (null when not a catalogue event). */
export function canonicalNameFor(
  entityType: string,
  operation: string,
): string | null {
  return eventForProducer(entityType, operation)?.name ?? null
}

/**
 * The canonical payload envelope every catalogue event shares. Stable IDs
 * plus actor/provenance context are required on every event — consumers use
 * `id` for idempotency and `provenance.sequence` for ordering within a
 * workspace. `data` is a lightweight summary, never the source of truth.
 */
export interface CanonicalEventEnvelope {
  /** Canonical stable event name (e.g. `sheet.updated`). */
  readonly event: string
  /** Envelope schema version. */
  readonly schemaVersion: CatalogueSchemaVersion
  /** Globally unique event id (the `change_events` id) — the idempotency key. */
  readonly id: string
  /** Event creation timestamp (ISO 8601). */
  readonly occurredAt: string
  /** Workspace the event belongs to. */
  readonly workspaceId: string
  /** Who caused the event (exactly one of userId/credentialId is set). */
  readonly actor: {
    readonly userId: string | null
    readonly credentialId: string | null
    readonly clientId: string | null
  }
  /** Where the event came from and how it orders. */
  readonly provenance: {
    readonly entityType: string
    readonly operation: string
    readonly entityUuid: string
    readonly sequence: number
    readonly recordId: string | null
    readonly projectId: string | null
  }
  /** Lightweight event summary (never the full source of truth). */
  readonly data: Record<string, unknown>
}

/**
 * Build the canonical envelope for a catalogue event from an internal
 * `change_events` row. Pure and total — delivery code keeps using the
 * versioned webhook wire payload; this is the documented consumer contract
 * the catalogue pins.
 */
export function toCanonicalEnvelope(
  event: ChangeEventInput,
  eventName: string,
): CanonicalEventEnvelope {
  return {
    event: eventName,
    schemaVersion: CATALOGUE_SCHEMA_VERSION,
    id: event.id,
    occurredAt: event.createdAt,
    workspaceId: event.workspaceId,
    actor: {
      userId: event.actorUserId,
      credentialId: event.actorCredentialId,
      clientId: event.clientId,
    },
    provenance: {
      entityType: event.entityType,
      operation: event.operation,
      entityUuid: event.entityUuid,
      sequence: event.sequence,
      recordId: event.recordId,
      projectId: event.projectId,
    },
    data: event.payload,
  }
}
