/**
 * REG-002: Samples registry domain library.
 *
 * Samples are `records` rows with kind='sample'. Sample-specific metadata
 * (type, quantity, unit, storage location, barcode, low-stock threshold,
 * notes) lives in `records.properties` JSONB (SCI-001, decision 0026) and is
 * validated by `internal.validate_record_properties`. The durable chain of
 * custody and quantity events lives in `api.sample_events`, written by the
 * controlled `receive_sample` / `consume_sample` / `transfer_sample` /
 * `edit_sample` / `archive_sample` / `restore_sample` RPCs.
 *
 * This module provides the application-boundary helpers that sit on top of
 * that contract: property parsing, PostgREST query building for the registry
 * composition, low-stock projection, summary metrics, and typed DataClient
 * wrappers for the RPCs. PostgreSQL and RLS remain the authoritative
 * access-control boundary; these helpers improve errors and drive the UI.
 */
import type { ColumnDef, RowData } from '@tanstack/react-table'

import type { DataGridFieldFeatures } from '#/components/data-grid'

import { StatusBadge } from '#/components/scientific/status-badge'
import type { DataClient } from './data-client'
import { DataClientError } from './data-client'
import type { NotebookRecord, RecordWire } from './notebook-data'
import { toRecord } from './notebook-data'
import type { RegistryFilterValue, RegistryQuery } from './registry'
import type { ModelFieldDefinition } from './model-fields'
import { displayModelFieldValue, modelFieldColumnId } from './model-fields'

// ---------------------------------------------------------------------------
// Sample properties (records.properties JSONB).
// ---------------------------------------------------------------------------

export interface SampleProperties {
  sampleType?: string
  quantity?: number
  quantityUnit?: string
  storageLocation?: string
  barcode?: string
  lowStockThreshold?: number
  notes?: string
  // LAB-02 step 1 — hold limit. The condition is a human label (e.g. "2-8 C");
  // the limit runs from harvest/registration (`holdStartedAt`, falling back to
  // the record's created_at) for `holdDurationDays`, or until the explicit
  // `holdUntil` deadline when set. `allowedUseExperimentIds` lists the
  // experiments that may still withdraw the sample while it is on hold.
  holdCondition?: string
  holdStartedAt?: string
  holdDurationDays?: number
  holdUntil?: string
  allowedUseExperimentIds?: string[]
  // LAB-02 step 2 — release, quarantine and disposal. `quarantineReason` /
  // `disposalReason` are the human reasons captured by the controlled RPCs;
  // `releasedAt` and `releaseChecks` are the release record and the exact
  // per-sample-type check snapshot evaluated at the time of release.
  quarantineReason?: string
  quarantinedAt?: string
  disposalReason?: string
  disposedAt?: string
  releasedAt?: string
  releaseChecks?: Record<string, unknown>
}

