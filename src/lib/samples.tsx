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
import type { ColumnDef } from '@tanstack/react-table'

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
  }
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
    notes: row.notes,
    createdAt: row.created_at,
  }
}

export interface SampleLinkWire {
  id: string
  source_record_id: string
  target_record_id: string | null
  target_kind: string
  target_identifier: string
  link_type: string
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

/** Fetch the chain-of-custody / quantity event log for a sample. */
export async function fetchSampleEvents(
  client: DataClient,
  recordId: string,
): Promise<SampleEvent[]> {
  return client
    .list<SampleEventWire>(
      'sample_events',
      `?record_id=eq.${recordId}&order=created_at.desc&limit=50`,
    )
    .then((rows) => rows.map(toSampleEvent))
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
  })
  return toSampleRecord(row)
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

export function sampleColumns<T extends SampleRecord>(
  modelFields: ModelFieldDefinition[] = [],
): ColumnDef<T, unknown>[] {
  const columns: ColumnDef<T, unknown>[] = [
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
          <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[0.65rem] font-medium leading-tight text-primary">
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
