/**
 * EVENT-01 — Canonical Event Catalogue.
 *
 * The single pinned list of stable domain events Sheetbase emits. Consumers
 * (webhooks, SSE, pipeline triggers) read this instead of inferring meaning
 * from `change_events` entity_type/operation pairs or database table names.
 *
 * Boundaries (see docs/knowledge/history/archive/roadmap-3/tasks/EVENT.md):
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
  | 'sample'
  | 'booking'
  | 'import'
  | 'approval'
  | 'pipeline'
  | 'administration'

/** Which `change_events` row produces the event. */
export interface ProducerMapping {
  /** Internal `change_events.entity_type`. */
  readonly entityType: string
  /** Internal `change_events.operation`. */
  readonly operation: string
  /**
   * Narrows the pair to one kind of change when several events share it
   * (a sample event carries its own operation, an import its status).
   */
  readonly when?: PayloadCondition
}

/** A test on one key of the `change_events.payload`. */
export interface PayloadCondition {
  readonly key: string
  readonly equals?: string
  readonly notEquals?: string
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
export type CatalogueIntroducedIn = 'api-06' | 'event-01' | 'notify-01'

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
const webhookSsePipeline: EventConsumerMap = Object.freeze({
  webhook: true,
  sse: true,
  pipeline: true,
})

/**
 * The canonical event catalogue. One entry per stable event name; producers
 * are the verified `change_events` entity_type/operation pairs from the
 * migration triggers (see former migration 0133,
 * former migration 0054,
 * former migration 0140, former migration 0122).
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
    consumers: webhookSsePipeline,
  },
  {
    name: 'record.updated',
    family: 'record',
    summary: 'Record metadata or content changed.',
    producer: { entityType: 'record', operation: 'update' },
    wireName: 'record.updated',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSsePipeline,
  },
  {
    name: 'record.moved',
    family: 'record',
    summary: 'A record moved project/folder location.',
    producer: { entityType: 'record', operation: 'move' },
    wireName: 'record.moved',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSsePipeline,
  },
  {
    name: 'record.deleted',
    family: 'record',
    summary: 'A record was soft-deleted (tombstoned, not purged).',
    producer: { entityType: 'record', operation: 'delete' },
    wireName: 'record.deleted',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSsePipeline,
  },
  {
    name: 'record.archived',
    family: 'record',
    summary: 'A record was archived (reversible).',
    producer: { entityType: 'record', operation: 'archive' },
    wireName: 'record.archived',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSsePipeline,
  },
  {
    name: 'record.restored',
    family: 'record',
    summary: 'An archived record was restored to active.',
    producer: { entityType: 'record', operation: 'restore' },
    wireName: 'record.restored',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSsePipeline,
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
    consumers: webhookSsePipeline,
  },
  {
    name: 'dataset.updated',
    family: 'dataset',
    summary: 'A Dataset was updated (metadata, schema binding or revision).',
    producer: { entityType: 'dataset', operation: 'update' },
    wireName: 'dataset.updated',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSsePipeline,
  },
  {
    name: 'dataset.archived',
    family: 'dataset',
    summary: 'A Dataset was archived (reversible).',
    producer: { entityType: 'dataset', operation: 'archive' },
    wireName: 'dataset.archived',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSsePipeline,
  },
  {
    name: 'dataset.restored',
    family: 'dataset',
    summary: 'An archived Dataset was restored to active.',
    producer: { entityType: 'dataset', operation: 'restore' },
    wireName: 'dataset.restored',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSsePipeline,
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
    consumers: webhookSsePipeline,
    notes:
      'Wire alias sheet_instance.created kept for compatibility; subscribe with sheet.created.',
  },
  {
    name: 'sheet.updated',
    family: 'sheet',
    summary:
      'A working Sheet changed (values, bindings or definition version).',
    producer: { entityType: 'sheet_instance', operation: 'update' },
    wireName: 'sheet_instance.updated',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSsePipeline,
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
    consumers: webhookSsePipeline,
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
    consumers: webhookSsePipeline,
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
    consumers: webhookSsePipeline,
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
    consumers: webhookSsePipeline,
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
    consumers: webhookSsePipeline,
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
    consumers: webhookSsePipeline,
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
    consumers: webhookSsePipeline,
  },
  {
    name: 'record.signed',
    family: 'notebook',
    summary: 'An electronic signature was captured on a record.',
    producer: { entityType: 'signature', operation: 'create' },
    wireName: 'notebook.signed',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSsePipeline,
  },
  {
    name: 'notebook.template.created',
    family: 'notebook',
    summary: 'A reusable Notebook Template was created.',
    producer: { entityType: 'notebook_template', operation: 'create' },
    wireName: 'notebook_template.created',
    status: 'stable',
    introducedIn: 'api-06',
    consumers: webhookSsePipeline,
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
    consumers: webhookSsePipeline,
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
    consumers: webhookSsePipeline,
    notes:
      'Wire alias notebook_template.versioned kept for compatibility; subscribe with notebook.template.versioned.',
  },
  // -- samples, bookings, imports, approvals ---------------------------------
  {
    name: 'sample.received',
    family: 'sample',
    summary: 'Stock was received against a sample.',
    producer: {
      entityType: 'sample_event',
      operation: 'create',
      when: { key: 'operation', equals: 'receive' },
    },
    wireName: 'sample.received',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'sample.moved',
    family: 'sample',
    summary: 'A sample moved to another location.',
    producer: {
      entityType: 'sample_event',
      operation: 'create',
      when: { key: 'operation', equals: 'transfer' },
    },
    wireName: 'sample.moved',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'sample.consumed',
    family: 'sample',
    summary: 'Part of a sample was used up.',
    producer: {
      entityType: 'sample_event',
      operation: 'create',
      when: { key: 'operation', equals: 'consume' },
    },
    wireName: 'sample.consumed',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'sample.released',
    family: 'sample',
    summary: 'A sample was released for use.',
    producer: {
      entityType: 'sample_event',
      operation: 'create',
      when: { key: 'operation', equals: 'release' },
    },
    wireName: 'sample.released',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'sample.quarantined',
    family: 'sample',
    summary: 'A sample was placed in quarantine.',
    producer: {
      entityType: 'sample_event',
      operation: 'create',
      when: { key: 'operation', equals: 'quarantine' },
    },
    wireName: 'sample.quarantined',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'sample.disposed',
    family: 'sample',
    summary: 'A sample was disposed of.',
    producer: {
      entityType: 'sample_event',
      operation: 'create',
      when: { key: 'operation', equals: 'dispose' },
    },
    wireName: 'sample.disposed',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'sample.hold_exceeded',
    family: 'sample',
    summary: 'A sample was held longer than its allowed time.',
    producer: {
      entityType: 'sample_event',
      operation: 'create',
      when: { key: 'operation', equals: 'hold_exceeded' },
    },
    wireName: 'sample.hold_exceeded',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'booking.created',
    family: 'booking',
    summary: 'An instrument or room was booked.',
    producer: { entityType: 'calendar_booking', operation: 'create' },
    wireName: 'booking.created',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'booking.updated',
    family: 'booking',
    summary: 'A booking was changed.',
    producer: {
      entityType: 'calendar_booking',
      operation: 'update',
      when: { key: 'status', notEquals: 'cancelled' },
    },
    wireName: 'booking.updated',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'booking.cancelled',
    family: 'booking',
    summary: 'A booking was cancelled.',
    producer: {
      entityType: 'calendar_booking',
      operation: 'update',
      when: { key: 'status', equals: 'cancelled' },
    },
    wireName: 'booking.cancelled',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'import.created',
    family: 'import',
    summary: 'A data import was started.',
    producer: { entityType: 'dataset_import', operation: 'create' },
    wireName: 'import.created',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'import.committed',
    family: 'import',
    summary: 'A data import was committed to a Dataset.',
    producer: {
      entityType: 'dataset_import',
      operation: 'update',
      when: { key: 'status', equals: 'committed' },
    },
    wireName: 'import.committed',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'import.failed',
    family: 'import',
    summary: 'A data import failed.',
    producer: {
      entityType: 'dataset_import',
      operation: 'update',
      when: { key: 'status', equals: 'failed' },
    },
    wireName: 'import.failed',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'approval.requested',
    family: 'approval',
    summary: 'An approval was requested.',
    producer: { entityType: 'approval_request', operation: 'create' },
    wireName: 'approval.requested',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'approval.approved',
    family: 'approval',
    summary: 'An approval request was approved.',
    producer: {
      entityType: 'approval_request',
      operation: 'update',
      when: { key: 'state', equals: 'approved' },
    },
    wireName: 'approval.approved',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'approval.returned',
    family: 'approval',
    summary: 'An approval request was returned for changes.',
    producer: {
      entityType: 'approval_request',
      operation: 'update',
      when: { key: 'state', equals: 'returned' },
    },
    wireName: 'approval.returned',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
  },
  {
    name: 'approval.withdrawn',
    family: 'approval',
    summary: 'An approval request was withdrawn.',
    producer: {
      entityType: 'approval_request',
      operation: 'update',
      when: { key: 'state', equals: 'withdrawn' },
    },
    wireName: 'approval.withdrawn',
    status: 'stable',
    introducedIn: 'notify-01',
    consumers: webhookSse,
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
    producer: {
      entityType: 'pipeline_definition_version',
      operation: 'create',
    },
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
    producer: {
      entityType: 'pipeline_definition_version',
      operation: 'update',
    },
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
    summary:
      'An API credential or personal token was revoked (or rotated out).',
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
export const INTENTIONALLY_EXCLUDED: readonly ExcludedProducer[] =
  Object.freeze([
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
      operation: 'delete',
      reason:
        'Bookings are cancelled, not deleted; booking.cancelled is the lifecycle signal.',
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
  ])

/**
 * Each webhook-surfaced event in the words a scientist uses, for the webhook
 * and pipeline pickers. An event not listed is spelled out from its name.
 */
const EVENT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'project.created': 'A project is created',
  'project.updated': 'A project is edited',
  'project.deleted': 'A project is deleted',
  'project.archived': 'A project is archived',
  'project.restored': 'A project is restored',
  'dataset.versioned': 'A Dataset gets a new version',
  'dataset.created': 'A Dataset is created',
  'dataset.updated': 'A Dataset is edited',
  'dataset.archived': 'A Dataset is archived',
  'dataset.restored': 'A Dataset is restored',
  'record.created': 'A record is created',
  'record.updated': 'A record is edited',
  'record.moved': 'A record is moved',
  'record.deleted': 'A record is deleted',
  'record.archived': 'A record is archived',
  'record.restored': 'A record is restored',
  'record.signed': 'A record is signed',
  'sheet.created': 'A Sheet is created',
  'sheet.updated': 'A Sheet is edited',
  'sheet.archived': 'A Sheet is archived',
  'sheet.restored': 'A Sheet is restored',
  'sheet.definition.created': 'A Sheet definition is created',
  'sheet.definition.updated': 'A Sheet definition is edited',
  'sheet.definition.versioned': 'A Sheet definition gets a new version',
  'notebook.submitted': 'A notebook is submitted for review',
  'review.decided': 'A review is decided',
  'notebook.template.created': 'A notebook template is created',
  'notebook.template.updated': 'A notebook template is edited',
  'notebook.template.versioned': 'A notebook template gets a new version',
  'sample.received': 'A sample is received',
  'sample.moved': 'A sample is moved',
  'sample.consumed': 'A sample is used',
  'sample.released': 'A sample is released',
  'sample.quarantined': 'A sample is quarantined',
  'sample.disposed': 'A sample is disposed of',
  'sample.hold_exceeded': 'A sample is held too long',
  'booking.created': 'A booking is made',
  'booking.updated': 'A booking is changed',
  'booking.cancelled': 'A booking is cancelled',
  'import.created': 'A data import starts',
  'import.committed': 'A data import is committed',
  'import.failed': 'A data import fails',
  'approval.requested': 'An approval is requested',
  'approval.approved': 'An approval is granted',
  'approval.returned': 'An approval is returned for changes',
  'approval.withdrawn': 'An approval request is withdrawn',
  'pipeline.run.completed': 'A pipeline run finishes',
  'pipeline.run.created': 'A pipeline run starts',
  'pipeline.run.updated': 'A pipeline run changes',
})