/** Property keys owned by the samples registry. */
export const SAMPLE_PROPERTY_KEYS = [
  'sampleType',
  'quantity',
  'quantityUnit',
  'storageLocation',
  'barcode',
  'lowStockThreshold',
  'notes',
  'holdCondition',
  'holdStartedAt',
  'holdDurationDays',
  'holdUntil',
  'allowedUseExperimentIds',
  'quarantineReason',
  'quarantinedAt',
  'disposalReason',
  'disposedAt',
  'releasedAt',
  'releaseChecks',
] as const

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Parse the raw `properties` JSONB into a typed view. */
export function parseSampleProperties(
  properties: Record<string, unknown>,
): SampleProperties {
  return {
    sampleType: asString(properties.sampleType) ?? undefined,
    quantity: asNumber(properties.quantity) ?? undefined,
    quantityUnit: asString(properties.quantityUnit) ?? undefined,
    storageLocation: asString(properties.storageLocation) ?? undefined,
    barcode: asString(properties.barcode) ?? undefined,
    lowStockThreshold: asNumber(properties.lowStockThreshold) ?? undefined,
    notes: asString(properties.notes) ?? undefined,
    holdCondition: asString(properties.holdCondition) ?? undefined,
    holdStartedAt: asString(properties.holdStartedAt) ?? undefined,
    holdDurationDays: asNumber(properties.holdDurationDays) ?? undefined,
    holdUntil: asString(properties.holdUntil) ?? undefined,
    allowedUseExperimentIds: asStringArray(properties.allowedUseExperimentIds),
    quarantineReason: asString(properties.quarantineReason) ?? undefined,
    quarantinedAt: asString(properties.quarantinedAt) ?? undefined,
    disposalReason: asString(properties.disposalReason) ?? undefined,
    disposedAt: asString(properties.disposedAt) ?? undefined,
    releasedAt: asString(properties.releasedAt) ?? undefined,
    releaseChecks: asObject(properties.releaseChecks),
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter(
    (item): item is string => typeof item === 'string' && item !== '',
  )
  return out.length > 0 ? out : undefined
}

export interface SampleRecord extends NotebookRecord {
  customFields: Record<string, unknown>
  sampleType: string | null
  quantity: number | null
  quantityUnit: string | null
  storageLocation: string | null
  barcode: string | null
  lowStockThreshold: number | null
  notes: string | null
  // LAB-02 step 1 hold limit (see SampleProperties).
  holdCondition: string | null
  holdStartedAt: string | null
  holdDurationDays: number | null
  holdUntil: string | null
  allowedUseExperimentIds: string[] | null
  quarantineReason: string | null
  quarantinedAt: string | null
  disposalReason: string | null
  disposedAt: string | null
  releasedAt: string | null
  releaseChecks: Record<string, unknown> | null
}

export function toSampleRecord(row: RecordWire): SampleRecord {
  const base = toRecord(row)
  const props = parseSampleProperties(row.properties ?? {})
  return {
    ...base,
    customFields: row.custom_fields ?? {},
    sampleType: props.sampleType ?? null,
    quantity: props.quantity ?? null,
    quantityUnit: props.quantityUnit ?? null,
    storageLocation: props.storageLocation ?? null,
    barcode: props.barcode ?? null,
    lowStockThreshold: props.lowStockThreshold ?? null,
    notes: props.notes ?? null,
    holdCondition: props.holdCondition ?? null,
    holdStartedAt: props.holdStartedAt ?? null,
    holdDurationDays: props.holdDurationDays ?? null,
    holdUntil: props.holdUntil ?? null,
    allowedUseExperimentIds: props.allowedUseExperimentIds ?? null,
    quarantineReason: props.quarantineReason ?? null,
    quarantinedAt: props.quarantinedAt ?? null,
    disposalReason: props.disposalReason ?? null,
    disposedAt: props.disposedAt ?? null,
    releasedAt: props.releasedAt ?? null,
    releaseChecks: props.releaseChecks ?? null,
  }
}

/** The properties payload to send to `create_record` for a new sample. */
export function samplePropertiesPayload(
  props: SampleProperties,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (props.sampleType != null) out.sampleType = props.sampleType
  if (props.quantity != null) out.quantity = props.quantity
  if (props.quantityUnit != null) out.quantityUnit = props.quantityUnit
  if (props.storageLocation != null) out.storageLocation = props.storageLocation
  if (props.barcode != null) out.barcode = props.barcode
  if (props.lowStockThreshold != null)
    out.lowStockThreshold = props.lowStockThreshold
  if (props.notes != null) out.notes = props.notes
  if (props.holdCondition != null) out.holdCondition = props.holdCondition
  if (props.holdStartedAt != null) out.holdStartedAt = props.holdStartedAt
  if (props.holdDurationDays != null)
    out.holdDurationDays = props.holdDurationDays
  if (props.holdUntil != null) out.holdUntil = props.holdUntil
  if (props.allowedUseExperimentIds != null)
    out.allowedUseExperimentIds = props.allowedUseExperimentIds
  if (props.quarantineReason != null)
    out.quarantineReason = props.quarantineReason
  if (props.quarantinedAt != null) out.quarantinedAt = props.quarantinedAt
  if (props.disposalReason != null) out.disposalReason = props.disposalReason
  if (props.disposedAt != null) out.disposedAt = props.disposedAt
  if (props.releasedAt != null) out.releasedAt = props.releasedAt
  if (props.releaseChecks != null) out.releaseChecks = props.releaseChecks
  return out
}

// ---------------------------------------------------------------------------
// Low-stock projection and summary metrics.
// ---------------------------------------------------------------------------

/**
 * A sample is low-stock when it still has a positive quantity at or below its
 * configured low-stock threshold. A fully consumed (quantity 0) or exhausted
 * sample is not "low stock" — it is consumed.
 */
export function isLowStock(sample: {
  quantity: number | null
  lowStockThreshold: number | null
}): boolean {
  if (sample.quantity == null || sample.lowStockThreshold == null) return false
  return sample.quantity > 0 && sample.quantity <= sample.lowStockThreshold
}

/**
 * Summary metrics for the registry header. `total` is the authoritative
 * server count; the per-status buckets are projected from the current page
 * rows and labelled so a partial page never masquerades as the whole
 * registry. A server-side aggregate can replace the page projections later
 * without changing the contract. Structurally compatible with the
 * composition's `RegistrySummary` (whose `value` is a React node).
 */
export interface SampleSummary {
  label: string
  value: number
  hint?: string
  /** Semantic tone for the hint text. */
  tone?: 'positive' | 'warning' | 'danger' | 'neutral'
}

export function computeSampleSummaries(
  rows: SampleRecord[],
  totalCount: number,
): SampleSummary[] {
  const available = rows.filter((r) => r.status === 'available').length
  const lowStock = rows.filter((r) => isLowStock(r)).length
  const consumed = rows.filter((r) => r.status === 'consumed').length
  const pct = totalCount > 0 ? Math.round((available / totalCount) * 100) : 0
  return [
    {
      label: 'Total samples',
      value: totalCount,
      hint: `${rows.length} on this page`,
      tone: 'neutral',
    },
    {
      label: 'Available',
      value: available,
      hint: `${pct}% of total`,
      tone: 'positive',
    },
    {
      label: 'Low stock',
      value: lowStock,
      hint: lowStock > 0 ? 'Needs attention' : 'All healthy',
      tone: lowStock > 0 ? 'warning' : 'positive',
    },
    {
      label: 'Consumed',
      value: consumed,
      hint: 'On this page',
      tone: 'neutral',
    },
  ]
}

// ---------------------------------------------------------------------------
// PostgREST query building for the registry composition.
//
// The composition owns a RegistryQuery (page/sort/group/filters) and forwards
// every change through onQueryChange. These pure helpers translate that query
// into a PostgREST string for the `records` resource scoped to kind='sample'.
// They are unit-tested in isolation so the contract stays stable.
// ---------------------------------------------------------------------------

/** Filter ids exposed by the samples registry. */
export const SAMPLE_FILTER_IDS = [
  'status',
  'storageLocation',
  'sampleType',
  'barcode',
  'search',
  'archived',
] as const

/**
 * Column ids that the registry allows sorting/grouping on, mapped to their
 * PostgREST order expressions. Properties-backed columns use the
 * `properties->>key` text accessor.
 */
export const SAMPLE_SORT_FIELDS: Record<string, string> = {
  identifier: 'identifier',
  title: 'title',
  status: 'status',
  updatedAt: 'updated_at',
  createdAt: 'created_at',
  sampleType: 'properties->>sampleType',
  storageLocation: 'properties->>storageLocation',
  barcode: 'properties->>barcode',
  quantity: '(properties->>quantity)::numeric',
}

const SAMPLE_STATUS_VALUES = [
  'available',
  'reserved',
  'consumed',
  'expired',
  'quarantined',
  'frozen',
  'hold_exceeded',
  'disposed',
] as const

export function sampleStatusOptions(): { value: string; label: string }[] {
  return SAMPLE_STATUS_VALUES.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  }))
}

function escapeIlike(value: string): string {
  // PostgREST ilike treats %, _ and * as wildcards; strip them so a search
  // term with punctuation is treated literally. Encode spaces as `+` (the
  // query-string convention PostgREST accepts) so multi-word terms stay
  // within a single clause.
  return encodeURIComponent(value.replace(/[%_*]/g, '')).replace(/%20/g, '+')
}

/**
 * Build the PostgREST filter fragment (without leading `?`) for the active
 * registry filters. Returns an array of clauses joined by `&`.
 */
export function buildSamplesFilter(filters: RegistryFilterValue[]): string[] {
  const clauses: string[] = ['kind=eq.sample', 'deleted_at=is.null']
  let includeArchived = false
  for (const filter of filters) {
    const raw = filter.values[0]
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (!value && typeof raw !== 'boolean') continue
    if (filter.fieldId.startsWith('custom:')) {
      const key = filter.fieldId.slice('custom:'.length)
      if (!/^[a-z][a-z0-9_]{0,62}$/.test(key)) {
        throw new Error(`Unsupported model field: ${key}`)
      }
      if (filter.operator === 'eq') {
        clauses.push(`custom_fields->>${key}=eq.${escapeIlike(String(raw))}`)
      } else if (filter.operator === 'contains') {
        clauses.push(`custom_fields->>${key}=ilike.*${escapeIlike(value)}*`)
      } else {
        throw new Error(`Unsupported model-field filter: ${filter.operator}`)
      }
      continue
    }
    const expected =
      filter.fieldId === 'status' || filter.fieldId === 'archived'
        ? 'eq'
        : 'contains'
    if (filter.operator !== expected)
      throw new Error(
        `Unsupported sample filter: ${filter.fieldId}/${filter.operator}`,
      )
    switch (filter.fieldId) {
      case 'status':
        clauses.push(`status=eq.${value}`)
        break
      case 'storageLocation':
        clauses.push(
          `properties->>storageLocation=ilike.*${escapeIlike(value)}*`,
        )
        break
      case 'sampleType':
        clauses.push(`properties->>sampleType=ilike.*${escapeIlike(value)}*`)
        break
      case 'barcode':
        clauses.push(`properties->>barcode=ilike.*${escapeIlike(value)}*`)
        break
      case 'search': {
        const q = escapeIlike(value)
        clauses.push(
          `(identifier=ilike.*${q}*,title=ilike.*${q}*,properties->>barcode=ilike.*${q}*)`,
        )
        break
      }
      case 'archived':
        if (value === 'included') includeArchived = true
        break
      default:
        throw new Error(`Unsupported sample filter field: ${filter.fieldId}`)
    }
  }
  if (!includeArchived) clauses.push('archived_at=is.null')
  return clauses
}

