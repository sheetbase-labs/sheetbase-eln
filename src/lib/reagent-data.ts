/**
 * Reagent registry domain library (REG-003).
 *
 * Materials are `records` of kind='material' with configurable properties
 * (supplier, catalog_no, lot, expiry, quantity, unit, storage) defined by
 * `record_field_definitions` (SCI-001 / decision 0026). This module provides
 * the application-boundary layer on top of the database contract:
 *
 * - typed projection of a reagent record's properties into a domain shape;
 * - low-stock and expiry attention derived from configured thresholds
 *   (`low_stock_threshold`, `expiry_warning_days`) rather than a stored status;
 * - PostgREST query translation for server-side pagination/sorting/filtering
 *   so the registry never loads the whole workspace into the browser;
 * - controlled-mutation helpers (receive/consume/quarantine/restore/archive)
 *   that call the `record_reagent_movement` and `archive_record` RPCs;
 * - fetch helpers for the inspector (recent movements, incoming usage links,
 *   linked protocols/documents).
 *
 * PostgreSQL and RLS remain authoritative. These helpers improve errors and
 * drive the UI; they must not be the only access-control boundary.
 */

import { daysUntilDate } from '#/lib/calendar-days'
import type { DataClient } from '#/lib/data-client'
import { toRecord } from '#/lib/notebook-data'
import type { NotebookRecord, RecordWire } from '#/lib/notebook-data'
import type { RegistryQuery } from '#/lib/registry'
import { listByIds } from '#/lib/chunk-ids'
import { now as appNow } from '#/lib/clock'

// ---------------------------------------------------------------------------
// Property projection. Reagent properties are a flat JSONB object keyed by
// field_name. The seeded field definitions (docs/api/scientific-records-api.md)
// define supplier/catalog_no/lot/expiry/quantity/unit/storage; thresholds are
// optional configurable fields. Every accessor is total: a missing or
// malformed value resolves to null so the UI can render an honest em dash.
// ---------------------------------------------------------------------------