/**
 * An event in the words a scientist uses. A name the table does not know is
 * spelled out ("sheet.row.moved" becomes "Sheet row moved") rather than shown
 * as a code.
 */
export function eventLabel(name: string): string {
  const canonical = resolveEventAlias(name)
  const known = EVENT_LABELS[canonical]
  if (known) return known
  const words = canonical.replace(/[._]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : canonical
}

/** The group an event sits under in pickers. */
const FAMILY_GROUPS: Readonly<Record<EventFamily, string>> = Object.freeze({
  record: 'Records',
  dataset: 'Datasets',
  sheet: 'Sheets',
  notebook: 'Notebooks and reviews',
  sample: 'Samples',
  booking: 'Bookings',
  import: 'Data imports',
  approval: 'Approvals',
  pipeline: 'Pipelines',
  administration: 'Projects',
})

export interface WebhookEventOption {
  /** Canonical name, stored on the subscription. */
  readonly name: string
  readonly label: string
  readonly group: string
}

/** Every event a webhook can listen for, in catalogue order. */
export const WEBHOOK_EVENT_OPTIONS: readonly WebhookEventOption[] =
  Object.freeze(
    EVENT_CATALOGUE.filter(
      (entry) =>
        entry.status === 'stable' &&
        entry.wireName !== null &&
        entry.consumers.webhook,
    ).map((entry) => ({
      name: entry.name,
      label: eventLabel(entry.name),
      group: FAMILY_GROUPS[entry.family],
    })),
  )

/**
 * Names a subscription may list that are delivered by the pipeline engine
 * rather than read off the change feed (a notification destination listens
 * for a finished run). They are valid event types but have no producer pair.
 */
export const PIPELINE_DELIVERED_EVENTS: readonly string[] = Object.freeze([
  'pipeline.run.completed',
])

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
  const entry = EVENT_CATALOGUE.find((candidate) => candidate.wireName === name)
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