/** Map a RegistryQuery sort to a PostgREST `order=` clause. */
export function buildSamplesOrder(query: RegistryQuery): string {
  const parts: string[] = []
  // Grouping is a display concern; ordering by the group column first keeps
  // clustered rows together under manual grouping.
  for (const group of query.grouping) {
    const field = sampleSortField(group)
    if (field) parts.push(`${field}.asc`)
  }
  for (const sort of query.sorting) {
    const field = sampleSortField(sort.id)
    if (field) parts.push(`${field}.${sort.desc ? 'desc' : 'asc'}`)
  }
  if (parts.length === 0) parts.push('identifier.asc')
  // Stable secondary sort so pagination is deterministic, but only when the
  // primary order is something other than identifier (otherwise it would
  // duplicate the identifier sort).
  else if (!parts.some((p) => p.startsWith('identifier.'))) {
    parts.push('identifier.asc')
  }
  return `order=${parts.join(',')}`
}

function sampleSortField(id: string): string | undefined {
  if (id.startsWith('custom:')) {
    const key = id.slice('custom:'.length)
    return /^[a-z][a-z0-9_]{0,62}$/.test(key)
      ? `custom_fields->${key}`
      : undefined
  }
  return SAMPLE_SORT_FIELDS[id]
}

/** Full PostgREST query string (with leading `?`) for a registry page list. */
export function buildSamplesQuery(query: RegistryQuery): string {
  const clauses = buildSamplesFilter(query.filters)
  clauses.push(buildSamplesOrder(query))
  clauses.push(`limit=${query.pageSize}`)
  clauses.push(`offset=${query.pageIndex * query.pageSize}`)
  clauses.push(
    'select=id,workspace_id,project_id,kind,identifier,title,status,tags,structure_version,metadata_version,created_at,updated_at,archived_at,deleted_at,created_by_user_id,updated_by_user_id,properties,custom_fields',
  )
  return `?${clauses.join('&')}`
}

/** Filter-only query string (with leading `?`) for a server total count. */
export function buildSamplesCountQuery(query: RegistryQuery): string {
  return `?${buildSamplesFilter(query.filters).join('&')}`
}

// ---------------------------------------------------------------------------
// Wire shapes for sample_events and record_links.
// ---------------------------------------------------------------------------

export interface SampleEventWire {
  id: string
  workspace_id: string
  record_id: string
  operation: string
  quantity_delta: string | null
  quantity_before: string | null
  quantity_after: string | null
  quantity_unit: string | null
  from_location: string | null
  to_location: string | null
  actor_user_id: string | null
  purpose_record_id: string | null
  notes: string | null
  created_at: string
}

export interface SampleEvent {
  id: string
  recordId: string
  operation: string
  quantityDelta: number | null
  quantityBefore: number | null
  quantityAfter: number | null
  quantityUnit: string | null
  fromLocation: string | null
  toLocation: string | null
  actorUserId: string | null
  /** LAB-01: the experiment a quantity event was performed for, when set. */
  purposeRecordId: string | null
  notes: string | null
  createdAt: string
}

export function toSampleEvent(row: SampleEventWire): SampleEvent {
  return {
    id: row.id,
    recordId: row.record_id,
    operation: row.operation,
    quantityDelta:
      row.quantity_delta == null ? null : Number(row.quantity_delta),
    quantityBefore:
      row.quantity_before == null ? null : Number(row.quantity_before),
    quantityAfter:
      row.quantity_after == null ? null : Number(row.quantity_after),
    quantityUnit: row.quantity_unit,
    fromLocation: row.from_location,
    toLocation: row.to_location,
    actorUserId: row.actor_user_id,
    purposeRecordId: row.purpose_record_id ?? null,
    notes: row.notes,
    createdAt: row.created_at,
  }
}

// LAB-01 step 2 — reservations and the used/reserved/free balance.

export type SampleReservationState = 'active' | 'cancelled' | 'fulfilled'