export interface ReagentProperties {
  supplier: string | null
  catalogNo: string | null
  lot: string | null
  expiry: string | null // ISO date YYYY-MM-DD
  quantity: number | null
  unit: string | null
  storage: string | null
  lowStockThreshold: number | null
  expiryWarningDays: number | null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (
    typeof value === 'string' &&
    value !== '' &&
    /^-?[0-9]+(\.[0-9]+)?$/.test(value)
  ) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function projectReagentProperties(
  properties: Record<string, unknown>,
): ReagentProperties {
  return {
    supplier: asString(properties.supplier),
    catalogNo: asString(properties.catalog_no),
    lot: asString(properties.lot),
    expiry: asString(properties.expiry),
    quantity: asNumber(properties.quantity),
    unit: asString(properties.unit),
    storage: asString(properties.storage),
    lowStockThreshold: asNumber(properties.low_stock_threshold),
    expiryWarningDays: asNumber(properties.expiry_warning_days),
  }
}

/** Default expiry warning window when no per-reagent threshold is configured. */
export const DEFAULT_EXPIRY_WARNING_DAYS = 30

export interface Reagent extends ReagentProperties {
  /** Quantity as received, so the inspector can show "2 of 6 units". */
  initialQuantity: number | null
  received: string | null // ISO date YYYY-MM-DD
  releasedBy: string | null
  releasedAt: string | null // ISO date YYYY-MM-DD
  certificate: string | null
  id: string
  identifier: string
  title: string
  status: string
  tags: string[]
  projectId: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  metadataVersion: number
  /** First tag, used as the reagent category column/grouping. */
  category: string
  /** Underlying record, for the inspector and link resolution. */
  record: NotebookRecord
}

export function toReagent(record: NotebookRecord): Reagent {
  const props = projectReagentProperties(record.properties)
  // Lot-block detail is declared as model fields, so it arrives in custom_fields
  // rather than in the legacy properties allow-list.
  const custom = record.customFields ?? {}
  return {
    ...props,
    initialQuantity: asNumber(custom.initial_quantity),
    received: asString(custom.received),
    releasedBy: asString(custom.released_by),
    releasedAt: asString(custom.released_at),
    certificate: asString(custom.certificate),
    id: record.id,
    identifier: record.identifier,
    title: record.title,
    status: record.status,
    tags: record.tags,
    projectId: record.projectId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archivedAt: record.archivedAt,
    metadataVersion: record.metadataVersion,
    category: record.tags[0] ?? 'Uncategorised',
    record,
  }
}

export function toReagentFromWire(row: RecordWire): Reagent {
  return toReagent(toRecord(row))
}

// ---------------------------------------------------------------------------
// Low-stock and expiry attention. Derived from configured thresholds, never
// stored as a status. `low_stock` and `expired` pills are display-only; the
// authoritative lifecycle status (available/reserved/consumed/expired/
// quarantined) is rendered separately by the StatusBadge.
// ---------------------------------------------------------------------------

export type AttentionKind = 'ok' | 'low_stock' | 'near_expiry' | 'expired'

export interface ReagentAttention {
  kind: AttentionKind
  lowStock: boolean
  nearExpiry: boolean
  expired: boolean
  /** Days until expiry (negative when already past). */
  daysToExpiry: number | null
}

function daysBetween(iso: string, from: Date): number {
  return daysUntilDate(iso, from) ?? 0
}

/**
 * Compute low-stock and expiry attention from a reagent's configured
 * thresholds. A reagent shows `low_stock` only when a `low_stock_threshold`
 * is configured and the quantity is at or below it; `near_expiry` when
 * `expiry` falls within the warning window; `expired` when `expiry` has
 * passed. Consumed, expired and quarantined reagents suppress low-stock (no
 * restock signal once terminal); quarantined reagents suppress expiry
 * attention (the quarantine already isolates them).
 */
export function reagentAttention(
  reagent: Pick<
    Reagent,
    'status' | 'quantity' | 'expiry' | 'lowStockThreshold' | 'expiryWarningDays'
  >,
  now: Date = appNow(),
): ReagentAttention {
  const daysToExpiry = reagent.expiry ? daysBetween(reagent.expiry, now) : null
  const warningDays = reagent.expiryWarningDays ?? DEFAULT_EXPIRY_WARNING_DAYS

  const expired =
    daysToExpiry !== null &&
    daysToExpiry < 0 &&
    reagent.status !== 'quarantined'

  const nearExpiry =
    !expired &&
    daysToExpiry !== null &&
    daysToExpiry >= 0 &&
    daysToExpiry <= warningDays &&
    reagent.status !== 'expired' &&
    reagent.status !== 'quarantined'

  const lowStock =
    reagent.lowStockThreshold !== null &&
    reagent.quantity !== null &&
    reagent.quantity <= reagent.lowStockThreshold &&
    reagent.status !== 'consumed' &&
    reagent.status !== 'expired' &&
    reagent.status !== 'quarantined'

  const kind: AttentionKind = expired
    ? 'expired'
    : nearExpiry
      ? 'near_expiry'
      : lowStock
        ? 'low_stock'
        : 'ok'

  return { kind, lowStock, nearExpiry, expired, daysToExpiry }
}

// ---------------------------------------------------------------------------
// Movement ledger wire + domain shapes. `reagent_movements` is exposed by
// PostgREST under RLS; writes go through the `record_reagent_movement` RPC.
// ---------------------------------------------------------------------------

export interface ReagentMovementWire {
  id: string
  workspace_id: string
  reagent_record_id: string
  operation: string
  quantity_delta: string // numeric comes over the wire as a string
  resulting_quantity: string
  unit: string | null
  supplier: string | null
  catalog_no: string | null
  lot: string | null
  expiry: string | null
  reason: string | null
  actor_user_id: string | null
  created_at: string
}

export interface ReagentMovement {
  id: string
  reagentRecordId: string
  operation: 'receive' | 'consume' | 'quarantine' | 'restore'
  quantityDelta: number
  resultingQuantity: number
  unit: string | null
  supplier: string | null
  catalogNo: string | null
  lot: string | null
  expiry: string | null
  reason: string | null
  actorUserId: string | null
  createdAt: string
}

export function toReagentMovement(row: ReagentMovementWire): ReagentMovement {
  return {
    id: row.id,
    reagentRecordId: row.reagent_record_id,
    operation: row.operation as ReagentMovement['operation'],
    quantityDelta: Number(row.quantity_delta),
    resultingQuantity: Number(row.resulting_quantity),
    unit: row.unit,
    supplier: row.supplier,
    catalogNo: row.catalog_no,
    lot: row.lot,
    expiry: row.expiry,
    reason: row.reason,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
  }
}

export const MOVEMENT_LABELS: Record<ReagentMovement['operation'], string> = {
  receive: 'Received',
  consume: 'Consumed',
  quarantine: 'Quarantined',
  restore: 'Restored',
}

// ---------------------------------------------------------------------------
// Attention summary (server-computed). Returned by the
// `reagent_attention_summary` RPC so dashboard counts stay authoritative
// without loading every reagent row.
// ---------------------------------------------------------------------------

export interface ReagentAttentionSummary {
  total: number
  lowStock: number
  nearExpiry: number
  expired: number
  quarantined: number
}

// ---------------------------------------------------------------------------
// RegistryQuery -> PostgREST query translation. Server-side pagination,
// sorting, status/storage filtering and identifier/title search. Sorting on
// JSONB properties uses the `properties->>field` text accessor; ISO dates sort
// correctly as text. Quantity is not sortable server-side (text sort would be
// lexically wrong) — the column is display-only.
// ---------------------------------------------------------------------------

const SORTABLE_COLUMNS: Record<string, string> = {
  identifier: 'identifier',
  title: 'title',
  status: 'status',
  expiry: 'properties->>expiry',
  supplier: 'properties->>supplier',
  storage: 'properties->>storage',
  updatedAt: 'updated_at',
  createdAt: 'created_at',
}

const GROUPABLE_COLUMNS: Record<string, string> = {
  category: 'tags->>0',
  storage: 'properties->>storage',
  supplier: 'properties->>supplier',
  status: 'status',
}

export const REAGENT_FILTER_CAPABILITIES = {
  q: ['contains'],
  category: ['contains'],
  status: ['eq'],
  storage: ['eq'],
  supplier: ['contains'],
  catalogNo: ['contains'],
  lot: ['contains'],
} as const
const FILTER_IDS = Object.keys(REAGENT_FILTER_CAPABILITIES) as Array<
  keyof typeof REAGENT_FILTER_CAPABILITIES
>
export type ReagentFilterId = (typeof FILTER_IDS)[number]

const STORAGE_OPTIONS = ['-80 °C', '-20 °C', '4 °C', 'ambient']
const STATUS_OPTIONS = [
  'available',
  'reserved',
  'consumed',
  'expired',
  'quarantined',
]

export const REAGENT_STATUS_OPTIONS = STATUS_OPTIONS.map((value) => ({
  value,
  label: value
    .replace('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase()),
}))
export const REAGENT_STORAGE_OPTIONS = STORAGE_OPTIONS.map((value) => ({
  value,
  label: value,
}))

function escapePostgrest(value: string): string {
  // PostgREST uses commas and parens as separators; the safe set for inline
  // values is small. For our filter values (status/storage/search) the inputs
  // are bounded; we still strip the delimiters so a stray comma cannot inject
  // a second condition.
  return value.replace(/[,&()*."\\]/g, ' ').trim()
}

function postgrestLogicPattern(value: string): string {
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return encodeURIComponent(`"${escaped}*"`)
}

/**
 * Build the PostgREST query string for a reagent registry page. Always scopes
 * to non-soft-deleted reagents; archived rows are excluded by default and
 * included only when the status filter is `archived`.
 */
export function reagentListQuery(query: RegistryQuery): string {
  const parts: string[] = ['kind=eq.material', 'deleted_at=is.null']

  const archived = query.filters.find(
    (f) => f.fieldId === 'status' && f.values[0] === 'archived',
  )
  parts.push(archived ? 'archived_at=is.not.null' : 'archived_at=is.null')

  for (const filter of query.filters) {
    if (!(filter.fieldId in REAGENT_FILTER_CAPABILITIES)) {
      throw new Error(
        `Unsupported reagent filter: ${filter.fieldId}/${filter.operator}`,
      )
    }
    const capabilities =
      REAGENT_FILTER_CAPABILITIES[filter.fieldId as ReagentFilterId]
    if (!(capabilities as readonly string[]).includes(filter.operator)) {
      throw new Error(
        `Unsupported reagent filter: ${filter.fieldId}/${filter.operator}`,
      )
    }
    const raw = filter.values[0]
    if (typeof raw !== 'string' || !raw) continue
    if (filter.fieldId === 'status') {
      if (raw !== 'archived') parts.push(`status=eq.${escapePostgrest(raw)}`)
    } else if (filter.fieldId === 'storage') {
      parts.push(`properties->>storage=eq.${escapePostgrest(raw)}`)
    } else if (filter.fieldId === 'q') {
      const enc = postgrestLogicPattern(raw)
      parts.push(
        `or=(identifier.ilike.${enc},title.ilike.${enc},properties->>supplier.ilike.${enc},properties->>catalog_no.ilike.${enc},properties->>lot.ilike.${enc})`,
      )
    } else if (filter.fieldId === 'category') {
      parts.push(`tags->>0=ilike.${postgrestLogicPattern(raw)}`)
    } else {
      const property = {
        supplier: 'supplier',
        catalogNo: 'catalog_no',
        lot: 'lot',
      }[filter.fieldId]
      if (!property)
        throw new Error(`Unsupported reagent filter field: ${filter.fieldId}`)
      parts.push(`properties->>${property}=ilike.${postgrestLogicPattern(raw)}`)
    }
  }

  const order: string[] = []
  for (const group of query.grouping) {
    const col = GROUPABLE_COLUMNS[group]
    if (col) order.push(`${col}.asc`)
  }
  for (const sort of query.sorting) {
    const col = SORTABLE_COLUMNS[sort.id]
    if (col && !order.some((item) => item.startsWith(`${col}.`))) {
      order.push(`${col}.${sort.desc ? 'desc' : 'asc'}`)
    }
  }
  // Deterministic secondary sort so pagination is stable.
  order.push('identifier.asc')
  parts.push(`order=${order.join(',')}`)

  const offset = query.pageIndex * query.pageSize
  parts.push(`limit=${query.pageSize}`)
  parts.push(`offset=${offset}`)

  return `?${parts.join('&')}`
}

/** Query string for the count path (no limit/order, same filters). */
export function reagentCountQuery(query: RegistryQuery): string {
  const full = reagentListQuery(query)
  const without = full
    .replace(/&?limit=\d+/, '')
    .replace(/&?offset=\d+/, '')
    .replace(/&?order=[^&]+/, '')
  return without
}

// ---------------------------------------------------------------------------
// Fetch helpers.
// ---------------------------------------------------------------------------

export const reagentQueryKeys = {
  list: (query: RegistryQuery) =>
    ['reg-003', 'reagents', 'list', query] as const,
  infinite: (query: RegistryQuery) =>
    ['reg-003', 'reagents', 'infinite', query] as const,
  count: (query: RegistryQuery) =>
    ['reg-003', 'reagents', 'count', query] as const,
  detail: (id: string) => ['reg-003', 'reagents', 'detail', id] as const,
  movements: (id: string) => ['reg-003', 'reagents', 'movements', id] as const,
  usage: (identifier: string) =>
    ['reg-003', 'reagents', 'usage', identifier] as const,
  outgoingLinks: (id: string) =>
    ['reg-003', 'reagents', 'outgoing', id] as const,
  attention: (warningDays: number) =>
    ['reg-003', 'reagents', 'attention', warningDays] as const,
}

export function fetchReagentsPage(
  client: DataClient,
  query: RegistryQuery,
): Promise<Reagent[]> {
  return client
    .list<RecordWire>('records', reagentListQuery(query))
    .then((rows) => rows.map(toReagentFromWire))
}

export function fetchReagentsCount(
  client: DataClient,
  query: RegistryQuery,
): Promise<number> {
  return client.count('records', reagentCountQuery(query))
}

export function fetchReagent(
  client: DataClient,
  recordId: string,
): Promise<Reagent | null> {
  return client
    .list<RecordWire>('records', `?id=eq.${recordId}&limit=1`)
    .then((rows) => (rows.length > 0 ? toReagentFromWire(rows[0]) : null))
}

export function fetchReagentMovements(
  client: DataClient,
  reagentRecordId: string,
  limit = 10,
): Promise<ReagentMovement[]> {
  return client
    .list<ReagentMovementWire>(
      'reagent_movements',
      `?reagent_record_id=eq.${reagentRecordId}&order=created_at.desc&limit=${limit}` +
        `&select=id,workspace_id,reagent_record_id,operation,quantity_delta,resulting_quantity,unit,supplier,catalog_no,lot,expiry,reason,actor_user_id,created_at`,
    )
    .then((rows) => rows.map(toReagentMovement))
}

export interface ReagentUsageLink {
  id: string
  sourceRecordId: string | null
  sourceKind: string
  sourceIdentifier: string
  linkType: string
  /** When the usage was recorded, so the inspector can state the date. */
  createdAt: string | null
  quantity: number | null
  unit: string | null
}

interface UsageLinkWire {
  id: string
  source_record_id: string
  link_type: string
  link_metadata: unknown
  created_at: string | null
}

interface UsageSourceWire {
  id: string
  kind: string
  identifier: string
}

/**
 * Incoming links to this reagent — the experiments, samples and protocols
 * that reference it. Resolved by `target_identifier` so links to a
 * soft-deleted or archived reagent still render honestly.
 */
export async function fetchReagentUsage(
  client: DataClient,
  identifier: string,
  limit = 25,
): Promise<ReagentUsageLink[]> {
  const links = await client.list<UsageLinkWire>(
    'record_links',
    `?target_identifier=eq.${encodeURIComponent(identifier)}&link_type=eq.material&order=created_at.desc&limit=${limit}` +
      `&select=id,source_record_id,link_type,link_metadata,created_at`,
  )
  if (links.length === 0) return []

  const sourceIds = [...new Set(links.map((link) => link.source_record_id))]
  const sources = await listByIds(sourceIds, (inList) =>
    client.list<UsageSourceWire>(
      'records',
      `?id=in.(${inList})&select=id,kind,identifier`,
    ),
  )
  const sourceById = new Map(sources.map((source) => [source.id, source]))

  return links.flatMap((link) => {
    const source = sourceById.get(link.source_record_id)
    return source
      ? [
          {
            id: link.id,
            sourceRecordId: source.id,
            sourceKind: source.kind,
            sourceIdentifier: source.identifier,
            linkType: link.link_type,
            createdAt: link.created_at ?? null,
            quantity: asNumber(
              (link.link_metadata as Record<string, unknown> | null)?.quantity,
            ),
            unit: asString(
              (link.link_metadata as Record<string, unknown> | null)?.unit,
            ),
          },
        ]
      : []
  })
}

export interface ReplacementLotLink {
  id: string
  targetRecordId: string | null
  targetIdentifier: string
  reason: string | null
}

/**
 * The lot registered to replace this one (LAB-04.2). The link carries the
 * replacement relation, so the inspector can state whether one exists.
 */
export async function fetchReplacementLot(
  client: DataClient,
  identifier: string,
): Promise<ReplacementLotLink | null> {
  // PostgREST reads `in.(...)` as a literal value list, so a subquery there is
  // cast to uuid and rejected. Resolve the record first, then filter by its id.
  const source = (
    await client.list<{ id: string }>(
      'records',
      `?identifier=eq.${encodeURIComponent(identifier)}&select=id&limit=1`,
    )
  ).at(0)
  if (!source) return null
  const links = await client.list<{
    id: string
    target_record_id: string | null
    target_identifier: string
    link_metadata: unknown
  }>(
    'record_links',
    `?source_record_id=eq.${encodeURIComponent(source.id)}` +
      `&link_type=eq.material&limit=25&select=id,target_record_id,target_identifier,link_metadata`,
  )
  const replacement = links.find(
    (link) =>
      (link.link_metadata as Record<string, unknown> | null)?.relation ===
      'replacement',
  )
  return replacement
    ? {
        id: replacement.id,
        targetRecordId: replacement.target_record_id,
        targetIdentifier: replacement.target_identifier,
        reason:
          asString(
            (replacement.link_metadata as Record<string, unknown> | null)
              ?.reason,
          ) ?? null,
      }
    : null
}

export interface CertificateFile {
  fileRecordId: string
  identifier: string
  displayName: string
  mediaType: string | null
}

/**
 * The lot's certificate of analysis (LAB-04.2). It is a file record linked to the
 * lot, so the inspector shows the file rather than a text field.
 */
export async function fetchCertificateFile(
  client: DataClient,
  recordId: string,
): Promise<CertificateFile | null> {
  const links = await client.list<{ target_record_id: string | null }>(
    'record_links',
    `?source_record_id=eq.${encodeURIComponent(recordId)}&link_type=eq.file&limit=5` +
      `&select=target_record_id`,
  )
  const target = links.find((link) => link.target_record_id)?.target_record_id
  if (!target) return null
  const record = (
    await client.list<{ id: string; identifier: string }>(
      'records',
      `?id=eq.${encodeURIComponent(target)}&select=id,identifier`,
    )
  ).at(0)
  if (!record) return null
  const object = (
    await client.list<{ display_name: string; media_type: string | null }>(
      'file_objects',
      `?record_id=eq.${encodeURIComponent(target)}&select=display_name,media_type&limit=1`,
    )
  ).at(0)
  return {
    fileRecordId: record.id,
    identifier: record.identifier,
    displayName: object?.display_name ?? record.identifier,
    mediaType: object?.media_type ?? null,
  }
}

export function fetchReagentAttentionSummary(
  client: DataClient,
  expiryWarningDays = DEFAULT_EXPIRY_WARNING_DAYS,
): Promise<ReagentAttentionSummary> {
  return client
    .rpc<ReagentAttentionSummary>('reagent_attention_summary', {
      p_expiry_warning_days: expiryWarningDays,
    })
    .then(
      (summary) =>
        ({
          total: Number(summary.total) || 0,
          lowStock: Number(summary.lowStock) || 0,
          nearExpiry: Number(summary.nearExpiry) || 0,
          expired: Number(summary.expired) || 0,
          quarantined: Number(summary.quarantined) || 0,
        }) satisfies ReagentAttentionSummary,
    )
}

// ---------------------------------------------------------------------------
// Controlled mutations. Each calls a SECURITY DEFINER RPC so quantity logic
// and status transitions are enforced at the database; the caller passes the
// metadata_version it last saw for optimistic concurrency.
// ---------------------------------------------------------------------------

export interface RecordReagentMovementInput {
  recordId: string
  operation: 'receive' | 'consume' | 'quarantine' | 'restore'
  /** Positive magnitude for receive/consume; ignored for quarantine/restore. */
  quantityDelta?: number
  reason?: string
  expectedMetadataVersion: number
}

export interface RecordReagentMovementResult {
  movement: ReagentMovementWire
  record: RecordWire
}

export function recordReagentMovement(
  client: DataClient,
  input: RecordReagentMovementInput,
): Promise<RecordReagentMovementResult> {
  return client.rpc<RecordReagentMovementResult>('record_reagent_movement', {
    p_reagent_record_id: input.recordId,
    p_operation: input.operation,
    p_quantity_delta: input.quantityDelta ?? 0,
    p_reason: input.reason ?? null,
    p_expected_metadata_version: input.expectedMetadataVersion,
  })
}

export interface RegisterReplacementLotInput {
  recordId: string
  lot: string
  /** ISO date YYYY-MM-DD. */
  expiry: string
  quantity: number
  unit?: string | null
  reason?: string | null
}

export interface RegisterReplacementLotResult {
  id: string
  identifier: string
  title: string
  projectId: string | null
  metadataVersion: number
  lot: string
  expiry: string
  quantity: number
  unit: string | null
}

/** A replacement is a sibling lot for the same material (LAB-04.2). */
export function registerReplacementLot(
  client: DataClient,
  input: RegisterReplacementLotInput,
): Promise<RegisterReplacementLotResult> {
  return client.rpc<RegisterReplacementLotResult>('register_replacement_lot', {
    p_reagent_record_id: input.recordId,
    p_lot: input.lot,
    p_expiry: input.expiry,
    p_quantity: input.quantity,
    p_unit: input.unit ?? null,
    p_reason: input.reason ?? null,
  })
}

export function archiveReagent(
  client: DataClient,
  recordId: string,
  expectedMetadataVersion: number,
): Promise<RecordWire> {
  return client.rpc<RecordWire>('archive_record', {
    p_record_id: recordId,
    p_expected_metadata_version: expectedMetadataVersion,
  })
}

export interface CreateReagentInput {
  projectId: string
  title: string
  status?: string
  tags?: string[]
  properties: Partial<ReagentProperties>
  customFields?: Record<string, unknown>
}

function reagentPropertiesPayload(
  properties: Partial<ReagentProperties>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (properties.supplier !== undefined) payload.supplier = properties.supplier
  if (properties.catalogNo !== undefined)
    payload.catalog_no = properties.catalogNo
  if (properties.lot !== undefined) payload.lot = properties.lot
  if (properties.expiry !== undefined) payload.expiry = properties.expiry
  if (properties.quantity !== undefined) payload.quantity = properties.quantity
  if (properties.unit !== undefined) payload.unit = properties.unit
  if (properties.storage !== undefined) payload.storage = properties.storage
  if (properties.lowStockThreshold !== undefined) {
    payload.low_stock_threshold = properties.lowStockThreshold
  }
  if (properties.expiryWarningDays !== undefined) {
    payload.expiry_warning_days = properties.expiryWarningDays
  }
  return payload
}

export async function createReagent(
  client: DataClient,
  input: CreateReagentInput,
): Promise<Reagent> {
  const row = await client.rpc<RecordWire>('create_model_record', {
    p_project_id: input.projectId,
    p_kind: 'material',
    p_title: input.title,
    p_status: input.status ?? 'available',
    p_tags: input.tags ?? [],
    p_properties: reagentPropertiesPayload(input.properties),
    p_custom_fields: input.customFields ?? {},
  })
  return toReagentFromWire(row)
}

export interface EditReagentInput {
  recordId: string
  expectedMetadataVersion: number
  title?: string
  tags?: string[]
  properties?: Partial<ReagentProperties>
  customFields?: Record<string, unknown>
}

export async function editReagent(
  client: DataClient,
  input: EditReagentInput,
): Promise<Reagent> {
  const patch: Record<string, unknown> = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.tags !== undefined) patch.tags = input.tags
  if (input.properties !== undefined) {
    patch.properties = reagentPropertiesPayload(input.properties)
  }
  const rows = await client.patch<RecordWire>(
    'records',
    `?id=eq.${encodeURIComponent(input.recordId)}&metadata_version=eq.${input.expectedMetadataVersion}`,
    patch,
  )
  const row = rows[0]
  if (input.customFields) {
    const updated = await client.rpc<RecordWire>(
      'update_record_custom_fields',
      {
        p_record_id: input.recordId,
        p_expected_metadata_version: row.metadata_version,
        p_values: input.customFields,
      },
    )
    return toReagentFromWire(updated)
  }
  return toReagentFromWire(row)
}