export interface SampleReservationWire {
  id: string
  workspace_id: string
  sample_record_id: string
  experiment_record_id: string
  quantity: string
  unit: string | null
  planned: boolean
  state: string
  notes: string | null
  created_by_user_id: string | null
  cancelled_by_user_id: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

export interface SampleReservation {
  id: string
  sampleRecordId: string
  experimentRecordId: string
  quantity: number
  unit: string | null
  planned: boolean
  state: SampleReservationState
  notes: string | null
  createdByUserId: string | null
  cancelledByUserId: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}

export function toSampleReservation(
  row: SampleReservationWire,
): SampleReservation {
  return {
    id: row.id,
    sampleRecordId: row.sample_record_id,
    experimentRecordId: row.experiment_record_id,
    quantity: Number(row.quantity),
    unit: row.unit,
    planned: row.planned,
    state: row.state as SampleReservationState,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    cancelledByUserId: row.cancelled_by_user_id,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * LAB-01 step 2: the authoritative used / reserved / free balance for a sample,
 * as returned by `api.sample_quantity_balances`. `used` is the cumulative
 * consumed volume from the canonical sample_events ledger; `reserved` is the
 * sum of active reservations; `free` is the current quantity minus reserved.
 */
export interface SampleQuantityBalances {
  sampleRecordId: string
  unit: string | null
  current: number
  used: number
  reserved: number
  free: number
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

export function toSampleQuantityBalances(
  raw: Record<string, unknown>,
): SampleQuantityBalances {
  return {
    sampleRecordId: String(raw.sampleRecordId ?? ''),
    unit: asString(raw.unit),
    current: toNumber(raw.current),
    used: toNumber(raw.used),
    reserved: toNumber(raw.reserved),
    free: toNumber(raw.free),
  }
}

export interface SampleLinkWire {
  id: string
  source_record_id: string
  target_record_id: string | null
  target_kind: string
  target_identifier: string
  link_type: string
  link_metadata?: Record<string, unknown>
  created_at: string
}

export interface LinkedExperiment {
  linkId: string
  recordId: string | null
  identifier: string
  title: string | null
  status: string
}

export interface LinkedFile {
  linkId: string
  recordId: string | null
  identifier: string
  displayName: string | null
  byteSize: number | null
  status: string | null
}

// ---------------------------------------------------------------------------
// DataClient query helpers.
// ---------------------------------------------------------------------------

export const sampleQueryKeys = {
  page: (query: RegistryQuery) =>
    ['reg-002', 'samples', 'page', query] as const,
  detail: (recordId: string) =>
    ['reg-002', 'samples', 'detail', recordId] as const,
  events: (recordId: string) =>
    ['reg-002', 'samples', 'events', recordId] as const,
  links: (recordId: string) =>
    ['reg-002', 'samples', 'links', recordId] as const,
  reservations: (recordId: string) =>
    ['reg-002', 'samples', 'reservations', recordId] as const,
  balances: (recordId: string) =>
    ['reg-002', 'samples', 'balances', recordId] as const,
  releaseChecks: (recordId: string) =>
    ['reg-002', 'samples', 'release-checks', recordId] as const,
}

export interface SamplePage {
  rows: SampleRecord[]
  totalCount: number
}

/** Fetch one registry page plus the authoritative server total. */
export async function fetchSamplesPage(
  client: DataClient,
  query: RegistryQuery,
): Promise<SamplePage> {
  const [rows, totalCount] = await Promise.all([
    client
      .list<RecordWire>('records', buildSamplesQuery(query))
      .then((rs) => rs.map(toSampleRecord)),
    client.count('records', buildSamplesCountQuery(query)),
  ])
  return { rows, totalCount }
}

/** Fetch a single sample by id (used for the inspector when selected off-page). */
export async function fetchSample(
  client: DataClient,
  recordId: string,
): Promise<SampleRecord | null> {
  const rows = await client.list<RecordWire>(
    'records',
    `?id=eq.${recordId}&kind=eq.sample&select=id,workspace_id,project_id,kind,identifier,title,status,tags,structure_version,metadata_version,created_at,updated_at,archived_at,deleted_at,created_by_user_id,updated_by_user_id,properties,custom_fields`,
  )
  return rows.length > 0 ? toSampleRecord(rows[0]) : null
}

/** Fetch the chain-of-custody / quantity event log for a sample. The whole
 * ledger is returned: it is the audit trail the History tab counts and the
 * stream `deriveSampleVolumeSummary` reads, so older events are never dropped
 * without saying so. Consumers that want only the newest few reduce it
 * themselves (e.g. `SampleRecentHistory`). */
export async function fetchSampleEvents(
  client: DataClient,
  recordId: string,
): Promise<SampleEvent[]> {
  return client
    .list<SampleEventWire>(
      'sample_events',
      `?record_id=eq.${recordId}&order=created_at.desc`,
    )
    .then((rows) => rows.map(toSampleEvent))
}

/** LAB-01 step 2: list the reservations held for a sample (newest first). */
export async function fetchSampleReservations(
  client: DataClient,
  recordId: string,
): Promise<SampleReservation[]> {
  return client
    .list<SampleReservationWire>(
      'sample_reservations',
      `?sample_record_id=eq.${recordId}&order=created_at.desc&select=id,workspace_id,sample_record_id,experiment_record_id,quantity,unit,planned,state,notes,created_by_user_id,cancelled_by_user_id,cancelled_at,created_at,updated_at`,
    )
    .then((rows) => rows.map(toSampleReservation))
}

/** LAB-01 step 2: the authoritative used/reserved/free balance for a sample. */
export async function fetchSampleQuantityBalances(
  client: DataClient,
  recordId: string,
): Promise<SampleQuantityBalances> {
  const raw = await client.rpc<Record<string, unknown> | null>(
    'sample_quantity_balances',
    { p_record_id: recordId },
  )
  return toSampleQuantityBalances(raw ?? {})
}

// ---------------------------------------------------------------------------
// LAB-03 — derived samples and the volume summary the sample detail shows.
//
// The design's sample detail lists the volume facts (registered / current /
// last withdrawal) and the samples derived from this lot. Both are read from
// canonical data: the volume facts from the append-only `api.sample_events`
// ledger, and the derived samples from the outgoing `link_type='sample'`
// lineage edges written by the controlled derivation paths
// (`api.withdraw_sample`, `api.request_repeat`). A sample with no create event
// or no derivation link reports the fact as missing, never a guessed value.
// ---------------------------------------------------------------------------

export interface SampleLastWithdrawal {
  at: string
  quantity: number
  unit: string | null
  /** The experiment the withdrawal served, when the event records one. */
  purposeRecordId: string | null
  /** Quantity left after the withdrawal, from the ledger. */
  remaining: number | null
}

export interface SampleVolumeSummary {
  /** Initially registered volume: the ledger's create event, else current + used. */
  registered: number | null
  /** Current volume held on the record. */
  current: number | null
  unit: string | null
  /** Cumulative consumed volume across the ledger. */
  used: number | null
  lastWithdrawal: SampleLastWithdrawal | null
}

/**
 * Derive the volume summary from the record plus its custody ledger. Pure so
 * the honest missing-data paths are unit tested; `events` is the newest-first
 * stream `fetchSampleEvents` returns.
 */
export function deriveSampleVolumeSummary(
  sample: Pick<SampleRecord, 'quantity' | 'quantityUnit'>,
  events: readonly SampleEvent[],
): SampleVolumeSummary {
  const unit =
    sample.quantityUnit ??
    events.find((event) => event.quantityUnit)?.quantityUnit ??
    null
  const consumes = events.filter((event) => event.operation === 'consume')
  const used = consumes.length
    ? consumes.reduce(
        (total, event) => total + Math.abs(event.quantityDelta ?? 0),
        0,
      )
    : null
  // Newest-first, so the oldest create is the last matching event.
  const creates = events.filter((event) => event.operation === 'create')
  const created = creates.at(-1)
  const registered =
    created?.quantityAfter ??
    (sample.quantity != null && used != null ? sample.quantity + used : null)
  const latest = consumes.at(0) ?? null
  const lastWithdrawal: SampleLastWithdrawal | null = latest
    ? {
        at: latest.createdAt,
        quantity: Math.abs(latest.quantityDelta ?? 0),
        unit: latest.quantityUnit ?? unit,
        purposeRecordId: latest.purposeRecordId,
        remaining: latest.quantityAfter,
      }
    : null
  return { registered, current: sample.quantity, unit, used, lastWithdrawal }
}

export interface DerivedSample {
  linkId: string
  recordId: string | null
  /** The record this derivation was made from (the sample or a child). */
  parentRecordId: string | null
  identifier: string
  title: string | null
  status: string | null
  /** Human relation recorded on the derivation link, when the writer set one. */
  relation: string | null
  /** Lineage hops from the sample: 0 direct, 1 derived from a direct child. */
  depth: number
}

const DERIVATION_ORIGIN_LABELS: Record<string, string> = {
  withdraw_sample: 'Derived by withdrawal',
  request_repeat: 'Repeat dilution',
}

/** The human relation for a derivation link, from its provenance metadata. */
export function derivationRelation(
  metadata: Record<string, unknown> | undefined,
): string | null {
  if (!metadata) return null
  if (
    typeof metadata.relation === 'string' &&
    metadata.relation.trim() !== ''
  ) {
    return metadata.relation.trim()
  }
  const origin = metadata.origin
  if (typeof origin === 'string')
    return DERIVATION_ORIGIN_LABELS[origin] ?? null
  return null
}

/** LAB-03 measurement provenance, read by the sample detail and Measurements tab. */
export const sampleMeasurementsQueryKey = (recordId: string) =>
  ['ui-port', 'sample-measurements', recordId] as const

export const sampleDerivedQueryKey = (recordId: string) =>
  ['ui-port', 'sample-derived', recordId] as const

const DERIVED_LINK_SELECT =
  'id,source_record_id,target_record_id,target_kind,target_identifier,link_type,link_metadata,created_at'

async function fetchSampleLinks(
  client: DataClient,
  sourceIds: string[],
): Promise<SampleLinkWire[]> {
  if (sourceIds.length === 0) return []
  return client.list<SampleLinkWire>(
    'record_links',
    `?source_record_id=in.(${sourceIds.join(',')})&link_type=eq.sample&target_kind=eq.sample&select=${DERIVED_LINK_SELECT}&order=created_at.asc`,
  )
}

/**
 * The samples derived from this one, two lineage hops deep: the direct
 * derivations plus the samples derived from them (the design's nested "↳"
 * rows). Each row keeps its `depth` so a nested derivation renders indented,
 * and the target record supplies the identifier, title and status. Nothing is
 * invented: a link whose target record is not visible keeps its preserved
 * identifier and a null status.
 */
export async function fetchSampleDerivedSamples(
  client: DataClient,
  sampleRecordId: string,
): Promise<DerivedSample[]> {
  const direct = await fetchSampleLinks(client, [sampleRecordId])
  if (direct.length === 0) return []
  const directTargets = direct
    .map((link) => link.target_record_id)
    .filter((id): id is string => Boolean(id))
  const nested = await fetchSampleLinks(client, directTargets)
  const links: Array<{ link: SampleLinkWire; depth: number }> = [
    ...direct.map((link) => ({ link, depth: 0 })),
    ...nested.map((link) => ({ link, depth: 1 })),
  ]
  const targetIds = links
    .map(({ link }) => link.target_record_id)
    .filter((id): id is string => Boolean(id))
  const records = targetIds.length
    ? await client.list<RecordWire>(
        'records',
        `?id=in.(${targetIds.join(',')})&select=id,identifier,title,status`,
      )
    : []
  const byId = new Map(records.map((record) => [record.id, record]))
  return links.map(({ link, depth }) => {
    const record = link.target_record_id
      ? byId.get(link.target_record_id)
      : undefined
    return {
      linkId: link.id,
      recordId: link.target_record_id,
      parentRecordId: link.source_record_id,
      identifier: record?.identifier ?? link.target_identifier,
      title: record?.title ?? null,
      status: record?.status ?? null,
      relation: derivationRelation(link.link_metadata),
      depth,
    }
  })
}

/** One rendered row of the design's Derived samples table. */
export interface DerivedDisplayEntry {
  /** "SMP-2248" for a single row, "SMP-2240 … 2247" for a collapsed run. */
  identifier: string
  /** Target record for a single row; null for a collapsed run. */
  recordId: string | null
  title: string
  relation: string | null
  status: string | null
  /** Lineage hops: 0 direct, 1 nested under the row above. */
  depth: number
  /** Number of derivations the row represents (1 unless collapsed). */
  count: number
  linkIds: string[]
}

/**
 * Collapse the derived samples into the design's table rows: consecutive
 * direct derivations that share a relation and have no derivations of their own
 * become one "SMP-2240 … 2247" range row, while a derivation that itself has
 * children keeps its own row (and its children follow it, indented). The
 * schema models individual derivations, not the design's hand-written group
 * names, so a collapsed row is named from its first and last members.
 */
export function groupDerivedSamples(
  samples: readonly DerivedSample[],
): DerivedDisplayEntry[] {
  const direct = samples
    .filter((sample) => sample.depth === 0)
    .sort((a, b) => a.identifier.localeCompare(b.identifier))
  const childrenOf = (recordId: string | null) =>
    samples.filter(
      (sample) => sample.depth === 1 && sample.parentRecordId === recordId,
    )

  const single = (sample: DerivedSample): DerivedDisplayEntry => ({
    identifier: sample.identifier,
    recordId: sample.recordId,
    title: sample.title ?? sample.identifier,
    relation: sample.relation,
    status: sample.status,
    depth: 0,
    count: 1,
    linkIds: [sample.linkId],
  })

  const entries: DerivedDisplayEntry[] = []
  let index = 0
  while (index < direct.length) {
    const run: DerivedSample[] = [direct[index]]
    while (
      index + 1 < direct.length &&
      childrenOf(direct[index].recordId).length === 0 &&
      childrenOf(direct[index + 1].recordId).length === 0 &&
      direct[index + 1].relation === run[0].relation
    ) {
      run.push(direct[index + 1])
      index++
    }
    const first = run[0]
    const last = run[run.length - 1]
    if (run.length > 1) {
      entries.push({
        identifier: `${first.identifier} … ${last.identifier}`,
        recordId: null,
        title: `${first.title ?? first.identifier} … ${last.title ?? last.identifier} (${run.length})`,
        relation: first.relation,
        status: first.status,
        depth: 0,
        count: run.length,
        linkIds: run.map((sample) => sample.linkId),
      })
    } else {
      entries.push(single(first))
    }
    for (const child of childrenOf(first.recordId)) {
      entries.push({
        identifier: child.identifier,
        recordId: child.recordId,
        title: child.title ?? child.identifier,
        relation: child.relation,
        status: child.status,
        depth: 1,
        count: 1,
        linkIds: [child.linkId],
      })
    }
    index++
  }
  return entries
}

// ---------------------------------------------------------------------------
// LAB-03 — authoritative measurement provenance.
// The sample Measurements tab reads `api.sample_measurement_provenance`: values
// aggregated from Dataset rows linked to the sample and from integration/QC
// results, each carrying the row/source that produced it. It is read-only and
// deliberately does not read the standalone `sample_measurements` table, which
// remains the bench-reading surface (MOB-02).
// ---------------------------------------------------------------------------

export interface SampleMeasurementProvenance {
  kind: 'dataset' | 'integration'
  datasetId: string | null
  datasetDisplayId: string | null
  datasetName: string | null
  rowId: string | null
  fieldId: string | null
  fieldKey: string | null
  /** Integration source: the QC check id. */
  sourceId: string | null
  runId: string | null
  runIdentifier: string | null
  instrumentId: string | null
  instrumentName: string | null
}

export interface SampleMeasurement {
  id: string
  measurement: string
  value: number | null
  valueText: string | null
  unit: string | null
  method: string | null
  source: string | null
  result: string | null
  measuredAt: string
  provenance: SampleMeasurementProvenance
}

/** Fetch the aggregated, read-only measurements for a sample with provenance. */
export async function fetchSampleMeasurements(
  client: DataClient,
  sampleRecordId: string,
): Promise<SampleMeasurement[]> {
  const rows = await client.rpc<SampleMeasurement[] | null>(
    'sample_measurement_provenance',
    { p_sample_record_id: sampleRecordId },
  )
  return rows ?? []
}

/**
 * Linked experiments: incoming `record_links` with link_type='sample' whose
 * target is this sample. Returns the source records (experiments) summarised.
 */
export async function fetchLinkedExperiments(
  client: DataClient,
  sampleRecordId: string,
): Promise<LinkedExperiment[]> {
  const links = await client.list<SampleLinkWire>(
    'record_links',
    `?target_record_id=eq.${sampleRecordId}&link_type=eq.sample&order=created_at.desc`,
  )
  if (links.length === 0) return []
  const sourceIds = links
    .map((l) => l.source_record_id)
    .filter((id): id is string => Boolean(id))
  if (sourceIds.length === 0) {
    return links.map((l) => ({
      linkId: l.id,
      recordId: null,
      identifier: l.target_identifier,
      title: null,
      status: 'unknown',
    }))
  }
  const records = await client.list<RecordWire>(
    'records',
    `?id=in.(${sourceIds.join(',')})&select=id,identifier,title,status`,
  )
  const byId = new Map(records.map((r) => [r.id, r]))
  return links.map((l) => {
    const rec = l.source_record_id ? byId.get(l.source_record_id) : undefined
    return {
      linkId: l.id,
      recordId: l.source_record_id,
      identifier: rec?.identifier ?? l.target_identifier,
      title: rec?.title ?? null,
      status: rec?.status ?? 'unknown',
    }
  })
}

/**
 * Linked files: outgoing `record_links` with link_type='file' from this
 * sample, enriched with the live `file_objects` metadata.
 */
export async function fetchLinkedFiles(
  client: DataClient,
  sampleRecordId: string,
): Promise<LinkedFile[]> {
  const links = await client.list<SampleLinkWire>(
    'record_links',
    `?source_record_id=eq.${sampleRecordId}&link_type=eq.file&order=created_at.desc`,
  )
  if (links.length === 0) return []
  const targetIds = links
    .map((l) => l.target_record_id)
    .filter((id): id is string => Boolean(id))
  if (targetIds.length === 0) {
    return links.map((l) => ({
      linkId: l.id,
      recordId: null,
      identifier: l.target_identifier,
      displayName: null,
      byteSize: null,
      status: null,
    }))
  }
  const [records, fileObjects] = await Promise.all([
    client.list<RecordWire>(
      'records',
      `?id=in.(${targetIds.join(',')})&select=id,identifier,status`,
    ),
    client.list<{
      record_id: string
      display_name: string
      byte_size: string
      status: string
    }>(
      'file_objects',
      `?record_id=in.(${targetIds.join(',')})&select=record_id,display_name,byte_size,status`,
    ),
  ])
  const fileByRecord = new Map(fileObjects.map((f) => [f.record_id, f]))
  const recById = new Map(records.map((r) => [r.id, r]))
  return links.map((l) => {
    const fileId = l.target_record_id
    const file = fileId ? fileByRecord.get(fileId) : undefined
    const rec = fileId ? recById.get(fileId) : undefined
    return {
      linkId: l.id,
      recordId: fileId,
      identifier: rec?.identifier ?? l.target_identifier,
      displayName: file?.display_name ?? null,
      byteSize: file ? Number(file.byte_size) : null,
      status: file?.status ?? rec?.status ?? null,
    }
  })
}

// ---------------------------------------------------------------------------
// Controlled-mutation RPC wrappers. Each returns the updated sample record.
// ---------------------------------------------------------------------------

export interface CreateSampleInput {
  projectId: string
  title: string
  status?: string
  tags?: string[]
  properties: SampleProperties
  customFields?: Record<string, unknown>
}

export async function createSample(
  client: DataClient,
  input: CreateSampleInput,
): Promise<SampleRecord> {
  const row = await client.rpc<RecordWire>('create_model_record', {
    p_project_id: input.projectId,
    p_kind: 'sample',
    p_title: input.title,
    p_status: input.status ?? 'available',
    p_tags: input.tags ?? [],
    p_properties: samplePropertiesPayload(input.properties),
    p_custom_fields: input.customFields ?? {},
  })
  return toSampleRecord(row)
}

export interface ReceiveSampleInput {
  recordId: string
  quantity: number
  unit?: string
  location?: string
  notes?: string
  expectedMetadataVersion: number
}

export async function receiveSample(
  client: DataClient,
  input: ReceiveSampleInput,
): Promise<SampleRecord> {
  const row = await client.rpc<RecordWire>('receive_sample', {
    p_record_id: input.recordId,
    p_quantity: input.quantity,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_unit: input.unit ?? null,
    p_location: input.location ?? null,
    p_notes: input.notes ?? null,
  })
  return toSampleRecord(row)
}

export interface ConsumeSampleInput {
  recordId: string
  quantity: number
  notes?: string
  expectedMetadataVersion: number
  /**
   * LAB-02: the experiment withdrawing the sample. Required by the server for
   * a `hold_exceeded` sample — it must appear in the sample's
   * `allowedUseExperimentIds` or the withdrawal is refused (SB004).
   */
  experimentId?: string
  /** LAB-01: the record the consumed quantity was used for (durable purpose). */
  purposeRecordId?: string
}

export async function consumeSample(
  client: DataClient,
  input: ConsumeSampleInput,
): Promise<SampleRecord> {
  const row = await client.rpc<RecordWire>('consume_sample', {
    p_record_id: input.recordId,
    p_quantity: input.quantity,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_notes: input.notes ?? null,
    p_experiment_id: input.experimentId ?? null,
    p_purpose_record_id: input.purposeRecordId ?? null,
  })
  return toSampleRecord(row)
}

/** LAB-01: optional new container derived from a withdrawal. */
export interface NewSampleContainerInput {
  title?: string
  barcode?: string
  storageLocation?: string
  sampleType?: string
}

export interface WithdrawSampleInput {
  recordId: string
  quantity: number
  /** The experiment the withdrawn volume is used for (required, server-checked). */
  purposeExperimentId: string
  unit?: string
  notes?: string
  expectedMetadataVersion: number
  /** When set, a derived container sample is created and linked in the same tx. */
  newContainer?: NewSampleContainerInput
}

export interface WithdrawSampleResult {
  /** The updated source sample. */
  sample: SampleRecord
  /** The derived container's id, or null when none was requested. */
  derivedSampleId: string | null
  derivedSample: SampleRecord | null
}

/**
 * LAB-01 step 1: withdraw volume for a purpose experiment on top of the
 * canonical consume event. The server refuses over-withdrawal (reporting the
 * available amount) and reserved volume, keeps the hold/quarantine/allowed-use
 * refusals, and can create a linked derived container in one transaction.
 */
export async function withdrawSample(
  client: DataClient,
  input: WithdrawSampleInput,
): Promise<WithdrawSampleResult> {
  const result = await client.rpc<{
    sample: RecordWire
    derivedSampleId: string | null
    derivedSample: RecordWire | null
  }>('withdraw_sample', {
    p_record_id: input.recordId,
    p_quantity: input.quantity,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_purpose_experiment_id: input.purposeExperimentId,
    p_unit: input.unit ?? null,
    p_notes: input.notes ?? null,
    p_new_container: input.newContainer ?? null,
  })
  return {
    sample: toSampleRecord(result.sample),
    derivedSampleId: result.derivedSampleId ?? null,
    derivedSample: result.derivedSample
      ? toSampleRecord(result.derivedSample)
      : null,
  }
}

export interface CreateSampleReservationInput {
  /** The sample holding the volume. */
  recordId: string
  /** The planned experiment the volume is held for (server-checked). */
  experimentId: string
  quantity: number
  unit?: string
  /** True for a reservation against a planned (not yet run) use. */
  planned?: boolean
  notes?: string
}

/**
 * LAB-01 step 2: reserve volume for a planned experiment. The server refuses a
 * reservation above the free (current - reserved) balance, a mismatched unit,
 * an archived sample, a cross-workspace experiment and viewers.
 */
export async function createSampleReservation(
  client: DataClient,
  input: CreateSampleReservationInput,
): Promise<SampleReservation> {
  const row = await client.rpc<SampleReservationWire>(
    'create_sample_reservation',
    {
      p_record_id: input.recordId,
      p_experiment_id: input.experimentId,
      p_quantity: input.quantity,
      p_unit: input.unit ?? null,
      p_planned: input.planned ?? true,
      p_notes: input.notes ?? null,
    },
  )
  return toSampleReservation(row)
}

export interface CancelSampleReservationInput {
  reservationId: string
  notes?: string
}

/**
 * LAB-01 step 2: cancel an active reservation, releasing the held volume for
 * withdrawal. Cancelling is an audited state change, never a delete.
 */
export async function cancelSampleReservation(
  client: DataClient,
  input: CancelSampleReservationInput,
): Promise<SampleReservation> {
  const row = await client.rpc<SampleReservationWire>(
    'cancel_sample_reservation',
    {
      p_reservation_id: input.reservationId,
      p_notes: input.notes ?? null,
    },
  )
  return toSampleReservation(row)
}

export interface TransferSampleInput {
  recordId: string
  toLocation: string
  notes?: string
  expectedMetadataVersion: number
}

export async function transferSample(
  client: DataClient,
  input: TransferSampleInput,
): Promise<SampleRecord> {
  const row = await client.rpc<RecordWire>('transfer_sample', {
    p_record_id: input.recordId,
    p_to_location: input.toLocation,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_notes: input.notes ?? null,
  })
  return toSampleRecord(row)
}

export interface EditSampleInput {
  recordId: string
  expectedMetadataVersion: number
  title?: string
  properties?: Partial<SampleProperties>
  tags?: string[]
  notes?: string
  customFields?: Record<string, unknown>
}

export async function editSample(
  client: DataClient,
  input: EditSampleInput,
): Promise<SampleRecord> {
  const row = await client.rpc<RecordWire>('edit_sample', {
    p_record_id: input.recordId,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_title: input.title ?? null,
    p_properties: input.properties
      ? samplePropertiesPayload(input.properties)
      : null,
    p_tags: input.tags ?? null,
    p_notes: input.notes ?? null,
    p_custom_fields: input.customFields ?? null,
  })
  return toSampleRecord(row)
}

export interface RecordSampleLabelPrintInput {
  recordId: string
  expectedMetadataVersion: number
  /** The identifier whose label was printed, recorded in the event's notes. */
  identifier: string
}

/**
 * LAB-05.2 — record that a sample's label was printed.
 *
 * DEC-10 prints labels from the browser, so there is no printer or gateway to
 * confirm a job against; the print is recorded on the sample's canonical,
 * append-only event stream so the History tab shows it. `api.sample_events`
 * has no print operation, so the print goes through the existing `edit_sample`
 * RPC — the sample-event path for a non-quantity event with free-text notes —
 * with the note that names the printed label. It is not a second event table
 * and never a direct insert into `api.sample_events`.
 */
export async function recordSampleLabelPrint(
  client: DataClient,
  input: RecordSampleLabelPrintInput,
): Promise<SampleLabelPrintEvent> {
  // LAB-05.2: printing is its own event, not an edit — it changes nothing about
  // the sample, and the History should say what actually happened.
  return client.rpc<SampleLabelPrintEvent>('record_sample_label_print', {
    p_record_id: input.recordId,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_note: `Printed label ${input.identifier}`,
  })
}

/** The sample_events row a label print appends. */
export interface SampleLabelPrintEvent {
  id: string
  operation: string
  notes: string | null
  created_at: string
}

export interface ArchiveSampleInput {
  recordId: string
  expectedMetadataVersion: number
  notes?: string
}

export async function archiveSample(
  client: DataClient,
  input: ArchiveSampleInput,
): Promise<SampleRecord> {
  const row = await client.rpc<RecordWire>('archive_sample', {
    p_record_id: input.recordId,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_notes: input.notes ?? null,
  })
  return toSampleRecord(row)
}

export interface RestoreSampleInput {
  recordId: string
  expectedMetadataVersion: number
  notes?: string
}

export async function restoreSample(
  client: DataClient,
  input: RestoreSampleInput,
): Promise<SampleRecord> {
  const row = await client.rpc<RecordWire>('restore_sample', {
    p_record_id: input.recordId,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_notes: input.notes ?? null,
  })
  return toSampleRecord(row)
}

export interface QuarantineSampleInput {
  recordId: string
  expectedMetadataVersion: number
  /** Required human reason; stored in properties and on the sample event. */
  reason: string
  notes?: string
}

/**
 * LAB-02: quarantine a sample with a required reason. Requires the
 * `sample.quarantine` capability server-side; moves available/reserved/
 * hold_exceeded -> quarantined and appends a canonical `quarantine` event.
 */
export async function quarantineSample(
  client: DataClient,
  input: QuarantineSampleInput,
): Promise<SampleRecord> {
  const row = await client.rpc<RecordWire>('quarantine_sample', {
    p_record_id: input.recordId,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_reason: input.reason,
    p_notes: input.notes ?? null,
  })
  return toSampleRecord(row)
}

export interface DisposeSampleInput {
  recordId: string
  expectedMetadataVersion: number
  /** Required disposal reason; recorded in properties and the audit event. */
  reason: string
  notes?: string
}

/**
 * LAB-02: record disposal of a sample. Requires the `sample.dispose`
 * capability; moves a non-terminal sample to the terminal `disposed` state.
 */
export async function disposeSample(
  client: DataClient,
  input: DisposeSampleInput,
): Promise<SampleRecord> {
  const row = await client.rpc<RecordWire>('dispose_sample', {
    p_record_id: input.recordId,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_reason: input.reason,
    p_notes: input.notes ?? null,
  })
  return toSampleRecord(row)
}

export interface ReleaseSampleInput {
  recordId: string
  expectedMetadataVersion: number
  notes?: string
}

/**
 * LAB-02: release a sample. Requires the `sample.release` capability, refuses
 * (SB093) when the effective per-sample-type release checks fail against the
 * LAB-03 measurement read model, and records the release + check snapshot on
 * success.
 */
export async function releaseSample(
  client: DataClient,
  input: ReleaseSampleInput,
): Promise<SampleRecord> {
  const row = await client.rpc<RecordWire>('release_sample', {
    p_record_id: input.recordId,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_notes: input.notes ?? null,
  })
  return toSampleRecord(row)
}

export interface RegisterSamplesInput {
  projectId: string
  samples: {
    title: string
    sampleType?: string
    quantity?: number
    quantityUnit?: string
    storageLocation?: string
    barcode?: string
  }[]
}

/**
 * Register a list of samples in one transaction: the whole list lands or none
 * of it does. Returns the new samples in the order they were given.
 */
export async function registerSamples(
  client: DataClient,
  input: RegisterSamplesInput,
): Promise<SampleRecord[]> {
  const rows = await client.rpc<RecordWire[]>('register_samples', {
    p_project_id: input.projectId,
    p_samples: input.samples,
  })
  return rows.map(toSampleRecord)
}

export interface AliquotSampleInput {
  recordId: string
  /** How many tubes to make. */
  count: number
  /** The volume or amount in each tube. */
  quantityEach: number
  /** The experiment the aliquots are for (the same purpose a withdrawal needs). */
  purposeExperimentId: string
  unit?: string
  notes?: string
  expectedMetadataVersion: number
  /** Shared by every tube: title prefix, location, type, barcode. */
  newContainer?: NewSampleContainerInput
}

export interface AliquotSampleResult {
  /** The source sample after all tubes were taken. */
  sample: SampleRecord
  derivedSamples: SampleRecord[]
}

/**
 * Split a sample into N tubes in one step. Each tube is a withdrawal into a
 * derived container, so the ledger and lineage match N manual withdrawals; the
 * server refuses the whole split when the tubes would overdraw the free volume.
 */
export async function aliquotSample(
  client: DataClient,
  input: AliquotSampleInput,
): Promise<AliquotSampleResult> {
  const result = await client.rpc<{
    sample: RecordWire
    derivedSamples: RecordWire[]
  }>('aliquot_sample', {
    p_record_id: input.recordId,
    p_count: input.count,
    p_quantity_each: input.quantityEach,
    p_purpose_experiment_id: input.purposeExperimentId,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_unit: input.unit ?? null,
    p_notes: input.notes ?? null,
    p_new_container: input.newContainer ?? null,
  })
  return {
    sample: toSampleRecord(result.sample),
    derivedSamples: result.derivedSamples.map(toSampleRecord),
  }
}

export interface SampleReleaseCheck {
  key: string
  label: string
  kind: string
  passed: boolean
  detail: string | null
}

export interface SampleReleaseCheckStatus {
  passed: boolean
  ruleCount: number
  failedCount: number
  checks: SampleReleaseCheck[]
}

/** The release checks a sample has to pass, evaluated now (read-only). */
export async function fetchSampleReleaseCheckStatus(
  client: DataClient,
  recordId: string,
): Promise<SampleReleaseCheckStatus> {
  const raw = await client.rpc<Record<string, unknown> | null>(
    'sample_release_check_status',
    { p_record_id: recordId },
  )
  const checks = Array.isArray(raw?.checks) ? raw.checks : []
  return {
    passed: raw?.passed === true,
    ruleCount: Number(raw?.ruleCount ?? checks.length),
    failedCount: Number(raw?.failedCount ?? 0),
    checks: checks.map((c: Record<string, unknown>) => ({
      key: String(c.key ?? ''),
      label: String(c.label ?? c.key ?? 'Check'),
      kind: String(c.kind ?? ''),
      passed: c.passed === true,
      detail: typeof c.detail === 'string' && c.detail ? c.detail : null,
    })),
  }
}

/**
 * The labels of the release checks `api.release_sample` refused on (SB093
 * `release checks failed: ["Purity","Identity"]`). Null when the error is not a
 * release-check refusal or carries no labels.
 */
export function releaseFailedChecks(error: unknown): string[] | null {
  if (!(error instanceof DataClientError)) return null
  const match = /release checks failed:\s*(\[.*\])/s.exec(error.message)
  if (!match) return null
  try {
    const labels: unknown = JSON.parse(match[1])
    if (!Array.isArray(labels)) return null
    const names = labels.map((label) => String(label)).filter(Boolean)
    return names.length ? names : null
  } catch {
    return null
  }
}

/**
 * Map a DataClientError to a short, actionable user-facing message keyed by
 * the database error code. Unknown codes fall back to the upstream message.
 */
export function describeSampleError(error: unknown): string {
  if (error instanceof DataClientError) {
    switch (error.code) {
      case 'SB006':
        return 'Insufficient quantity for this operation.'
      case 'SB007':
        return 'The sample is already at that location.'
      case 'SB008':
        return 'A location is required for this transfer.'
      case 'SB009':
        return 'That record is not a sample.'
      case 'SB004':
        return 'This operation is not allowed for the sample lifecycle state.'
      case 'SB001':
        return 'This sample was edited by someone else. Refresh and try again.'
      case 'SB093': {
        const failed = releaseFailedChecks(error)
        if (failed) return `Release checks failed: ${failed.join(', ')}.`
        return 'The release, quarantine or disposal could not be recorded. Check the required details.'
      }
      case '42501':
        return 'You do not have access to that sample.'
      default:
        return error.message
    }
  }
  return 'Could not complete the sample operation. Try again.'
}

// ---------------------------------------------------------------------------
// Column definitions for the registry composition.
//
// Exported as a factory so the route can pass its row type through. Columns
// use the Sheetbase-owned `dataGridFormat` meta so the shared grid formats
// numeric/unit cells consistently without a custom cell renderer.
// ---------------------------------------------------------------------------

export function sampleColumns<T extends SampleRecord & RowData>(
  modelFields: ModelFieldDefinition[] = [],
): ColumnDef<DataGridFieldFeatures, T, unknown>[] {
  const columns: ColumnDef<DataGridFieldFeatures, T, unknown>[] = [
    {
      accessorKey: 'identifier',
      header: 'Sample ID',
      enableHiding: false,
      cell: ({ row }) => (
        <span className="font-medium text-primary">
          {row.original.identifier}
        </span>
      ),
    },
    { accessorKey: 'title', header: 'Title' },
    {
      id: 'sampleType',
      header: 'Type',
      accessorFn: (row) => row.sampleType,
      cell: ({ row }) =>
        row.original.sampleType ? (
          <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[0.65rem] font-medium leading-tight text-primary-text">
            {row.original.sampleType}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'quantity',
      header: 'Quantity',
      accessorFn: (row) => row.quantity,
      meta: { dataGridFormat: { kind: 'scientific' } },
      cell: ({ row }) => {
        const q = row.original.quantity
        const unit = row.original.quantityUnit
        if (q == null) return <span className="text-muted-foreground">—</span>
        return (
          <span className="tabular-nums">
            {q}
            {unit ? (
              <span className="ml-0.5 text-muted-foreground">{unit}</span>
            ) : null}
          </span>
        )
      },
    },
    {
      id: 'storageLocation',
      header: 'Storage',
      accessorFn: (row) => row.storageLocation,
      cell: ({ row }) => (
        <span
          className="inline-block max-w-[14rem] truncate align-middle text-muted-foreground"
          title={row.original.storageLocation ?? undefined}
        >
          {row.original.storageLocation ?? '—'}
        </span>
      ),
    },
    {
      id: 'barcode',
      header: 'Barcode',
      accessorFn: (row) => row.barcode,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} domain="sample" size="sm" />
      ),
    },
    {
      id: 'updatedAt',
      header: 'Updated',
      accessorKey: 'updatedAt',
      meta: { dataGridFormat: { kind: 'date' } },
    },
  ]
  for (const definition of modelFields) {
    columns.push({
      id: modelFieldColumnId(definition.fieldName),
      header: definition.label,
      accessorFn: (row) => row.customFields[definition.fieldName],
      cell: ({ row }) =>
        displayModelFieldValue(
          definition,
          row.original.customFields[definition.fieldName],
        ),
      meta:
        definition.logicalType === 'integer' ||
        definition.logicalType === 'decimal'
          ? { dataGridFormat: { kind: 'scientific' } }
          : undefined,
    })
  }
  return columns
}
